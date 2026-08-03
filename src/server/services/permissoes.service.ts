import crypto from "node:crypto";
import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import type { AccessLevel, OrgScopeType, PermissionLevel } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../utils/http-errors";
import { assertScopeEntityExists, resolveScopeName } from "./bases-metas.service";
import type { RequestingUser } from "./scope.util";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import type { Membership } from "./auth.service";
import { sendMail } from "./mailer.service";
import { env } from "../config/env";

const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

interface AppMetadataShape {
  memberships?: Membership[];
}

// Acrescenta uma membership ao app_metadata de uma identidade Supabase já
// existente, sem apagar as memberships de outras empresas que ela já tenha
// (cenário de consultor/usuário com acesso a múltiplas empresas). Usado no
// aceite de convite quando a identidade já existe (Fase 3: e-mail único
// global) e no backfill de usuários migrados.
// Exportada também para company-access.service.ts (aprovação de pedido de
// acesso), que precisa exatamente do mesmo comportamento de preservar as
// memberships de outras empresas.
export async function addMembershipToIdentity(authUserId: string, membership: Membership): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId);
  if (error || !data.user) {
    throw new Error(`Identidade Supabase não encontrada para authUserId=${authUserId}`);
  }

  const current = (data.user.app_metadata as AppMetadataShape).memberships ?? [];
  const withoutDuplicate = current.filter((m) => m.companyId !== membership.companyId);
  const updated = [...withoutDuplicate, membership];

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    app_metadata: { memberships: updated },
  });
  if (updateError) {
    throw new Error(`Falha ao atualizar app_metadata: ${updateError.message}`);
  }
}

function assertAdmin(requestingUser: RequestingUser): void {
  if (requestingUser.role !== "ADMINISTRADOR") {
    throw new ForbiddenError("Só Administradores podem gerenciar Usuários e Permissões.");
  }
}

function assertAdminOrGestor(requestingUser: RequestingUser): void {
  if (requestingUser.role !== "ADMINISTRADOR" && requestingUser.role !== "LIDERANCA_NO") {
    throw new ForbiddenError("Só Administradores ou Gestores podem convidar novos usuários.");
  }
}

const MEMBER_HIERARCHY_INCLUDE = {
  cargo: { select: { id: true, name: true, permissionLevel: true } },
  team: {
    select: {
      id: true,
      name: true,
      department: { select: { id: true, name: true, channel: { select: { id: true, name: true } } } },
    },
  },
} as const;

// ============================================================
// Usuários (Admin) — listagem, convite, desativação
// ============================================================

export async function listCompanyUsers(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);

  return prisma.user.findMany({
    where: { companyId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      canLaunchOwnMemberResults: true,
      member: { select: { id: true, fullName: true, ...MEMBER_HIERARCHY_INCLUDE } },
      scopeAssignments: { select: { id: true, scopeType: true, scopeId: true, accessLevel: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function listPendingInvites(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);

  return prisma.invite.findMany({
    where: { companyId, status: "PENDENTE" },
    select: {
      id: true,
      name: true,
      email: true,
      token: true,
      expiresAt: true,
      createdAt: true,
      cargo: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

interface CreateInviteInput {
  name: string;
  email: string;
}

// Convite só pede Nome + e-mail — Cargo/Time/vínculo a Membro viram sempre
// uma ação posterior do Admin, feita depois que o convite já foi aceito
// (ver linkUserMember). Quem convida pode ser Admin ou Gestor; só o Admin
// altera o usuário depois disso (atribuições, vínculo, edição, exclusão).
//
// O e-mail de convite é enviado pelo Supabase Auth (inviteUserByEmail). O
// registro em Invite continua sendo a fonte de verdade de NEGÓCIO (quem
// convidou, expiração de 7 dias, status) — o link do Supabase é só o
// transporte do e-mail; quem decide se o convite ainda vale é sempre este
// registro, checado em acceptInvite.
export async function createInvite(companyId: string, requestingUser: RequestingUser, input: CreateInviteInput) {
  assertAdminOrGestor(requestingUser);

  const existingUser = await prisma.user.findFirst({ where: { companyId, email: input.email } });
  if (existingUser) {
    throw new ConflictError("Já existe um usuário com este e-mail nesta empresa.");
  }
  const existingInvite = await prisma.invite.findFirst({ where: { companyId, email: input.email, status: "PENDENTE" } });
  if (existingInvite) {
    throw new ConflictError("Já existe um convite pendente para este e-mail.");
  }

  const invite = await writeWithTenant((tx) =>
    tx.invite.create({
      data: {
        companyId,
        name: input.name,
        email: input.email,
        token: crypto.randomUUID(),
        invitedByUserId: requestingUser.id,
        expiresAt: new Date(Date.now() + INVITE_EXPIRATION_MS),
      },
    }),
  );

  const [company, inviter] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.user.findUnique({
      where: { id: requestingUser.id },
      select: { email: true, member: { select: { fullName: true } } },
    }),
  ]);

  // Falha de envio nunca desfaz o convite já criado no banco — o Admin pode
  // sempre reenviar (cancelar e criar de novo, hoje não há reenvio dedicado).
  await sendInviteEmail(input.email, invite.token, {
    companyName: company?.name ?? "",
    inviterName: inviter?.member?.fullName ?? inviter?.email ?? "",
    inviterEmail: inviter?.email ?? "",
  }).catch(() => undefined);

  return invite;
}

// Gera o link explicitamente (em vez de deixar o Supabase enviar o e-mail
// automático, que ignora Invite.expiresAt e usa o site_url genérico do
// projeto) e envia pelo SMTP próprio. redirectTo aponta para a página de
// aceite do front-end já com o Invite.token — o mesmo token que
// acceptInvite valida contra o banco, com o prazo de 7 dias como única
// fonte de verdade (o link do Supabase em si pode expirar antes, mas isso
// não importa: verifyOtp só troca o link por sessão, quem decide se o
// convite ainda vale é o expiresAt checado em acceptInvite).
interface InviteEmailContext {
  companyName: string;
  // Vazios no fluxo de aprovação de empresa (company-signup.service.ts) —
  // ali o convite não parte de um Admin humano, e sim da aprovação do
  // Super Admin, então a linha "convidado por" é omitida do e-mail.
  inviterName: string;
  inviterEmail: string;
}

export async function sendInviteEmail(
  email: string,
  inviteToken: string,
  context: InviteEmailContext,
): Promise<void> {
  const redirectTo = `${env.frontendUrl}/convite/${inviteToken}`;

  // type: "invite" falha se a identidade já existir no Supabase (pessoa já
  // tem conta em outra empresa) — nesse caso caímos para "magiclink", que
  // funciona para identidade existente e gera o mesmo formato de link.
  let generated = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (generated.error) {
    generated = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
  }

  if (generated.error || !generated.data) {
    throw new Error(`Falha ao gerar link de convite: ${generated.error?.message}`);
  }

  const actionLink = generated.data.properties.action_link;

  const companyLine = context.companyName
    ? `<p>Você foi convidado a fazer parte da empresa <strong>${context.companyName}</strong> no sistema de Metas e Comissões.</p>`
    : `<p>Você foi convidado a acessar o sistema de Metas e Comissões.</p>`;

  const inviterLine = context.inviterName
    ? `<p>Convite enviado por <strong>${context.inviterName}</strong> (${context.inviterEmail}).</p>`
    : "";

  await sendMail({
    to: email,
    subject: context.companyName
      ? `Convite para fazer parte de ${context.companyName}`
      : "Convite para acessar o sistema de Metas e Comissões",
    html: `
      ${companyLine}
      ${inviterLine}
      <p><a href="${actionLink}">Clique aqui para definir sua senha e entrar</a></p>
      <p>Este link é válido por 7 dias.</p>
    `,
  });
}

export async function cancelInvite(companyId: string, requestingUser: RequestingUser, inviteId: string) {
  assertAdmin(requestingUser);

  const invite = await prisma.invite.findFirst({ where: { id: inviteId, companyId } });
  if (!invite) throw new NotFoundError("Convite não encontrado");
  if (invite.status !== "PENDENTE") {
    throw new ConflictError("Este convite já foi aceito, cancelado ou expirou.");
  }

  await writeWithTenant((tx) => tx.invite.update({ where: { id: inviteId }, data: { status: "CANCELADO" } }));
}

// Usuário aceito nasce sempre como Usuário (OPERACIONAL), sem atribuições e
// sem vínculo de Membro — Tipo, atribuições e vínculo passam a ser sempre
// configurados depois pelo Admin, na edição (ver updateUserRole,
// replaceUserScopeAssignments, linkUserMember).
//
// authUserId chega do frontend depois que o usuário já definiu a senha
// pelo link do Supabase (fluxo próprio do GoTrueClient, fora deste
// backend) e obteve uma sessão válida — este endpoint nunca recebe senha
// em texto claro. companyId/role vêm sempre do registro Invite já
// existente no banco, nunca de dado enviado pelo cliente, para não abrir
// brecha de um convidado se auto-atribuir a outra empresa.
// A tela de aceite precisa saber se quem clicou no link JÁ tem conta: para
// quem tem, pedir "defina sua senha" é sem sentido e — pior — sobrescreve a
// senha que a pessoa usa nas outras empresas dela. Devolve só o necessário
// para a tela decidir, sem expor dados do convite a quem não deveria vê-los.
export async function getInvitePublicInfo(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { email: true, status: true, expiresAt: true, company: { select: { name: true } } },
  });
  if (!invite || invite.status !== "PENDENTE") {
    throw new NotFoundError("Convite inválido ou já utilizado.");
  }
  if (invite.expiresAt < new Date()) {
    throw new ConflictError("Este convite expirou. Peça ao Administrador para gerar um novo.");
  }

  // listUsers com filtro por e-mail: a Admin API não tem "getUserByEmail".
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  const identityExists = data?.users.some((u) => u.email?.toLowerCase() === invite.email.toLowerCase()) ?? false;

  return {
    email: invite.email,
    companyName: invite.company.name,
    // true = a pessoa já tem login; a tela pede a senha ATUAL dela em vez
    // de mandar criar uma nova.
    identityExists,
  };
}

export async function acceptInvite(token: string, authUserId: string) {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "PENDENTE") {
    throw new NotFoundError("Convite inválido ou já utilizado.");
  }
  if (invite.expiresAt < new Date()) {
    throw new ConflictError("Este convite expirou. Peça ao Administrador para gerar um novo.");
  }

  // O papel vem do Cargo do convite, não fixo em OPERACIONAL. Com o valor
  // fixo, quem era convidado como Administrador (inclusive o solicitante de
  // uma empresa nova, cujo convite aponta para o Cargo "Administrador")
  // entrava como Operacional e ficava sem conseguir configurar a própria
  // empresa. Sem cargo definido, OPERACIONAL segue como padrão seguro — o
  // menor privilégio.
  const cargo = invite.cargoId
    ? await prisma.cargo.findUnique({ where: { id: invite.cargoId }, select: { permissionLevel: true } })
    : null;
  const role = cargo?.permissionLevel ?? "OPERACIONAL";

  // explicitCompanyId: rota pública, sem tenantContext (o convidado ainda
  // não tem token de app) — o tenant vem do próprio Invite já validado
  // acima, nunca de dado enviado pelo cliente.
  const user = await withTenant(
    async (tx) => {
      await tx.invite.update({ where: { id: invite.id }, data: { status: "ACEITO", acceptedAt: new Date() } });

      // Quem já esteve nesta empresa tem linha com leftAt preenchido:
      // reativar respeita a unique (authUserId, companyId), que um create
      // violaria, e preserva o histórico.
      const previous = await tx.user.findFirst({
        where: { authUserId, companyId: invite.companyId },
        select: { id: true },
      });

      if (previous) {
        return tx.user.update({
          where: { id: previous.id },
          data: { leftAt: null, isActive: true, role, memberId: invite.memberId, email: invite.email },
        });
      }

      return tx.user.create({
        data: {
          companyId: invite.companyId,
          email: invite.email,
          // Placeholder até a Fase final do plano (remoção de passwordHash) —
          // a credencial real vive só no Supabase a partir daqui.
          passwordHash: "",
          authUserId,
          role,
          memberId: invite.memberId,
        },
      });
    },
    { explicitCompanyId: invite.companyId },
  );

  await addMembershipToIdentity(authUserId, { userId: user.id, companyId: user.companyId, role: user.role });

  return { id: user.id, email: user.email, role: user.role };
}

export async function setUserActive(companyId: string, requestingUser: RequestingUser, userId: string, isActive: boolean) {
  assertAdmin(requestingUser);

  const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  if (user.id === requestingUser.id && !isActive) {
    throw new ConflictError("Você não pode desativar o seu próprio usuário.");
  }

  return writeWithTenant((tx) => tx.user.update({ where: { id: userId }, data: { isActive } }));
}

// Vincula (ou desvincula, memberId=null) um usuário a um Membro do sistema.
// O vínculo concede automaticamente VISUALIZAR de tudo daquele Membro (ver
// resolveVisibleMemberFilter em scope.util.ts) — não precisa de nenhuma
// atribuição de escopo extra para isso.
export async function linkUserMember(
  companyId: string,
  requestingUser: RequestingUser,
  targetUserId: string,
  memberId: string | null,
) {
  assertAdmin(requestingUser);

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");

  if (memberId) {
    const member = await prisma.member.findFirst({ where: { id: memberId, companyId }, select: { id: true, user: { select: { id: true } } } });
    if (!member) throw new NotFoundError("Membro não encontrado");
    if (member.user && member.user.id !== targetUserId) {
      throw new ConflictError("Este Membro já está vinculado a outro usuário.");
    }
  }

  return writeWithTenant((tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: {
        memberId,
        // Desvincular o Membro também desliga o toggle de Resultados — não
        // faz sentido ficar "true" sem Membro para valer.
        canLaunchOwnMemberResults: memberId ? targetUser.canLaunchOwnMemberResults : false,
      },
      select: { id: true, memberId: true, canLaunchOwnMemberResults: true },
    }),
  );
}

// Libera (ou revoga) lançar/editar Resultados especificamente do Membro já
// vinculado ao usuário — sem isso, o vínculo só concede VISUALIZAR.
export async function setUserResultsToggle(
  companyId: string,
  requestingUser: RequestingUser,
  targetUserId: string,
  canLaunchOwnMemberResults: boolean,
) {
  assertAdmin(requestingUser);

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");
  if (!targetUser.memberId) {
    throw new ConflictError("Usuário não está vinculado a um Membro.");
  }

  return writeWithTenant((tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { canLaunchOwnMemberResults },
      select: { id: true, canLaunchOwnMemberResults: true },
    }),
  );
}

// Exclusão real, mas bloqueada se o usuário tiver qualquer rastro histórico
// no sistema (mesmo padrão de "não é possível excluir: já em uso" usado em
// outros pontos do código) — nesse caso o Admin deve desativar em vez de
// excluir.
export async function deleteUser(companyId: string, requestingUser: RequestingUser, targetUserId: string) {
  assertAdmin(requestingUser);

  if (targetUserId === requestingUser.id) {
    throw new ConflictError("Você não pode excluir o seu próprio usuário.");
  }

  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, companyId },
    select: { id: true, role: true, isActive: true },
  });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");

  if (targetUser.role === "ADMINISTRADOR") {
    const activeAdmins = await prisma.user.count({ where: { companyId, role: "ADMINISTRADOR", isActive: true } });
    if (targetUser.isActive && activeAdmins <= 1) {
      throw new ConflictError("Não é possível excluir o último Administrador ativo da empresa.");
    }
  }

  // Usuário é só um ACESSO (login) — nunca dono de dado de negócio. Os
  // Resultados/Ajustes/Fechamentos/Auditorias ficam sempre no cadastro do
  // MEMBRO (Member), nunca no Usuário; é o Membro, não o Usuário, que fica
  // travado em "só desativar" quando tem Resultado vinculado (ver
  // deleteMember em estrutura-organizacional.service.ts). Por isso a
  // exclusão do Usuário nunca é bloqueada por histórico de ações: toda FK
  // de autoria em User (Invite.invitedByUserId/OperationalAdjustment.
  // createdByUserId/MemberClosing.closedByUserId/ClosureAuditLog.userId) é
  // opcional com onDelete: SetNull — excluir o Usuário só limpa a
  // atribuição de "quem fez" nesses registros, sem apagar Convite/Ajuste/
  // Fechamento/Auditoria nenhum.
  await withTenant(async (tx) => {
    await tx.userScopeAssignment.deleteMany({ where: { companyId, userId: targetUserId } });
    await tx.user.delete({ where: { id: targetUserId } });
  });
}

// ============================================================
// Empresa
// ============================================================

export async function updateCompany(companyId: string, requestingUser: RequestingUser, name: string) {
  assertAdmin(requestingUser);
  return writeWithTenant((tx) => tx.company.update({ where: { id: companyId }, data: { name } }));
}

// ============================================================
// Papel (Admin/Gestor/Usuário) de um usuário já existente
// ============================================================

export async function updateUserRole(
  companyId: string,
  requestingUser: RequestingUser,
  targetUserId: string,
  newRole: PermissionLevel,
) {
  assertAdmin(requestingUser);

  if (targetUserId === requestingUser.id) {
    throw new ConflictError("Você não pode alterar o seu próprio nível de permissão.");
  }

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");

  if (targetUser.role === "ADMINISTRADOR" && newRole !== "ADMINISTRADOR") {
    const activeAdmins = await prisma.user.count({ where: { companyId, role: "ADMINISTRADOR", isActive: true } });
    if (activeAdmins <= 1) {
      throw new ConflictError("Não é possível rebaixar o último Administrador ativo da empresa.");
    }
  }

  // Atribuições de escopo existentes não são apagadas na troca de papel —
  // só a semântica delas muda (virar Gestor força EDITAR na próxima vez que
  // as atribuições forem salvas; virar Usuário deixa os níveis como estão,
  // livres para editar depois).
  return writeWithTenant((tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: { id: true, email: true, role: true },
    }),
  );
}

// Admin altera o e-mail de login de QUALQUER outro usuário da empresa —
// mesma restrição de auto-alvo (não pode mirar em si mesmo, usa a rota de
// perfil próprio). O e-mail agora é
// único GLOBALMENTE (identidade no Supabase Auth, não mais
// User.@@unique([companyId, email]) como fonte de login) — trocar o e-mail
// da identidade afeta todas as empresas em que ela tem membership, então a
// checagem de duplicidade é global, não mais restrita a esta empresa.
export async function adminSetUserEmail(
  companyId: string,
  requestingUser: RequestingUser,
  targetUserId: string,
  newEmail: string,
) {
  assertAdmin(requestingUser);

  if (targetUserId === requestingUser.id) {
    throw new ConflictError("Use a tela do seu próprio perfil para alterar o seu e-mail.");
  }

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");
  if (!targetUser.authUserId) {
    throw new ConflictError("Este usuário ainda não migrou para o novo login — peça para ele aceitar o convite novamente.");
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(targetUser.authUserId, {
    email: newEmail,
    email_confirm: true,
  });
  if (error) {
    throw new ConflictError(`Falha ao alterar e-mail: ${error.message}`);
  }

  return writeWithTenant((tx) =>
    tx.user.update({ where: { id: targetUserId }, data: { email: newEmail }, select: { id: true, email: true } }),
  );
}

// ============================================================
// Atribuições de escopo (Gestor/Usuário) — substituem o antigo
// UserPermissionSettings.metasVisibilityScope (teto único) por múltiplas
// hierarquias/membros, cada um com seu próprio nível.
// ============================================================

export async function listUserScopeAssignments(companyId: string, requestingUser: RequestingUser, targetUserId: string) {
  assertAdmin(requestingUser);

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");

  const assignments = await prisma.userScopeAssignment.findMany({
    where: { companyId, userId: targetUserId },
    orderBy: { id: "asc" },
  });

  return Promise.all(
    assignments.map(async (assignment) => ({
      id: assignment.id,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      scopeName: await resolveScopeName(companyId, assignment.scopeType, assignment.scopeId),
      accessLevel: assignment.accessLevel,
    })),
  );
}

export interface ScopeAssignmentInput {
  scopeType: OrgScopeType;
  scopeId: string | null;
  accessLevel: AccessLevel;
}

export async function replaceUserScopeAssignments(
  companyId: string,
  requestingUser: RequestingUser,
  targetUserId: string,
  assignments: ScopeAssignmentInput[],
) {
  assertAdmin(requestingUser);

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!targetUser) throw new NotFoundError("Usuário não encontrado");
  if (targetUser.role === "ADMINISTRADOR") {
    throw new ConflictError("Administradores têm acesso irrestrito — não há o que configurar.");
  }

  const seen = new Set<string>();
  for (const assignment of assignments) {
    const key = `${assignment.scopeType}:${assignment.scopeId ?? ""}`;
    if (seen.has(key)) {
      throw new ConflictError("Uma mesma hierarquia/Membro não pode ser atribuído mais de uma vez.");
    }
    seen.add(key);
    await assertScopeEntityExists(companyId, assignment.scopeType, assignment.scopeId);
  }

  // Gestor: toda atribuição é EDITAR, sempre — a UI nem oferece o seletor de
  // nível para esse papel, mas o backend força de qualquer forma (defesa em
  // profundidade, nunca confiar só na UI).
  const isGestor = targetUser.role === "LIDERANCA_NO";
  const normalized = assignments.map((assignment) => ({
    ...assignment,
    accessLevel: isGestor ? ("EDITAR" as AccessLevel) : assignment.accessLevel,
  }));

  await withTenant(async (tx) => {
    await tx.userScopeAssignment.deleteMany({ where: { companyId, userId: targetUserId } });
    if (normalized.length > 0) {
      await tx.userScopeAssignment.createMany({
        data: normalized.map((assignment) => ({
          companyId,
          userId: targetUserId,
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeId,
          accessLevel: assignment.accessLevel,
        })),
      });
    }
  });

  return listUserScopeAssignments(companyId, requestingUser, targetUserId);
}

// Atribuições do próprio requisitante — usado pelo front para saber o que
// ELE MESMO pode ver/editar (esconder ações, restringir seletores), sem
// precisar do endpoint Admin-only acima.
export async function getMyScopeAssignments(companyId: string, requestingUser: RequestingUser) {
  if (requestingUser.role === "ADMINISTRADOR") return [];

  const assignments = await prisma.userScopeAssignment.findMany({
    where: { companyId, userId: requestingUser.id },
    orderBy: { id: "asc" },
  });

  return Promise.all(
    assignments.map(async (assignment) => ({
      id: assignment.id,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      scopeName: await resolveScopeName(companyId, assignment.scopeType, assignment.scopeId),
      accessLevel: assignment.accessLevel,
    })),
  );
}

// ============================================================
// Auto-atendimento (qualquer usuário logado)
// ============================================================

export async function getMyProfile(companyId: string, requestingUser: RequestingUser) {
  const user = await prisma.user.findFirst({
    where: { id: requestingUser.id, companyId },
    select: {
      id: true,
      email: true,
      role: true,
      canLaunchOwnMemberResults: true,
      member: { select: { id: true, fullName: true, ...MEMBER_HIERARCHY_INCLUDE } },
      company: { select: { id: true, name: true } },
    },
  });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  return user;
}

export async function changeMyPassword(
  companyId: string,
  requestingUser: RequestingUser,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findFirst({ where: { id: requestingUser.id, companyId } });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  if (!user.authUserId) {
    throw new ConflictError("Este usuário ainda não migrou para o novo login — peça para ele aceitar o convite novamente.");
  }

  // Valida a senha atual reautenticando via Supabase — é a única forma de
  // confirmar posse de uma senha que o backend não guarda mais.
  const { error: signInError } = await supabaseAuth.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) {
    throw new UnauthorizedError("Senha atual incorreta.");
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.authUserId, { password: newPassword });
  if (error) {
    throw new ConflictError(`Falha ao alterar senha: ${error.message}`);
  }
}
