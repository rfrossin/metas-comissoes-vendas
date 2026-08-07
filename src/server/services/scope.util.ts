import { prisma } from "../config/prisma";
import { Prisma, type AccessLevel, type OrgScopeType } from "@prisma/client";
import { ForbiddenError } from "../utils/http-errors";
import { buildMemberScopeFilter } from "./bases-metas.service";

export { buildMemberScopeFilter };

export interface RequestingUser {
  id: string;
  companyId: string;
  role: string;
}

export interface AncestorIds {
  memberId: string | null;
  teamId: string | null;
  departmentId: string | null;
  channelId: string | null;
}

// Sobe a hierarquia a partir de (entityType, entityId) e devolve o id de
// cada nível ancestral — usado para preencher as colunas de ancestralidade
// denormalizadas de GoalLine (ver comentário no schema), que permitem
// consultas indexadas por Canal/Departamento/Time/Membro sem reconstruir a
// árvore em memória. Cada coluna só fica preenchida quando faz sentido para
// o entityType de origem: uma Linha de Canal não tem teamId/memberId; uma
// de Empresa não tem nenhuma (a própria companyId já basta pra alcançar
// tudo).
export async function resolveAncestorIds(
  companyId: string,
  entityType: OrgScopeType,
  entityId: string,
): Promise<AncestorIds> {
  const result: AncestorIds = { memberId: null, teamId: null, departmentId: null, channelId: null };

  let currentType: OrgScopeType = entityType;
  let currentId: string | null = entityId;

  if (currentType === "MEMBRO" && currentId) {
    result.memberId = currentId;
    const member = await prisma.member.findFirst({ where: { id: currentId, companyId }, select: { teamId: true } });
    currentId = member?.teamId ?? null;
    currentType = "TIME";
  }

  if (currentType === "TIME" && currentId) {
    result.teamId = currentId;
    const team = await prisma.team.findFirst({ where: { id: currentId, companyId }, select: { departmentId: true } });
    currentId = team?.departmentId ?? null;
    currentType = "DEPARTAMENTO";
  }

  if (currentType === "DEPARTAMENTO" && currentId) {
    result.departmentId = currentId;
    const department = await prisma.department.findFirst({ where: { id: currentId, companyId }, select: { channelId: true } });
    currentId = department?.channelId ?? null;
    currentType = "CANAL";
  }

  if (currentType === "CANAL" && currentId) {
    result.channelId = currentId;
  }

  return result;
}

export function assertAdmin(requestingUser: RequestingUser, errorMessage = "Esta ação é exclusiva do Administrador."): void {
  if (requestingUser.role !== "ADMINISTRADOR") {
    throw new ForbiddenError(errorMessage);
  }
}

export async function resolveRequesterMemberId(companyId: string, requestingUser: RequestingUser): Promise<string | null> {
  const requester = await prisma.user.findFirst({ where: { id: requestingUser.id, companyId }, select: { memberId: true } });
  return requester?.memberId ?? null;
}

export interface RequesterMemberLink {
  memberId: string | null;
  canLaunchOwnMemberResults: boolean;
}

export async function resolveRequesterMemberLink(companyId: string, requestingUser: RequestingUser): Promise<RequesterMemberLink> {
  const requester = await prisma.user.findFirst({
    where: { id: requestingUser.id, companyId },
    select: { memberId: true, canLaunchOwnMemberResults: true },
  });
  return { memberId: requester?.memberId ?? null, canLaunchOwnMemberResults: requester?.canLaunchOwnMemberResults ?? false };
}

// ============================================================
// UserScopeAssignment — atribuições de escopo de Gestor (LIDERANCA_NO) e
// Usuário (OPERACIONAL). Cada linha é uma hierarquia (CANAL/DEPARTAMENTO/
// TIME) ou um Membro específico, com um nível (VISUALIZAR/EDITAR) que vale
// para todos os módulos aplicáveis daquela seleção — não é por módulo.
//
// Para Gestor, toda linha vale implicitamente como EDITAR (a UI nem
// oferece VISUALIZAR para esse papel) — os helpers abaixo tratam essa
// regra centralizadamente, então quem chama nunca precisa se preocupar com
// isso.
// ============================================================

type Assignment = { scopeType: OrgScopeType; scopeId: string | null; accessLevel: AccessLevel };

export async function resolveUserAssignments(companyId: string, userId: string): Promise<Assignment[]> {
  return prisma.userScopeAssignment.findMany({
    where: { companyId, userId },
    select: { scopeType: true, scopeId: true, accessLevel: true },
  });
}

// ============================================================
// Atribuição de hierarquia → filtro de Membro.
//
// Regra confirmada com o usuário (2026-08-06): uma atribuição de HIERARQUIA
// (CANAL/DEPARTAMENTO/TIME) alcança TODOS os Membros abaixo dela, incluindo
// os Líderes/Responsáveis (NodeResponsible) — tanto os dos nós descendentes
// quanto o do próprio nó atribuído. buildMemberScopeFilter já resolve isso
// inteiro (o ramo nodeResponsibleFor de cada nível cobre os líderes), então
// não há nada a somar nem a excluir aqui.
//
// Histórico: existia uma "exclusão de líder" que removia do escopo o Líder
// do próprio nó atribuído. Ela era a causa de um Gestor com o Departamento
// 01.01 não enxergar os líderes dos Times abaixo em Membros/Fechamento/
// Recebíveis, e foi removida por contrariar a regra de negócio.
// ============================================================

// Monta o OR das atribuições já no nível mínimo desejado — EDITAR sempre
// serve para minLevel=VISUALIZAR (poder editar implica poder ver).
// scopeType=EMPRESA em qualquer atribuição é atalho para "ALL". Sem nenhuma
// atribuição utilizável, devolve um filtro que não casa com nenhum Membro
// real (sem piso implícito).
function assignmentsToMemberFilter(assignments: Assignment[], minLevel: AccessLevel): Prisma.MemberWhereInput | "ALL" {
  const usable = minLevel === "VISUALIZAR" ? assignments : assignments.filter((a) => a.accessLevel === "EDITAR");
  if (usable.some((a) => a.scopeType === "EMPRESA")) return "ALL";
  if (usable.length === 0) return { id: "__sem_atribuicao__" };

  return { OR: usable.map((a) => buildMemberScopeFilter(a.scopeType, a.scopeId)) };
}

// Escopo de um Gestor: união de todas as suas atribuições + sempre o
// próprio Membro.
//
// Regra confirmada com o usuário (2026-08-06): uma atribuição de hierarquia
// dá ao Gestor acesso a TODOS os Membros abaixo dela — inclusive os
// Líderes/Responsáveis do próprio nó atribuído. A antiga "exclusão de
// líder" (buildAssignmentMemberFilter) removia exatamente essas pessoas do
// escopo, que é o oposto do que a regra de negócio pede: quem recebe o
// Departamento 01.01 precisa enxergar e gerenciar os Times abaixo E seus
// líderes. Por isso o escopo do Gestor usa buildMemberScopeFilter direto
// (puramente estrutural), sem exclusão.
//
// O que continua protegido: o Gestor não EDITA os próprios Recebíveis/
// Fechamentos (só visualiza) — isso é tratado por assertNotSelfManaging nos
// pontos de escrita, não removendo-o do escopo de leitura.
async function resolveGestorMemberFilter(
  companyId: string,
  requestingUserId: string,
  leaderMemberId: string,
): Promise<Prisma.MemberWhereInput | "ALL"> {
  const assignments = await resolveUserAssignments(companyId, requestingUserId);
  if (assignments.some((a) => a.scopeType === "EMPRESA")) return "ALL";

  const scopeFilters = assignments.map((a) => buildMemberScopeFilter(a.scopeType, a.scopeId));
  return { OR: [{ id: leaderMemberId }, ...scopeFilters] };
}

// Escopo nativo dos módulos FINANCEIROS (Recebíveis, Bases de Recebível e
// Fechamento) — regra confirmada com o usuário (2026-08-06), definida pelo
// TIPO do usuário, não por módulo:
//
// - ADMINISTRADOR: tudo.
// - LIDERANCA_NO: todos os Membros abaixo das hierarquias atribuídas a ele
//   (visualizar E editar), mais o próprio Membro — este último só para
//   VISUALIZAR (a trava de escrita é assertNotSelfManaging, aplicada nos
//   pontos de gravação).
// - OPERACIONAL: SEMPRE só o próprio Membro. Uma atribuição dada a um
//   Operador vale para Resultados/Metas/Acompanhamento, mas nunca libera
//   Recebíveis/Bases/Fechamento de terceiros — dado financeiro de outra
//   pessoa exige o tipo Liderança de Nó.
export async function resolveNativeVisibleMemberFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.MemberWhereInput | "ALL"> {
  if (requestingUser.role === "ADMINISTRADOR") return "ALL";

  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) return { id: "__sem_membro_vinculado__" };

  if (requestingUser.role === "LIDERANCA_NO") {
    return resolveGestorMemberFilter(companyId, requestingUser.id, memberId);
  }
  return { id: memberId };
}

// Escopo de visão configurável: Admin tudo; Gestor/Usuário = união de
// atribuições (líder-aware) + sempre o próprio Membro vinculado, se houver
// (vínculo concede VISUALIZAR automático de tudo do Membro, mesmo sem
// nenhuma atribuição — regra de negócio confirmada). Usado por Metas/
// Acompanhamento/Resultados (leitura).
export async function resolveVisibleMemberFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.MemberWhereInput | "ALL"> {
  if (requestingUser.role === "ADMINISTRADOR") return "ALL";

  const linkedMemberId = await resolveRequesterMemberId(companyId, requestingUser);

  if (requestingUser.role === "LIDERANCA_NO") {
    if (!linkedMemberId) return { id: "__sem_membro_vinculado__" };
    return resolveGestorMemberFilter(companyId, requestingUser.id, linkedMemberId);
  }

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  const assignmentFilter = assignmentsToMemberFilter(assignments, "VISUALIZAR");
  if (assignmentFilter === "ALL") return "ALL";
  if (!linkedMemberId) return assignmentFilter;
  return { OR: [assignmentFilter, { id: linkedMemberId }] };
}

// Escopo de escrita configurável: igual ao de visão, mas só o que o
// Usuário tem como EDITAR conta (Gestor continua igual — pra ele, ver e
// editar são a mesma coisa). O Membro vinculado NÃO entra aqui por padrão —
// vínculo só concede VISUALIZAR; EDITAR de Metas/Recebíveis do Membro
// vinculado exige atribuição explícita (ver resolveResultsEditableMemberFilter
// para a exceção específica de Resultados, controlada por
// User.canLaunchOwnMemberResults). Usado por Resultados (lançamento) e por
// Bases de Recebível/Fechamento (Gestor).
export async function resolveEditableMemberFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.MemberWhereInput | "ALL"> {
  if (requestingUser.role === "ADMINISTRADOR") return "ALL";

  if (requestingUser.role === "LIDERANCA_NO") {
    const memberId = await resolveRequesterMemberId(companyId, requestingUser);
    if (!memberId) return { id: "__sem_membro_vinculado__" };
    return resolveGestorMemberFilter(companyId, requestingUser.id, memberId);
  }

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  return assignmentsToMemberFilter(assignments, "EDITAR");
}

// Igual a resolveEditableMemberFilter, mas com uma exceção só para
// Resultados: se o requisitante tem um Membro vinculado E o Admin liberou
// User.canLaunchOwnMemberResults para ele, esse Membro entra no escopo de
// escrita — mesmo sem nenhuma atribuição de hierarquia cobrindo-o. Usado
// exclusivamente por resultados.service.ts (assertCanMutateResults); não
// afeta Metas/Recebíveis/Fechamento.
export async function resolveResultsEditableMemberFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.MemberWhereInput | "ALL"> {
  const base = await resolveEditableMemberFilter(companyId, requestingUser);
  if (base === "ALL" || requestingUser.role === "ADMINISTRADOR") return base;

  const link = await resolveRequesterMemberLink(companyId, requestingUser);
  if (!link.memberId || !link.canLaunchOwnMemberResults) return base;

  return { OR: [base, { id: link.memberId }] };
}

// Trava de auto-gestão financeira (regra confirmada em 2026-08-06): um
// Gestor VÊ os próprios Recebíveis/Fechamentos, mas nunca os ALTERA — quem
// fecha/reabre/edita o benefício de um Gestor é sempre um Administrador.
// Vale só para escrita: o próprio Membro continua no escopo de leitura
// (resolveGestorMemberFilter), por isso a trava mora nos pontos de gravação
// em vez de remover a pessoa do filtro.
//
// ADMINISTRADOR passa sempre (pode tudo, inclusive sobre si mesmo).
// OPERACIONAL nunca chega aqui: já é barrado antes por não ter escrita
// nesses módulos.
export async function assertNotSelfManaging(
  companyId: string,
  requestingUser: RequestingUser,
  targetMemberIds: string[],
  errorMessage = "Você não pode alterar os seus próprios Recebíveis/Fechamentos. Peça a um Administrador.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;

  const ownMemberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (ownMemberId && targetMemberIds.includes(ownMemberId)) {
    throw new ForbiddenError(errorMessage);
  }
}

async function assertMembersWithinFilter(
  companyId: string,
  targetMemberIds: string[],
  filter: Prisma.MemberWhereInput | "ALL",
  errorMessage: string,
): Promise<void> {
  if (targetMemberIds.length === 0) return;
  if (filter === "ALL") return;

  // AND (não spread): filter pode ter sua própria chave "id" (ex.: escopo
  // OPERACIONAL = { id: memberId }), que sobrescreveria silenciosamente o
  // "id: { in: targetMemberIds }" se fosse espalhado no mesmo objeto.
  const allowedCount = await prisma.member.count({
    where: { companyId, AND: [{ id: { in: targetMemberIds } }, filter] },
  });
  if (allowedCount !== targetMemberIds.length) {
    throw new ForbiddenError(errorMessage);
  }
}

// Valida os targetMemberIds contra o escopo NATIVO (fixo) — Recebíveis,
// Fechamento.
export async function assertNativeVisibleMembers(
  companyId: string,
  requestingUser: RequestingUser,
  targetMemberIds: string[],
  errorMessage = "Você não tem permissão para consultar dados de um ou mais Membros selecionados.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  const filter = await resolveNativeVisibleMemberFilter(companyId, requestingUser);
  await assertMembersWithinFilter(companyId, targetMemberIds, filter, errorMessage);
}

// Valida os targetMemberIds contra o escopo de VISÃO configurável — Metas,
// Acompanhamento, Resultados (leitura).
export async function assertVisibleMembers(
  companyId: string,
  requestingUser: RequestingUser,
  targetMemberIds: string[],
  errorMessage = "Você não tem permissão para consultar dados de um ou mais Membros selecionados.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  const filter = await resolveVisibleMemberFilter(companyId, requestingUser);
  await assertMembersWithinFilter(companyId, targetMemberIds, filter, errorMessage);
}

// Valida os targetMemberIds contra o escopo de ESCRITA configurável —
// Resultados (lançamento), Bases de Recebível/Fechamento (Gestor).
export async function assertEditableMembers(
  companyId: string,
  requestingUser: RequestingUser,
  targetMemberIds: string[],
  errorMessage = "Você não tem permissão para alterar dados de um ou mais Membros selecionados.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  const filter = await resolveEditableMemberFilter(companyId, requestingUser);
  await assertMembersWithinFilter(companyId, targetMemberIds, filter, errorMessage);
}

// Igual a assertEditableMembers, mas usando resolveResultsEditableMemberFilter
// (inclui o Membro vinculado quando User.canLaunchOwnMemberResults está
// ligado) — usado só por resultados.service.ts.
export async function assertResultsEditableMembers(
  companyId: string,
  requestingUser: RequestingUser,
  targetMemberIds: string[],
  errorMessage = "Você não tem permissão para alterar dados de um ou mais Membros selecionados.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  const filter = await resolveResultsEditableMemberFilter(companyId, requestingUser);
  await assertMembersWithinFilter(companyId, targetMemberIds, filter, errorMessage);
}

// Valida entidades de Escopo (Canal/Departamento/Time/Membro/Empresa), não
// IDs de Membro diretos — usado por Metas e Acompanhamento, cujos filtros
// selecionam um nível (entityType) + vários IDs naquele nível.
//
// PASSO 11.3: CANAL/DEPARTAMENTO/TIME/EMPRESA passaram a ser validados por
// ALCANÇABILIDADE DE NÓ (resolveVisibleNodeIds — mesma infra líder-aware do
// PASSO 9.1: meu(s) nó(s) atribuído(s) + descendentes), não mais exigindo
// que 100% dos Membros estruturais daquele nó estejam individualmente
// visíveis. A versão anterior (comparar totalInScope contra visibleInScope)
// tinha 2 problemas: (1) vazava Departamento/Canal inteiros pra quem só
// tinha Time atribuído, porque contava qualquer Membro estrutural — mesmo
// bug do PASSO 11.2, só que aqui pelo lado do "total"; (2) bloqueava uma
// Entidade legitimamente atribuída sempre que o próprio Líder do nó também
// fosse estruturalmente Membro dele — a exclusão de líder do PASSO 7 (pensada
// pra checagens de MEMBRO individual) removia 1 Membro do lado
// "visibleInScope" e a comparação de cobertura 100% falhava, mesmo a
// atribuição de hierarquia cobrindo o nó inteiro. Entidades sem nenhum
// Membro dentro continuam liberadas (nada sensível pra proteger, mesma
// exceção de antes) mesmo fora do meu escopo de nó. MEMBRO continua sendo
// checado individualmente (não faz parte deste ajuste — nunca teve esses 2
// problemas).
export async function assertVisibleScope(
  companyId: string,
  requestingUser: RequestingUser,
  entities: { entityType: OrgScopeType; entityId: string }[],
  errorMessage = "Você não tem permissão para consultar dados de uma ou mais entidades selecionadas.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  if (entities.length === 0) return;

  const nodeIds = await resolveVisibleNodeIds(companyId, requestingUser);
  let memberFilter: Prisma.MemberWhereInput | "ALL" | undefined;

  for (const entity of entities) {
    if (entity.entityType === "EMPRESA") {
      if (nodeIds.channelIds === "ALL") continue;
      throw new ForbiddenError(errorMessage);
    }

    if (entity.entityType === "MEMBRO") {
      memberFilter ??= await resolveVisibleMemberFilter(companyId, requestingUser);
      if (memberFilter === "ALL") continue;
      const count = await prisma.member.count({ where: { companyId, id: entity.entityId, ...memberFilter } });
      if (count === 0) throw new ForbiddenError(errorMessage);
      continue;
    }

    const idsForLevel =
      entity.entityType === "CANAL" ? nodeIds.channelIds : entity.entityType === "DEPARTAMENTO" ? nodeIds.departmentIds : nodeIds.teamIds;
    if (idsForLevel === "ALL" || idsForLevel.has(entity.entityId)) continue;

    const totalInScope = await prisma.member.count({ where: { companyId, ...buildMemberScopeFilter(entity.entityType, entity.entityId) } });
    if (totalInScope === 0) continue;
    throw new ForbiddenError(errorMessage);
  }
}

// Trava de Bases de Recebível: OPERACIONAL (Usuário) nunca acessa o módulo
// (nem leitura, nem escrita — "travada e não acessível"); ADMINISTRADOR
// sempre passa; LIDERANCA_NO (Gestor) só se TODOS os beneficiários da Base
// estão dentro da hierarquia que ele lidera — não depende mais de quem
// criou a Base (assertOwnedOrAdmin). Lista de beneficiários vazia (Base
// recém-criada) sempre passa para o Gestor.
export type ReceivablesBaseAccessLevel = "FULL" | "PARTIAL" | "NONE";

export interface ReceivablesBaseAccess {
  level: ReceivablesBaseAccessLevel;
  // Só os beneficiários (dentre os passados) que o requisitante gerencia —
  // vazio para ADMINISTRADOR/FULL (não precisa filtrar nada) ou NONE.
  ownedMemberIds: Set<string>;
}

// Resolve o nível de acesso do requisitante a uma Base de Recebível dado o
// conjunto de beneficiários dela: FULL (Admin, ou Gestor com TODOS os
// beneficiários no seu escopo — inclusive Base vazia, sem beneficiário
// nenhum ainda) permite gerenciar a Base inteira; PARTIAL (Gestor com
// ALGUNS beneficiários no escopo) permite abrir o detalhe e mexer só no que
// é dele (ver assertConditionalTriggerOwnership); NONE (Usuário, ou Gestor
// sem nenhum beneficiário no escopo) bloqueia tudo.
export async function resolveReceivablesBaseAccess(
  companyId: string,
  requestingUser: RequestingUser,
  allBeneficiaryMemberIds: string[],
): Promise<ReceivablesBaseAccess> {
  if (requestingUser.role === "ADMINISTRADOR") {
    return { level: "FULL", ownedMemberIds: new Set(allBeneficiaryMemberIds) };
  }
  if (requestingUser.role === "OPERACIONAL") {
    return { level: "NONE", ownedMemberIds: new Set() };
  }
  if (allBeneficiaryMemberIds.length === 0) {
    return { level: "FULL", ownedMemberIds: new Set() };
  }

  const editableFilter = await resolveEditableMemberFilter(companyId, requestingUser);

  // O próprio Membro do Gestor nunca é "gerenciável por ele mesmo" (só
  // visualizável) — se ele for beneficiário da própria Base, essa linha sai
  // do conjunto editável e a Base cai para PARTIAL, deixando-o mexer no
  // resto da equipe sem se auto-editar.
  const ownMemberId = await resolveRequesterMemberId(companyId, requestingUser);
  const manageable = allBeneficiaryMemberIds.filter((id) => id !== ownMemberId);

  if (editableFilter === "ALL") {
    const ownedMemberIds = new Set(manageable);
    if (manageable.length === allBeneficiaryMemberIds.length) return { level: "FULL", ownedMemberIds };
    return { level: ownedMemberIds.size === 0 ? "NONE" : "PARTIAL", ownedMemberIds };
  }

  const allowedMembers = await prisma.member.findMany({
    where: { companyId, AND: [{ id: { in: manageable } }, editableFilter] },
    select: { id: true },
  });
  const ownedMemberIds = new Set(allowedMembers.map((m) => m.id));

  if (ownedMemberIds.size === 0) return { level: "NONE", ownedMemberIds };
  if (ownedMemberIds.size === allBeneficiaryMemberIds.length) return { level: "FULL", ownedMemberIds };
  return { level: "PARTIAL", ownedMemberIds };
}

// Trava de ações que exigem gerenciar a Base INTEIRA (cabeçalho, status,
// exclusão, roster de beneficiários, Degraus) — nunca parcial, mesmo para
// Gestor: alterar essas coisas afeta beneficiários fora do escopo dele.
export async function assertReceivablesBaseWithinScope(
  companyId: string,
  requestingUser: RequestingUser,
  beneficiaryMemberIds: string[],
  errorMessage = "Você não tem permissão para alterar esta Base de Recebível.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  if (requestingUser.role === "OPERACIONAL") {
    throw new ForbiddenError(errorMessage);
  }
  await assertEditableMembers(companyId, requestingUser, beneficiaryMemberIds, errorMessage);
  // Alterar a Base inteira alcançaria também a linha do próprio Gestor —
  // que ele só pode visualizar. Ver assertNotSelfManaging.
  await assertNotSelfManaging(companyId, requestingUser, beneficiaryMemberIds);
}

// Mesma ideia de assertVisibleScope, mas contra o escopo de ESCRITA.
export async function assertEditableScope(
  companyId: string,
  requestingUser: RequestingUser,
  entities: { entityType: OrgScopeType; entityId: string }[],
  errorMessage = "Você não tem permissão para alterar dados de uma ou mais entidades selecionadas.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  if (entities.length === 0) return;

  const editableFilter = await resolveEditableMemberFilter(companyId, requestingUser);
  if (editableFilter === "ALL") return;

  for (const entity of entities) {
    const scopeFilter = buildMemberScopeFilter(entity.entityType, entity.entityId);
    const [totalInScope, editableInScope] = await Promise.all([
      prisma.member.count({ where: { companyId, ...scopeFilter } }),
      prisma.member.count({ where: { companyId, AND: [scopeFilter, editableFilter] } }),
    ]);
    if (totalInScope === 0) continue;
    if (editableInScope !== totalInScope) {
      throw new ForbiddenError(errorMessage);
    }
  }
}

// ============================================================
// Travas de ESCRITA em nós/entidades da árvore organizacional.
// ============================================================

function matchesAncestor(assignment: Assignment, ancestors: AncestorIds): boolean {
  switch (assignment.scopeType) {
    case "CANAL":
      return ancestors.channelId === assignment.scopeId;
    case "DEPARTAMENTO":
      return ancestors.departmentId === assignment.scopeId;
    case "TIME":
      return ancestors.teamId === assignment.scopeId;
    case "MEMBRO":
      return ancestors.memberId === assignment.scopeId;
    default:
      return false;
  }
}

async function isNodeAllowed(
  companyId: string,
  assignments: Assignment[],
  nodeType: OrgScopeType,
  nodeId: string | null,
): Promise<boolean> {
  if (assignments.some((a) => a.scopeType === "EMPRESA")) return true;

  const ancestors = nodeType === "EMPRESA" || !nodeId ? null : await resolveAncestorIds(companyId, nodeType, nodeId);
  return !!ancestors && assignments.some((a) => matchesAncestor(a, ancestors));
}

async function assertNodeAllowed(
  companyId: string,
  assignments: Assignment[],
  nodeType: OrgScopeType,
  nodeId: string | null,
  errorMessage: string,
): Promise<void> {
  const allowed = await isNodeAllowed(companyId, assignments, nodeType, nodeId);
  if (!allowed) throw new ForbiddenError(errorMessage);
}

// Generaliza o escopo nativo de LIDERANCA_NO para NÓS da árvore (Canal/
// Departamento/Time/Membro), não só Membros — usado para gerenciar Membros
// dentro de hierarquias já existentes (adicionar/remover, editar salário
// fixo e Cargo) em Estrutura Organizacional. nodeId é o próprio nó (editar/
// excluir) ou o nó-pai (criar um filho dentro dele). ADMINISTRADOR sempre
// passa; OPERACIONAL nunca tem escrita aqui (Usuário nunca edita Estrutura
// Organizacional, só visualiza).
export async function assertNodeWithinLedScope(
  companyId: string,
  requestingUser: RequestingUser,
  nodeType: OrgScopeType,
  nodeId: string | null,
  errorMessage = "Você só pode alterar dados dentro da hierarquia que você lidera.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  if (requestingUser.role !== "LIDERANCA_NO") {
    throw new ForbiddenError(errorMessage);
  }

  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) throw new ForbiddenError(errorMessage);

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  await assertNodeAllowed(companyId, assignments, nodeType, nodeId, errorMessage);
}

// Trava de escrita sobre um MEMBRO da Estrutura Organizacional.
//
// Um Membro pode estar na árvore de duas formas, e as duas contam:
//   1. estruturalmente, pelo Time a que pertence (Canal > Dep > Time);
//   2. pela LIDERANÇA que exerce — o líder de um Time está em Canal > Dep >
//      Time; o de um Departamento, em Canal > Departamento.
//
// Só a forma (1) era considerada, e um Gestor típico não tem Time (lidera
// o nó, não pertence a ele): member.teamId vinha null, isNodeAllowed
// devolvia false direto no `!nodeId` e ninguém além do Admin conseguia
// editá-lo — nem o Gestor do Departamento logo acima. Regra confirmada com
// o usuário (2026-08-07): quem tem atribuição num Departamento alcança os
// líderes dos Times dentro dele e o líder do próprio Departamento.
//
// Basta UM dos caminhos cair dentro do escopo. Membro sem Time e sem
// liderança nenhuma continua sendo exclusividade do Admin — não há nó pelo
// qual ancorá-lo.
export async function assertMemberWithinLedScope(
  companyId: string,
  requestingUser: RequestingUser,
  member: { id: string; teamId: string | null },
  errorMessage = "Você só pode alterar dados dentro da hierarquia que você lidera.",
): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;
  if (requestingUser.role !== "LIDERANCA_NO") {
    throw new ForbiddenError(errorMessage);
  }

  const requesterMemberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!requesterMemberId) throw new ForbiddenError(errorMessage);

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  if (assignments.some((a) => a.scopeType === "EMPRESA")) return;

  // Caminho estrutural (Membro operacional, com Time).
  if (member.teamId && (await isNodeAllowed(companyId, assignments, "TIME", member.teamId))) return;

  // Caminho da liderança (Gestor, normalmente sem Time): cada nó liderado
  // é testado como se fosse a posição dele na árvore.
  const ledNodes = await prisma.nodeResponsible.findMany({
    where: { companyId, memberId: member.id },
    select: { nodeType: true, channelId: true, departmentId: true, teamId: true },
  });

  for (const node of ledNodes) {
    // Liderança de EMPRESA não é alcançável por atribuição de hierarquia
    // (só um Admin, ou uma atribuição EMPRESA, já tratada acima).
    if (node.nodeType === "EMPRESA") continue;

    const nodeId = node.nodeType === "CANAL" ? node.channelId : node.nodeType === "DEPARTAMENTO" ? node.departmentId : node.teamId;
    if (nodeId && (await isNodeAllowed(companyId, assignments, node.nodeType, nodeId))) return;
  }

  throw new ForbiddenError(errorMessage);
}

// Mesma trava de nó, mas também deixa passar um OPERACIONAL cuja
// atribuição EDITAR cobre o nó — usada só onde a spec dá poder de escrita
// explícito ao Usuário: criação/edição de Linha de Meta (GoalLine).
// ADMINISTRADOR sempre passa; LIDERANCA_NO usa todas as atribuições
// (sempre EDITAR); OPERACIONAL só as atribuições com accessLevel=EDITAR.
// Versão não-throwing de assertNodeWithinEditableScope — usada onde
// precisamos saber "o usuário pode editar isso?" pra decidir o que MOSTRAR
// (esconder botão, filtrar 1 Linha fora do escopo ao duplicar Campanha),
// sem abortar a operação inteira por causa de 1 item fora do escopo
// (PASSO 9.7). Mesma regra exata de assertNodeWithinEditableScope, só sem
// lançar erro.
export async function isNodeWithinEditableScope(
  companyId: string,
  requestingUser: RequestingUser,
  nodeType: OrgScopeType,
  nodeId: string | null,
): Promise<boolean> {
  if (requestingUser.role === "ADMINISTRADOR") return true;

  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) return false;

  const allAssignments = await resolveUserAssignments(companyId, requestingUser.id);
  const assignments = requestingUser.role === "LIDERANCA_NO" ? allAssignments : allAssignments.filter((a) => a.accessLevel === "EDITAR");

  return isNodeAllowed(companyId, assignments, nodeType, nodeId);
}

export async function assertNodeWithinEditableScope(
  companyId: string,
  requestingUser: RequestingUser,
  nodeType: OrgScopeType,
  nodeId: string | null,
  errorMessage = "Você só pode criar/editar dentro do que você tem liberado para editar.",
): Promise<void> {
  const allowed = await isNodeWithinEditableScope(companyId, requestingUser, nodeType, nodeId);
  if (!allowed) throw new ForbiddenError(errorMessage);
}

// Escopo liderado como filtro de Membro (em vez de um assert por nó) —
// usado pela aba Membros da Estrutura Organizacional para listar só quem
// está dentro do que o Gestor lidera (protege Salário de quem está fora do
// escopo). Mesma semântica estrutural de assertNodeWithinLedScope/
// assertNodeAllowed (ancestralidade via UserScopeAssignment) — inclui os
// Líderes dos nós abaixo, igual aos demais resolvers.
export async function resolveLedMemberFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.MemberWhereInput | "ALL"> {
  if (requestingUser.role === "ADMINISTRADOR") return "ALL";
  if (requestingUser.role !== "LIDERANCA_NO") return { id: "__sem_acesso__" };

  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  if (assignments.some((a) => a.scopeType === "EMPRESA")) return "ALL";

  const scopeFilters = assignments.map((a) => buildMemberScopeFilter(a.scopeType, a.scopeId));
  const filters = memberId ? [{ id: memberId }, ...scopeFilters] : scopeFilters;
  if (filters.length === 0) return { id: "__sem_atribuicao__" };
  return { OR: filters };
}

// ============================================================
// PASSO 9.1 — conjuntos de NÓS (Canal/Departamento/Time) alcançáveis pelo
// escopo do usuário — usado para podar seletores de hierarquia no
// front-end (TeamSelect, LeadershipEditor, EntityPicker/EntityMultiPicker
// em modo escopado, HierarchyFilter), ao contrário dos resolvers acima que
// devolvem um filtro de MEMBRO.
// ============================================================

export interface ScopeNodeIds {
  channelIds: Set<string> | "ALL";
  departmentIds: Set<string> | "ALL";
  teamIds: Set<string> | "ALL";
}

const EMPTY_SCOPE_NODE_IDS: ScopeNodeIds = { channelIds: new Set(), departmentIds: new Set(), teamIds: new Set() };
const ALL_SCOPE_NODE_IDS: ScopeNodeIds = { channelIds: "ALL", departmentIds: "ALL", teamIds: "ALL" };

// Expande cada atribuição de hierarquia (CANAL/DEPARTAMENTO/TIME) para o
// próprio nó + todos os descendentes — mesmo padrão de travessia de árvore
// já usado em resolveDescendantLeaderMemberIds (PASSO 7), mas devolvendo
// ids de NÓS em vez de ids de Membros líderes. Atribuições MEMBRO são
// ignoradas (um Membro específico não corresponde a nenhum nó de
// hierarquia). Atribuição EMPRESA em qualquer uma delas é atalho pra "ALL".
async function computeScopeNodeIds(companyId: string, assignments: Assignment[]): Promise<ScopeNodeIds> {
  if (assignments.some((a) => a.scopeType === "EMPRESA")) return ALL_SCOPE_NODE_IDS;

  const channelIds = new Set<string>();
  const departmentIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.scopeType === "MEMBRO" || !assignment.scopeId) continue;

    if (assignment.scopeType === "TIME") {
      teamIds.add(assignment.scopeId);
      continue;
    }

    if (assignment.scopeType === "DEPARTAMENTO") {
      departmentIds.add(assignment.scopeId);
      const teams = await prisma.team.findMany({ where: { companyId, departmentId: assignment.scopeId }, select: { id: true } });
      teams.forEach((t) => teamIds.add(t.id));
      continue;
    }

    if (assignment.scopeType === "CANAL") {
      channelIds.add(assignment.scopeId);
      const departments = await prisma.department.findMany({ where: { companyId, channelId: assignment.scopeId }, select: { id: true } });
      departments.forEach((d) => departmentIds.add(d.id));
      const departmentIdList = departments.map((d) => d.id);
      if (departmentIdList.length > 0) {
        const teams = await prisma.team.findMany({ where: { companyId, departmentId: { in: departmentIdList } }, select: { id: true } });
        teams.forEach((t) => teamIds.add(t.id));
      }
    }
  }

  return { channelIds, departmentIds, teamIds };
}

// Escopo liderado (mesmo conceito de resolveLedMemberFilter, em nós): só
// LIDERANCA_NO gerencia Estrutura Organizacional — OPERACIONAL nunca, por
// isso devolve conjunto vazio (e não filtrado por atribuições).
export async function resolveLedNodeIds(companyId: string, requestingUser: RequestingUser): Promise<ScopeNodeIds> {
  if (requestingUser.role === "ADMINISTRADOR") return ALL_SCOPE_NODE_IDS;
  if (requestingUser.role !== "LIDERANCA_NO") return EMPTY_SCOPE_NODE_IDS;

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  return computeScopeNodeIds(companyId, assignments);
}

// Escopo de visão (mesmo conceito de resolveVisibleMemberFilter, em nós):
// qualquer atribuição conta, independente do accessLevel — para Gestor e
// Usuário. Também é o conjunto usado para o modo "native" dos seletores
// escopados: para LIDERANCA_NO, escopo nativo e escopo de visão configurável
// coincidem exatamente na camada de NÓS (a diferença entre
// resolveNativeVisibleMemberFilter e resolveVisibleMemberFilter só aparece
// na inclusão/exclusão de MEMBROS específicos, nunca de nós inteiros); para
// OPERACIONAL, o modo "native" não usa seletor de hierarquia nenhum (a UI já
// trava em "só eu mesmo"), então esta função nunca precisa ser chamada nesse
// caso.
export async function resolveVisibleNodeIds(companyId: string, requestingUser: RequestingUser): Promise<ScopeNodeIds> {
  if (requestingUser.role === "ADMINISTRADOR") return ALL_SCOPE_NODE_IDS;

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  return computeScopeNodeIds(companyId, assignments);
}

// Escopo de escrita (mesmo conceito de resolveEditableMemberFilter, em
// nós): para Usuário, só atribuições EDITAR contam; para Gestor, toda
// atribuição já é EDITAR (ver comentário no topo do arquivo).
export async function resolveEditableNodeIds(companyId: string, requestingUser: RequestingUser): Promise<ScopeNodeIds> {
  if (requestingUser.role === "ADMINISTRADOR") return ALL_SCOPE_NODE_IDS;

  const assignments = await resolveUserAssignments(companyId, requestingUser.id);
  const usable = requestingUser.role === "LIDERANCA_NO" ? assignments : assignments.filter((a) => a.accessLevel === "EDITAR");
  return computeScopeNodeIds(companyId, usable);
}

// Padrão de "dono" para recursos sem entidade estrutural (GoalCampaign,
// ReceivablesBase): ADMINISTRADOR sempre passa; LIDERANCA_NO só se foi ele
// mesmo quem criou o recurso; OPERACIONAL nunca. Função pura (sem I/O) —
// quem chama já buscou o recurso e sabe seu createdByUserId.
export function assertOwnedOrAdmin(
  requestingUser: RequestingUser,
  resourceCreatedByUserId: string | null,
  errorMessage = "Você só pode alterar o que você mesmo criou.",
): void {
  if (requestingUser.role === "ADMINISTRADOR") return;
  if (requestingUser.role === "LIDERANCA_NO" && resourceCreatedByUserId === requestingUser.id) return;
  throw new ForbiddenError(errorMessage);
}
