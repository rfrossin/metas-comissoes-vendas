import { prisma } from "../config/prisma";
import { prismaAdmin } from "../config/prisma-admin";
import { supabaseAdmin } from "../config/supabase";
import { ForbiddenError, NotFoundError } from "../utils/http-errors";
import { removeMembershipFromIdentity } from "./company-access.service";

// Visão do Super Admin sobre todas as empresas e seus usuários — só
// leitura, sem qualquer isolamento por companyId (o próprio ponto desta
// tela é atravessar tenants). Nunca expor fora de platformAuthMiddleware.
export async function listCompaniesWithUsers() {
  return prisma.company.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      inviteCode: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          // createdAt = entrada na empresa; leftAt = saída (null se ainda
          // está lá). Juntos dão o histórico de passagem por empresa.
          createdAt: true,
          leftAt: true,
          authUserId: true,
          member: { select: { fullName: true } },
        },
      },
    },
  });
}

export interface OrphanIdentity {
  authUserId: string;
  email: string;
  name: string;
  // Data de cadastro da IDENTIDADE (auth.users.created_at no Supabase).
  // Não existe no nosso banco — a identidade é anterior a qualquer User.
  createdAt: string;
  // Saída da última empresa, quando a pessoa já esteve em alguma. Null
  // para quem se cadastrou e nunca entrou em nenhuma.
  lastCompanyName: string | null;
  lastLeftAt: Date | null;
}

// Identidades SEM empresa ativa: quem se cadastrou e ainda não entrou em
// nenhuma, e quem saiu ou foi removido da última. A lista nasce no Supabase
// Auth (onde a identidade vive) e é cruzada com os Users daqui.
export async function listOrphanIdentities(): Promise<OrphanIdentity[]> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error || !data) return [];

  // Identidades da PLATAFORMA (Super Admin/Suporte) não são usuários de
  // empresa — apareceriam aqui para sempre, como ruído.
  const platformUsers = await prisma.platformUser.findMany({ select: { authUserId: true } });
  const platformAuthIds = new Set(platformUsers.map((p) => p.authUserId).filter(Boolean));

  const authUserIds = data.users.map((u) => u.id);
  const memberships = await prisma.user.findMany({
    where: { authUserId: { in: authUserIds } },
    select: {
      authUserId: true,
      leftAt: true,
      isActive: true,
      company: { select: { name: true } },
    },
  });

  const byAuthUser = new Map<string, typeof memberships>();
  for (const m of memberships) {
    if (!m.authUserId) continue;
    const list = byAuthUser.get(m.authUserId) ?? [];
    list.push(m);
    byAuthUser.set(m.authUserId, list);
  }

  const orphans: OrphanIdentity[] = [];
  for (const user of data.users) {
    if (platformAuthIds.has(user.id)) continue;

    const links = byAuthUser.get(user.id) ?? [];
    if (links.some((l) => !l.leftAt && l.isActive)) continue;

    // Saída mais recente entre os vínculos já encerrados, se houver.
    const lastLeft = links
      .filter((l): l is (typeof links)[number] & { leftAt: Date } => l.leftAt !== null)
      .sort((a, b) => b.leftAt.getTime() - a.leftAt.getTime())[0];

    orphans.push({
      authUserId: user.id,
      email: user.email ?? "",
      name: (user.user_metadata as { name?: string } | null)?.name ?? "",
      createdAt: user.created_at,
      lastCompanyName: lastLeft?.company.name ?? null,
      lastLeftAt: lastLeft?.leftAt ?? null,
    });
  }

  // Mais recentes primeiro — é a ordem útil para quem monitora cadastros.
  return orphans.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function assertSuperAdmin(platformUser: { role: "SUPER_ADMIN" | "SUPORTE" }): void {
  if (platformUser.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Só o Super Admin pode remover usuários.");
  }
}

// Encerra o vínculo de um usuário com UMA empresa (saída via leftAt). A
// identidade continua existindo e pode entrar em outras empresas.
export async function platformRemoveUserFromCompany(
  platformUser: { role: "SUPER_ADMIN" | "SUPORTE" },
  userId: string,
) {
  assertSuperAdmin(platformUser);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, authUserId: true, leftAt: true },
  });
  if (!user) throw new NotFoundError("Usuário não encontrado.");

  // prismaAdmin: o Super Admin não pertence a tenant nenhum, então não há
  // GUC para as políticas de escrita por companyId — mesmo caminho das
  // demais operações de plataforma.
  await prismaAdmin.user.update({
    where: { id: userId },
    // leftAt existente é preservado: remover duas vezes não deve reescrever
    // a data real da primeira saída.
    data: { leftAt: user.leftAt ?? new Date(), isActive: false },
  });

  if (user.authUserId) {
    await removeMembershipFromIdentity(user.authUserId, user.companyId);
  }
}

// Exclui a IDENTIDADE inteira (Supabase Auth) e encerra todos os vínculos.
//
// Os Users NÃO são apagados de propósito: as FKs de auditoria (fechamentos
// fechados, campanhas criadas) apontam para eles, e deletar quebraria o
// histórico financeiro das empresas por onde a pessoa passou. Eles ficam
// marcados como saídos e sem identidade — o acesso some, o histórico fica.
export async function platformDeleteIdentity(
  platformUser: { role: "SUPER_ADMIN" | "SUPORTE" },
  authUserId: string,
) {
  assertSuperAdmin(platformUser);

  const links = await prisma.user.findMany({
    where: { authUserId },
    select: { id: true, leftAt: true },
  });

  for (const link of links) {
    await prismaAdmin.user.update({
      where: { id: link.id },
      data: { leftAt: link.leftAt ?? new Date(), isActive: false, authUserId: null },
    });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
  if (error) {
    throw new Error(`Falha ao excluir identidade: ${error.message}`);
  }
}
