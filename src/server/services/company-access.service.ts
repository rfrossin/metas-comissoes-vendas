import { prisma } from "../config/prisma";
import { prismaAdmin } from "../config/prisma-admin";
import { supabaseAdmin } from "../config/supabase";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { generateInviteCode, normalizeInviteCode } from "../utils/invite-code.util";
import { writeWithTenant } from "../config/prisma";
import { addMembershipToIdentity } from "./permissoes.service";
import { sendMail } from "./mailer.service";
import type { RequestingUser } from "./scope.util";

// ISOLAMENTO ENTRE EMPRESAS NESTE ARQUIVO
//
// company_access_requests não segue o padrão de RLS por GUC das demais
// tabelas: quem cria a linha é o SOLICITANTE, que por definição ainda não
// pertence ao tenant (ver a justificativa na migration
// 20260803120000_identity_first_company_access). Portanto o isolamento
// aqui é responsabilidade EXPLÍCITA deste serviço:
//   - toda leitura/escrita do lado do Admin filtra por companyId vindo do
//     token de tenant (nunca do corpo da requisição);
//   - toda leitura do lado do solicitante filtra por authUserId vindo do
//     token de identidade.
// Qualquer função nova aqui precisa manter esse contrato.

function assertAdmin(user: RequestingUser): void {
  if (user.role !== "ADMINISTRADOR") {
    throw new ForbiddenError("Só o Administrador da empresa pode gerenciar pedidos de acesso.");
  }
}

interface RequestAccessInput {
  authUserId: string;
  email: string;
  name: string;
  inviteCode: string;
}

// Solicitante (token de identidade) pede acesso a uma empresa pelo código
// que o Admin divulgou. Não concede nada — só cria o pedido pendente.
export async function requestCompanyAccess(input: RequestAccessInput) {
  const code = normalizeInviteCode(input.inviteCode);

  const company = await prisma.company.findUnique({
    where: { inviteCode: code },
    select: { id: true, name: true, status: true },
  });
  if (!company) {
    throw new NotFoundError("Código de convite inválido. Confira com o administrador da empresa.");
  }
  if (company.status !== "ATIVA") {
    throw new ConflictError("Esta empresa está bloqueada e não pode receber novos acessos no momento.");
  }

  // Já pertence à empresa? Não faz sentido pedir acesso de novo. Cobre
  // também quem saiu e voltou a pedir: se leftAt está preenchido, o
  // pedido é legítimo e segue adiante.
  const existingUser = await prisma.user.findFirst({
    where: { authUserId: input.authUserId, companyId: company.id, leftAt: null },
    select: { id: true },
  });
  if (existingUser) {
    throw new ConflictError("Você já faz parte desta empresa. Faça login para acessá-la.");
  }

  const existingPending = await prisma.companyAccessRequest.findFirst({
    where: { authUserId: input.authUserId, companyId: company.id, status: "PENDENTE" },
    select: { id: true },
  });
  if (existingPending) {
    throw new ConflictError("Você já tem um pedido pendente para esta empresa. Aguarde a aprovação.");
  }

  // prismaAdmin: o solicitante não tem tenant, então não há GUC para
  // withTenant gravar — a política access_request_write da migration
  // cobre este INSERT.
  const request = await prismaAdmin.companyAccessRequest.create({
    data: {
      companyId: company.id,
      authUserId: input.authUserId,
      email: input.email,
      name: input.name,
      status: "PENDENTE",
    },
  });

  // Avisa os Admins da empresa que há um pedido esperando. Falha de e-mail
  // nunca desfaz o pedido — ele aparece no painel de qualquer forma.
  const admins = await prisma.user.findMany({
    where: { companyId: company.id, role: "ADMINISTRADOR", isActive: true, leftAt: null },
    select: { email: true },
  });
  await Promise.all(
    admins.map((admin) =>
      sendMail({
        to: admin.email,
        subject: `Novo pedido de acesso a ${company.name}`,
        html: `
          <p><strong>${input.name}</strong> (${input.email}) pediu acesso à empresa <strong>${company.name}</strong>.</p>
          <p>Acesse Usuários no sistema para aprovar ou recusar o pedido.</p>
        `,
      }).catch(() => undefined),
    ),
  );

  return { id: request.id, companyName: company.name };
}

// Pedidos que o SOLICITANTE fez — filtrado por authUserId do token de
// identidade, nunca por parâmetro do cliente.
export async function listMyAccessRequests(authUserId: string) {
  const requests = await prisma.companyAccessRequest.findMany({
    where: { authUserId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      rejectionReason: true,
      company: { select: { name: true } },
    },
  });

  return requests.map((r) => ({
    id: r.id,
    companyName: r.company.name,
    status: r.status,
    createdAt: r.createdAt,
    rejectionReason: r.rejectionReason,
  }));
}

// Lado do Admin: pedidos pendentes da PRÓPRIA empresa (companyId do token).
export async function listCompanyAccessRequests(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);

  return prisma.companyAccessRequest.findMany({
    where: { companyId, status: "PENDENTE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });
}

// Aprovar = criar (ou reativar) o User daquela identidade na empresa. O
// papel nasce sempre OPERACIONAL: quem entra por pedido é colaborador; o
// Admin promove depois na tela de Usuários, com a decisão explícita.
export async function approveAccessRequest(
  companyId: string,
  requestingUser: RequestingUser,
  requestId: string,
) {
  assertAdmin(requestingUser);

  const request = await prisma.companyAccessRequest.findFirst({
    where: { id: requestId, companyId },
  });
  if (!request) throw new NotFoundError("Pedido não encontrado.");
  if (request.status !== "PENDENTE") {
    throw new ConflictError("Este pedido já foi aprovado ou recusado.");
  }

  const user = await writeWithTenant(async (tx) => {
    // Quem já esteve na empresa tem linha com leftAt preenchido. Reativar
    // preserva o histórico e respeita a unique (authUserId, companyId) —
    // criar linha nova violaria a constraint.
    const previous = await tx.user.findFirst({
      where: { authUserId: request.authUserId, companyId },
      select: { id: true },
    });

    const saved = previous
      ? await tx.user.update({
          where: { id: previous.id },
          data: { leftAt: null, isActive: true, email: request.email },
        })
      : await tx.user.create({
          data: {
            companyId,
            email: request.email,
            // A credencial vive só no Supabase; este campo é resquício da
            // migração e sai quando passwordHash for removido do schema.
            passwordHash: "",
            authUserId: request.authUserId,
            role: "OPERACIONAL",
          },
        });

    await tx.companyAccessRequest.update({
      where: { id: requestId },
      data: { status: "APROVADO", reviewedByUserId: requestingUser.id, reviewedAt: new Date() },
    });

    return saved;
  });

  await addMembershipToIdentity(request.authUserId, {
    userId: user.id,
    companyId,
    role: user.role,
  });

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  await sendMail({
    to: request.email,
    subject: `Seu acesso a ${company?.name ?? "empresa"} foi aprovado`,
    html: `
      <p>Olá, ${request.name}.</p>
      <p>Seu acesso à empresa <strong>${company?.name ?? ""}</strong> foi aprovado. Faça login para entrar.</p>
    `,
  }).catch(() => undefined);

  return { userId: user.id };
}

export async function rejectAccessRequest(
  companyId: string,
  requestingUser: RequestingUser,
  requestId: string,
  reason: string,
) {
  assertAdmin(requestingUser);

  const request = await prisma.companyAccessRequest.findFirst({
    where: { id: requestId, companyId },
  });
  if (!request) throw new NotFoundError("Pedido não encontrado.");
  if (request.status !== "PENDENTE") {
    throw new ConflictError("Este pedido já foi aprovado ou recusado.");
  }

  await writeWithTenant((tx) =>
    tx.companyAccessRequest.update({
      where: { id: requestId },
      data: {
        status: "REJEITADO",
        reviewedByUserId: requestingUser.id,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    }),
  );

  await sendMail({
    to: request.email,
    subject: "Seu pedido de acesso não foi aprovado",
    html: `
      <p>Olá, ${request.name}.</p>
      <p>Seu pedido de acesso não foi aprovado.</p>
      ${reason ? `<p>Motivo: ${reason}</p>` : ""}
    `,
  }).catch(() => undefined);
}

// Código de convite da empresa, para o Admin exibir/copiar.
export async function getCompanyInviteCode(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { inviteCode: true },
  });
  if (!company) throw new NotFoundError("Empresa não encontrada.");
  return { inviteCode: company.inviteCode };
}

// Rotaciona o código. Pedidos PENDENTES criados com o código antigo
// continuam válidos de propósito: eles já estão na fila do Admin, e
// invalidá-los puniria quem pediu acesso de boa-fé antes da troca. O que a
// rotação impede é NOVO pedido com o código velho.
export async function regenerateCompanyInviteCode(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);

  // Colisão é astronomicamente improvável (32^10), mas a coluna é unique:
  // tentar de novo é mais barato que devolver erro ao Admin.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateInviteCode();
    const taken = await prisma.company.findUnique({ where: { inviteCode: candidate }, select: { id: true } });
    if (taken) continue;

    const updated = await writeWithTenant((tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { inviteCode: candidate },
        select: { inviteCode: true },
      }),
    );
    return updated;
  }

  throw new ConflictError("Não foi possível gerar um novo código. Tente novamente.");
}

// Usado pelo painel do solicitante para mostrar o nome da empresa antes de
// confirmar o pedido — evita pedir acesso à empresa errada por código
// digitado errado. Só devolve o nome, nunca dados internos.
export async function peekCompanyByInviteCode(inviteCode: string) {
  const company = await prisma.company.findUnique({
    where: { inviteCode: normalizeInviteCode(inviteCode) },
    select: { name: true, status: true },
  });
  if (!company || company.status !== "ATIVA") {
    throw new NotFoundError("Código de convite inválido.");
  }
  return { companyName: company.name };
}

// Remoção de um usuário da empresa pelo Admin: marca a saída em vez de
// apagar a linha. Deletar quebraria as FKs de auditoria (fechamentos,
// campanhas) e apagaria o histórico de quem passou pela empresa.
export async function removeUserFromCompany(
  companyId: string,
  requestingUser: RequestingUser,
  targetUserId: string,
) {
  assertAdmin(requestingUser);

  if (targetUserId === requestingUser.id) {
    throw new ConflictError("Você não pode remover o seu próprio acesso.");
  }

  const target = await prisma.user.findFirst({
    where: { id: targetUserId, companyId, leftAt: null },
    select: { id: true, authUserId: true },
  });
  if (!target) throw new NotFoundError("Usuário não encontrado nesta empresa.");

  await writeWithTenant((tx) =>
    tx.user.update({ where: { id: targetUserId }, data: { leftAt: new Date(), isActive: false } }),
  );

  if (target.authUserId) {
    await removeMembershipFromIdentity(target.authUserId, companyId);
  }
}

// Tira a membership do app_metadata da identidade. Sem isto o login ainda
// ofereceria a empresa (o filtro por leftAt no banco barraria a entrada,
// mas a pessoa veria a empresa listada — confuso e desnecessário).
export async function removeMembershipFromIdentity(authUserId: string, companyId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId);
  if (error || !data.user) return;

  const current = ((data.user.app_metadata as { memberships?: { companyId: string }[] }).memberships ?? []);
  const next = current.filter((m) => m.companyId !== companyId);

  await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    app_metadata: { memberships: next },
  });
}
