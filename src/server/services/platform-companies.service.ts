import { prisma } from "../config/prisma";
import { prismaAdmin } from "../config/prisma-admin";
import { supabaseAdmin } from "../config/supabase";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { removeMembershipFromIdentity } from "./company-access.service";
import { addMembershipToIdentity } from "./permissoes.service";

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
  // Celular (só dígitos) do user_metadata. Vazio nas identidades anteriores
  // à obrigatoriedade do campo que ainda não passaram pelo backfill.
  phone: string;
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
      phone: (user.user_metadata as { phone?: string } | null)?.phone ?? "",
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

// Pausa (ou reativa) o acesso à empresa. Os usuários continuam logando —
// a identidade deles e as outras empresas em que participam seguem
// intactas —, mas nada de operar DENTRO desta: o companyStatusGuard barra
// metas, recebíveis, resultados e fechamento enquanto o status não for
// ATIVA.
export async function setCompanyStatus(
  platformUser: { role: "SUPER_ADMIN" | "SUPORTE" },
  companyId: string,
  status: "ATIVA" | "BLOQUEADA_INADIMPLENCIA",
) {
  assertSuperAdmin(platformUser);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new NotFoundError("Empresa não encontrada.");

  return prismaAdmin.company.update({
    where: { id: companyId },
    data: { status },
    select: { id: true, name: true, status: true },
  });
}

// Usado pelo controller para conferir a confirmação digitada antes de
// excluir — comparar o nome no backend evita depender do que o cliente diz
// que a empresa se chama.
export async function getCompanyName(companyId: string) {
  return prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
}

// EXCLUSÃO DEFINITIVA da empresa e de tudo que pertence a ela.
//
// Irreversível: apaga metas, resultados, recebíveis, fechamentos e o
// histórico financeiro inteiro. O controller exige que o Super Admin
// digite o nome da empresa para confirmar — sem isso, um clique errado na
// lista destrói dados sem volta.
//
// A ordem de exclusão é resolvida pelo Postgres (TRUNCATE ... CASCADE não
// serve aqui, pois apagaria as linhas de TODAS as empresas): usamos DELETE
// com CASCADE nas FKs via ordem topológica derivada do próprio banco, em
// vez de uma lista fixa de 30+ tabelas que sairia de sincronia a cada
// tabela nova.
export async function deleteCompanyPermanently(
  platformUser: { role: "SUPER_ADMIN" | "SUPORTE" },
  companyId: string,
) {
  assertSuperAdmin(platformUser);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, users: { select: { authUserId: true } } },
  });
  if (!company) throw new NotFoundError("Empresa não encontrada.");

  // Tabelas com companyId, descobertas no catálogo do Postgres — assim uma
  // tabela nova entra automaticamente, sem alguém precisar lembrar de
  // atualizar uma lista aqui.
  const tables = await prismaAdmin.$queryRaw<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attname = 'companyId'
      AND c.relkind = 'r'
      AND n.nspname = 'public'
      AND NOT a.attisdropped
  `;

  await prismaAdmin.$transaction(async (tx) => {
    // session_replication_role = replica desliga a checagem de FK durante
    // esta transação. É o que permite apagar as tabelas em qualquer ordem
    // sem violar dependências — e, como tudo que sai pertence à mesma
    // empresa, não há risco de deixar referência órfã de outro tenant.
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);

    for (const { table_name } of tables) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "companyId" = $1`, companyId);
    }

    await tx.$executeRawUnsafe(`DELETE FROM "companies" WHERE "id" = $1`, companyId);
  });

  // Limpa a membership desta empresa no app_metadata de cada identidade —
  // sem isso o login continuaria oferecendo uma empresa que não existe.
  await Promise.all(
    company.users
      .map((u) => u.authUserId)
      .filter((id): id is string => Boolean(id))
      .map((authUserId) => removeMembershipFromIdentity(authUserId, companyId).catch(() => undefined)),
  );

  return { name: company.name, tablesCleared: tables.length };
}

// Vincula uma identidade JÁ EXISTENTE a uma empresa, direto pelo painel da
// plataforma — atalho de gestão para quando o Admin da empresa não está
// disponível. Não dispara convite nem e-mail: o acesso passa a valer no
// próximo login.
export async function platformAddUserToCompany(
  platformUser: { role: "SUPER_ADMIN" | "SUPORTE" },
  input: { authUserId: string; companyId: string; role: "OPERACIONAL" | "LIDERANCA_NO" | "ADMINISTRADOR" },
) {
  assertSuperAdmin(platformUser);

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, name: true },
  });
  if (!company) throw new NotFoundError("Empresa não encontrada.");

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(input.authUserId);
  if (error || !data.user?.email) {
    throw new NotFoundError("Usuário não encontrado.");
  }
  const email = data.user.email;

  // Quem já esteve na empresa tem linha com leftAt preenchido: reativar
  // respeita a unique (authUserId, companyId), que um create violaria.
  const previous = await prisma.user.findFirst({
    where: { authUserId: input.authUserId, companyId: input.companyId },
    select: { id: true, leftAt: true },
  });

  if (previous && !previous.leftAt) {
    throw new ConflictError("Este usuário já faz parte desta empresa.");
  }

  const user = previous
    ? await prismaAdmin.user.update({
        where: { id: previous.id },
        data: { leftAt: null, isActive: true, role: input.role, email },
      })
    : await prismaAdmin.user.create({
        data: {
          companyId: input.companyId,
          email,
          passwordHash: "",
          authUserId: input.authUserId,
          role: input.role,
        },
      });

  await addMembershipToIdentity(input.authUserId, {
    userId: user.id,
    companyId: input.companyId,
    role: user.role,
  });

  return { userId: user.id, companyName: company.name, email };
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
