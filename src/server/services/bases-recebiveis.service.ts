import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import {
  Prisma,
  type OrgScopeType,
  type ReceivablesIndicatorType,
  type ReceivablesPeriodicity,
  type ReceivablesStatus,
  type RewardType,
  type TriggerMode,
} from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { toDate } from "./resultados.service";
import {
  assertEntityBelongsToCompany,
  buildHierarchyPath,
  dailyMapOfActiveLine,
  type DailyMap,
  isoKey,
  resolveAncestorIds,
  resolveEntityName,
  summarizeDailyMap,
} from "./metas.service";
import { getRealizadoDailyMap } from "./bases-metas.service";
import { resolveFixedSalary } from "./cargos.service";
import {
  assertReceivablesBaseWithinScope,
  resolveEditableMemberFilter,
  resolveReceivablesBaseAccess,
  resolveRequesterMemberId,
  type RequestingUser,
} from "./scope.util";

function addDaysUtc(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

// ============================================================
// Janela do Período de Fechamento — todo aferimento de Gatilho Condicional
// e de Degrau/Recompensa é feito dentro da "foto" do período correspondente
// à Periodicidade da Base (Diário/Semanal/Mensal/Trimestral), nunca sobre o
// total acumulado da vigência inteira.
// ============================================================

export interface PeriodWindow {
  start: Date;
  endExclusive: Date;
}

export function resolvePeriodWindow(periodicity: ReceivablesPeriodicity, referenceDate: Date): PeriodWindow {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();

  switch (periodicity) {
    case "DIARIO": {
      const start = new Date(Date.UTC(year, month, day));
      return { start, endExclusive: addDaysUtc(start, 1) };
    }
    case "SEMANAL": {
      const start = new Date(Date.UTC(year, month, day));
      const isoWeekday = start.getUTCDay() === 0 ? 7 : start.getUTCDay(); // 1=Seg..7=Dom
      start.setUTCDate(start.getUTCDate() - (isoWeekday - 1));
      return { start, endExclusive: addDaysUtc(start, 7) };
    }
    case "MENSAL": {
      return { start: new Date(Date.UTC(year, month, 1)), endExclusive: new Date(Date.UTC(year, month + 1, 1)) };
    }
    case "TRIMESTRAL": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        start: new Date(Date.UTC(year, quarterStartMonth, 1)),
        endExclusive: new Date(Date.UTC(year, quarterStartMonth + 3, 1)),
      };
    }
    case "ANUAL": {
      return { start: new Date(Date.UTC(year, 0, 1)), endExclusive: new Date(Date.UTC(year + 1, 0, 1)) };
    }
  }
}

// Gera todas as janelas de Período de Fechamento de uma Periodicidade que se
// sobrepõem a [rangeStart, rangeEndExclusive) — usado pela tela de
// Recebíveis, cujo filtro de Período pode abranger várias janelas de uma
// mesma Base (ex: 3 meses filtrados × Base Mensal = 3 janelas). Avança o
// cursor com resolvePeriodWindow até passar do fim do intervalo pedido.
export function enumeratePeriodWindows(periodicity: ReceivablesPeriodicity, rangeStart: Date, rangeEndExclusive: Date): PeriodWindow[] {
  if (rangeStart >= rangeEndExclusive) return [];

  const windows: PeriodWindow[] = [];
  let cursor = rangeStart;
  while (cursor < rangeEndExclusive) {
    const window = resolvePeriodWindow(periodicity, cursor);
    windows.push(window);
    cursor = window.endExclusive;
  }
  return windows;
}

export function sumDailyMapInWindow(daily: DailyMap, window: PeriodWindow): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const [key, value] of daily) {
    const date = toDate(key);
    if (date >= window.start && date < window.endExclusive) total = total.plus(value);
  }
  return total;
}

// ============================================================
// CRUD da Base de Recebível
// ============================================================

export interface ReceivablesBaseInput {
  name: string;
  indicatorType: ReceivablesIndicatorType;
  primaryGoalCampaignId: string | null;
  resultTypeId: string | null;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  // null = Final Aberto (Bases de Recebível §1).
  startDate: string | null;
  endDate: string | null;
}

async function assertIndicatorFields(companyId: string, input: ReceivablesBaseInput) {
  if (input.indicatorType === "META") {
    if (!input.primaryGoalCampaignId) {
      throw new ConflictError("Selecione a Campanha de Meta.");
    }
    const campaign = await prisma.goalCampaign.findFirst({ where: { id: input.primaryGoalCampaignId, companyId } });
    if (!campaign) throw new NotFoundError("Campanha de Meta não encontrada");
    return;
  }

  if (!input.resultTypeId) {
    throw new ConflictError("Selecione o Tipo de Resultado.");
  }
  const resultType = await prisma.resultType.findFirst({ where: { id: input.resultTypeId, companyId } });
  if (!resultType) throw new NotFoundError("Tipo de Resultado não encontrado");
}

function assertValidVigencia(input: Pick<ReceivablesBaseInput, "startDate" | "endDate">) {
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    throw new ConflictError("A Data Inicial deve ser anterior (ou igual) à Data Final.");
  }
}

function toReceivablesBaseData(companyId: string, input: ReceivablesBaseInput) {
  return {
    companyId,
    name: input.name,
    indicatorType: input.indicatorType,
    primaryGoalCampaignId: input.indicatorType === "META" ? input.primaryGoalCampaignId : null,
    resultTypeId: input.indicatorType === "RESULTADO" ? input.resultTypeId : null,
    periodicity: input.periodicity,
    triggerMode: input.triggerMode,
    startDate: input.startDate ? toDate(input.startDate) : null,
    endDate: input.endDate ? toDate(input.endDate) : null,
  };
}

export async function createReceivablesBase(companyId: string, requestingUser: RequestingUser, input: ReceivablesBaseInput) {
  if (requestingUser.role === "OPERACIONAL") {
    throw new ForbiddenError("Você não tem permissão para criar Bases de Recebível.");
  }

  await assertIndicatorFields(companyId, input);
  assertValidVigencia(input);

  return writeWithTenant((tx) =>
    tx.receivablesBase.create({
      data: { ...toReceivablesBaseData(companyId, input), createdByUserId: requestingUser.id },
    }),
  );
}

async function assertBaseBeneficiariesWithinScope(
  companyId: string,
  requestingUser: RequestingUser,
  receivablesBaseId: string,
  errorMessage: string,
) {
  const beneficiaries = await prisma.receivablesBeneficiary.findMany({
    where: { receivablesBaseId },
    select: { memberId: true },
  });
  await assertReceivablesBaseWithinScope(companyId, requestingUser, beneficiaries.map((b) => b.memberId), errorMessage);
}

export async function updateReceivablesBase(
  companyId: string,
  requestingUser: RequestingUser,
  id: string,
  input: ReceivablesBaseInput,
) {
  const base = await prisma.receivablesBase.findFirst({ where: { id, companyId } });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");
  await assertBaseBeneficiariesWithinScope(companyId, requestingUser, id, "Você só pode editar Bases dentro da sua hierarquia.");

  await assertIndicatorFields(companyId, input);
  assertValidVigencia(input);

  return writeWithTenant((tx) => tx.receivablesBase.update({ where: { id }, data: toReceivablesBaseData(companyId, input) }));
}

export async function listReceivablesBases(companyId: string, requestingUser: RequestingUser) {
  if (requestingUser.role === "OPERACIONAL") {
    throw new ForbiddenError("Bases de Recebível não estão disponíveis para o seu nível de acesso.");
  }

  const editableFilter = await resolveEditableMemberFilter(companyId, requestingUser);
  // PASSO 11.8: OR createdByUserId — uma Base recém-criada, ainda sem
  // nenhum Beneficiário, nunca satisfaria "some" — ficaria invisível pro
  // próprio criador, travando-o de adicionar o primeiro Beneficiário.
  const scopeFilter =
    editableFilter === "ALL" ? {} : { OR: [{ createdByUserId: requestingUser.id }, { beneficiaries: { some: { member: editableFilter } } }] };

  return prisma.receivablesBase.findMany({
    where: { companyId, ...scopeFilter },
    include: {
      primaryGoal: { select: { name: true } },
      resultType: { select: { name: true } },
      _count: { select: { beneficiaries: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Busca "crua" (sem checagem de permissão) — uso interno, para código que
// precisa dos dados de uma Base para CALCULAR algo sobre um Membro
// específico (ex.: recebiveis.service.ts computando o quanto um Membro
// recebe), não para expor a Base inteira num endpoint de configuração. Se
// checássemos escopo de gestão aqui, um Gestor deixaria de conseguir ver o
// Recebível de um Membro do seu time só porque a Base também tem outros
// Beneficiários fora da hierarquia dele — a checagem de "quem pode ver o
// Recebível de X" já é feita separadamente por assertCanViewMembers.
export async function fetchReceivablesBaseDetail(companyId: string, id: string) {
  const base = await prisma.receivablesBase.findFirst({
    where: { id, companyId },
    include: {
      primaryGoal: { select: { id: true, name: true, resultTypeId: true } },
      resultType: { select: { id: true, name: true } },
      beneficiaries: {
        include: { member: { select: { id: true, fullName: true, cargo: { select: { id: true, name: true } } } } },
      },
      conditionalTriggers: {
        include: { conditionalGoal: { select: { id: true, name: true } }, resultType: { select: { id: true, name: true } } },
      },
      valueTiers: { orderBy: { order: "asc" } },
      tierRules: {
        include: { valueTier: true, rewardResultType: { select: { id: true, name: true } } },
      },
    },
  });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");

  const beneficiariesWithEntityName = await Promise.all(
    base.beneficiaries.map(async (beneficiary) => ({
      ...beneficiary,
      entityName: await resolveEntityName(companyId, beneficiary.entityType, beneficiary.entityId),
    })),
  );

  return { ...base, beneficiaries: beneficiariesWithEntityName };
}

// Versão exposta a endpoints/telas de configuração de Bases de Recebível —
// além dos dados, valida que o requisitante pode gerenciar esta Base
// específica (ver assertReceivablesBaseWithinScope).
export async function getReceivablesBaseDetail(companyId: string, requestingUser: RequestingUser, id: string) {
  const base = await fetchReceivablesBaseDetail(companyId, id);
  const access = await resolveReceivablesBaseAccess(
    companyId,
    requestingUser,
    base.beneficiaries.map((b) => b.memberId),
  );
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para consultar esta Base de Recebível.");
  }

  // Hierarquia completa de cada Beneficiário (do próprio Membro e da
  // Entidade Analisada) — só calculada aqui, na tela de configuração usada
  // por Admin/Gestor (N Beneficiários de uma vez); fetchReceivablesBaseDetail
  // fica sem isso de propósito, é hot-path compartilhado com autoatendimento
  // e simulação, que só precisam de 1 Beneficiário por vez.
  const beneficiariesWithHierarchy = await Promise.all(
    base.beneficiaries.map(async (beneficiary) => {
      const memberAncestorIds = await resolveAncestorIds(companyId, "MEMBRO", beneficiary.memberId);
      const entityAncestorIds = await resolveAncestorIds(companyId, beneficiary.entityType, beneficiary.entityId);
      return {
        ...beneficiary,
        memberHierarchyPath: await buildHierarchyPath(companyId, "MEMBRO", memberAncestorIds),
        entityHierarchyPath: await buildHierarchyPath(companyId, beneficiary.entityType, entityAncestorIds),
      };
    }),
  );

  // Acesso PARCIAL (Gestor com só ALGUNS beneficiários no escopo): abre a
  // Base inteira (beneficiários/Gatilhos/Degraus de todos, para contexto),
  // mas o front usa `access` para travar edição do que não é dele — Degraus
  // sempre em modo leitura nesse caso (afetam todos os beneficiários),
  // Gatilhos só editáveis se `applicableMemberIds` for só de dentro de
  // `editableBeneficiaryMemberIds` (ver assertConditionalTriggerOwnership).
  return {
    ...base,
    beneficiaries: beneficiariesWithHierarchy,
    access: access.level,
    editableBeneficiaryMemberIds: [...access.ownedMemberIds],
  };
}

export type ReceivablesBaseDetail = Awaited<ReturnType<typeof fetchReceivablesBaseDetail>>;

// "Minhas Bases" — visão de autoatendimento, disponível para TODOS os
// papéis (inclusive Usuário): as Bases onde o próprio Membro vinculado ao
// requisitante é Beneficiário, sem NENHUMA checagem de escopo de gestão —
// é sempre só o dado dele mesmo, não precisa de mais nada. Sem Membro
// vinculado, lista vazia.
export interface MyReceivablesBaseSummary {
  id: string;
  name: string;
  indicatorType: ReceivablesIndicatorType;
  periodicity: ReceivablesPeriodicity;
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  periodStart: Date;
  periodEndExclusive: Date;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  attainmentValue: Prisma.Decimal;
  fullLadder: LadderRungStatus[];
  conditionalChecks: ConditionalCheckResult[];
}

export async function listMyReceivablesBases(
  companyId: string,
  requestingUser: RequestingUser,
  referenceDate: Date = new Date(),
): Promise<MyReceivablesBaseSummary[]> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) return [];

  const bases = await prisma.receivablesBase.findMany({
    where: { companyId, beneficiaries: { some: { memberId } } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  const summaries: MyReceivablesBaseSummary[] = [];
  for (const { id } of bases) {
    const base = await fetchReceivablesBaseDetail(companyId, id);
    const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
    if (!beneficiary) continue;

    const window = resolvePeriodWindow(base.periodicity, referenceDate);
    const outcome = await computeLiveReceivablesOutcome(companyId, base, beneficiary, window);

    summaries.push({
      id: base.id,
      name: base.name,
      indicatorType: base.indicatorType,
      periodicity: base.periodicity,
      entityType: beneficiary.entityType,
      entityId: beneficiary.entityId,
      entityName: beneficiary.entityName,
      periodStart: window.start,
      periodEndExclusive: window.endExclusive,
      eligible: outcome.eligible,
      blockedReason: outcome.blockedReason,
      payoutValue: outcome.payoutValue,
      physicalPrizeDescription: outcome.physicalPrizeDescription,
      attainmentValue: outcome.attainmentValue,
      fullLadder: outcome.fullLadder,
      conditionalChecks: outcome.conditionalChecks,
    });
  }
  return summaries;
}

export async function setReceivablesBaseStatus(
  companyId: string,
  requestingUser: RequestingUser,
  id: string,
  status: ReceivablesStatus,
) {
  const base = await prisma.receivablesBase.findFirst({ where: { id, companyId } });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");
  await assertBaseBeneficiariesWithinScope(companyId, requestingUser, id, "Você só pode alterar o status de Bases dentro da sua hierarquia.");
  return writeWithTenant((tx) => tx.receivablesBase.update({ where: { id }, data: { status } }));
}

export async function deleteReceivablesBase(companyId: string, requestingUser: RequestingUser, id: string) {
  const base = await prisma.receivablesBase.findFirst({
    where: { id, companyId },
    include: { _count: { select: { financialSnapshots: true } } },
  });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");
  await assertBaseBeneficiariesWithinScope(companyId, requestingUser, id, "Você só pode excluir Bases dentro da sua hierarquia.");
  if (base._count.financialSnapshots > 0) {
    throw new ConflictError("Não é possível excluir: há períodos fechados vinculados a esta Base.");
  }

  await withTenant(async (tx) => {
    await tx.receivablesTierRule.deleteMany({ where: { receivablesBaseId: id } });
    await tx.receivablesValueTier.deleteMany({ where: { receivablesBaseId: id } });
    await tx.receivablesConditionalTrigger.deleteMany({ where: { receivablesBaseId: id } });
    await tx.receivablesBeneficiary.deleteMany({ where: { receivablesBaseId: id } });
    await tx.receivablesBase.delete({ where: { id } });
  });
}

// ============================================================
// Beneficiários — substituição completa a cada chamada (mesmo padrão de
// setGoalTriggers em metas.service.ts: mais simples que CRUD individual).
// A UI permite filtrar a lista por Canal/Departamento/Time antes de marcar
// (facilita achar quem procurar), mas a seleção final pode livremente
// misturar Membros de entidades diferentes — o filtro é só de navegação.
//
// Cada Beneficiário carrega sua própria Entidade de Análise (entityType/
// entityId — Empresa/Canal/Departamento/Time/Membro), obrigatória: não
// existe mais uma Entidade única da Base. Isso permite compor, com os
// MESMOS degraus/regras de recompensa, Beneficiários avaliados
// individualmente (Entidade = o próprio Membro) e outros avaliados pelo
// resultado de um grupo (Entidade = um Time/Departamento/Canal), tudo numa
// única Base.
// ============================================================

export interface BeneficiaryInput {
  memberId: string;
  entityType: OrgScopeType;
  entityId: string;
}

export async function setBeneficiaries(
  companyId: string,
  requestingUser: RequestingUser,
  receivablesBaseId: string,
  beneficiaries: BeneficiaryInput[],
) {
  const base = await prisma.receivablesBase.findFirst({
    where: { id: receivablesBaseId, companyId },
    include: { beneficiaries: { select: { memberId: true } } },
  });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");

  const memberIds = [...new Set(beneficiaries.map((b) => b.memberId))];
  if (memberIds.length !== beneficiaries.length) {
    throw new ConflictError("Um Membro não pode aparecer mais de uma vez entre os Beneficiários.");
  }
  if (memberIds.length > 0) {
    const members = await prisma.member.findMany({ where: { id: { in: memberIds }, companyId } });
    if (members.length !== memberIds.length) {
      throw new NotFoundError("Um ou mais Membros selecionados não foram encontrados");
    }
  }
  for (const beneficiary of beneficiaries) {
    await assertEntityBelongsToCompany(companyId, beneficiary.entityType, beneficiary.entityId);
  }

  const existingMemberIds = base.beneficiaries.map((b) => b.memberId);
  const access = await resolveReceivablesBaseAccess(companyId, requestingUser, existingMemberIds);
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para definir Beneficiários desta Base.");
  }

  const includeMember = { member: { select: { id: true, fullName: true } } } as const;

  if (access.level === "FULL") {
    await assertReceivablesBaseWithinScope(companyId, requestingUser, memberIds, "Você só pode definir Beneficiários dentro da sua hierarquia.");
    return withTenant(async (tx) => {
      await tx.receivablesBeneficiary.deleteMany({ where: { receivablesBaseId } });
      if (beneficiaries.length > 0) {
        await tx.receivablesBeneficiary.createMany({
          data: beneficiaries.map((beneficiary) => ({
            companyId,
            receivablesBaseId,
            memberId: beneficiary.memberId,
            entityType: beneficiary.entityType,
            entityId: beneficiary.entityId,
          })),
        });
      }
      return tx.receivablesBeneficiary.findMany({ where: { receivablesBaseId }, include: includeMember });
    });
  }

  // Acesso PARCIAL: mesma defesa em profundidade de setConditionalTriggers —
  // a tela sempre reenvia a lista INTEIRA de Beneficiários (inclusive os que
  // não são do Gestor), então filtramos: só as linhas cujo memberId esteja
  // dentro do escopo editável dele (existente OU nova) entram na
  // substituição; linhas de outros Gestores fora do payload são sempre
  // preservadas exatamente como estão no banco, nunca a partir do que ele
  // enviou.
  const relevantMemberIds = [...new Set([...existingMemberIds, ...memberIds])];
  const writeAccess = await resolveReceivablesBaseAccess(companyId, requestingUser, relevantMemberIds);
  const ownedSubmitted = beneficiaries.filter((beneficiary) => writeAccess.ownedMemberIds.has(beneficiary.memberId));
  const ownedExistingMemberIds = existingMemberIds.filter((memberId) => writeAccess.ownedMemberIds.has(memberId));

  return withTenant(async (tx) => {
    if (ownedExistingMemberIds.length > 0) {
      await tx.receivablesBeneficiary.deleteMany({ where: { receivablesBaseId, memberId: { in: ownedExistingMemberIds } } });
    }
    if (ownedSubmitted.length > 0) {
      await tx.receivablesBeneficiary.createMany({
        data: ownedSubmitted.map((beneficiary) => ({
          companyId,
          receivablesBaseId,
          memberId: beneficiary.memberId,
          entityType: beneficiary.entityType,
          entityId: beneficiary.entityId,
        })),
      });
    }
    return tx.receivablesBeneficiary.findMany({ where: { receivablesBaseId }, include: includeMember });
  });
}

// ============================================================
// Gatilhos Condicionais (Bases de Recebível §2) — substituição completa.
// Cada Condição tem um Nível relativo ao Beneficiário a quem se aplica (não
// uma Entidade fixa) — resolvido individualmente para CADA Beneficiário na
// hora da avaliação, via resolveMemberLevelEntity. indicatorType decide se
// o mínimo exigido é um % de Atingimento de Meta ou um Valor absoluto de
// Resultado. Aferido sempre dentro da janela do Período de Fechamento.
// ============================================================

// Resolve, para um Membro específico, qual entidade corresponde ao Nível
// pedido: EMPRESA = a própria empresa; MEMBRO = ele mesmo; TIME/
// DEPARTAMENTO/CANAL = sobe a ancestralidade estrutural do Membro
// (resolveAncestorIds), caindo para NodeResponsible quando ele é Líder de
// Nó sem vínculo estrutural naquele nível (ex: Time Gestão) — mesma
// semântica de Líder de Nó já usada em buildMemberScopeFilter/
// isMemberInScope, aqui na direção inversa (dado o Membro, acha o nó dele).
// null = o Membro não tem esse nível de nenhuma forma (nem estrutural, nem
// como Líder) — a Condição não pode ser avaliada para ele.
export async function resolveMemberLevelEntity(companyId: string, memberId: string, level: OrgScopeType): Promise<string | null> {
  if (level === "EMPRESA") return companyId;
  if (level === "MEMBRO") return memberId;

  const ancestry = await resolveAncestorIds(companyId, "MEMBRO", memberId);
  const structural = level === "TIME" ? ancestry.teamId : level === "DEPARTAMENTO" ? ancestry.departmentId : ancestry.channelId;
  if (structural) return structural;

  const responsible = await prisma.nodeResponsible.findFirst({ where: { companyId, memberId, nodeType: level } });
  if (!responsible) return null;
  return level === "TIME" ? responsible.teamId : level === "DEPARTAMENTO" ? responsible.departmentId : responsible.channelId;
}

export interface ConditionalTriggerInput {
  verificationLevel: OrgScopeType;
  indicatorType: ReceivablesIndicatorType;
  conditionalGoalCampaignId: string | null;
  resultTypeId: string | null;
  minAttainmentPercentage: number | null;
  minResultValue: number | null;
  // Beneficiários a quem esta Condição se aplica — [] = todos (padrão).
  applicableMemberIds: string[];
}

async function assertConditionalTriggerFields(companyId: string, receivablesBaseId: string, trigger: ConditionalTriggerInput) {
  if (trigger.applicableMemberIds.length > 0) {
    const validBeneficiaries = await prisma.receivablesBeneficiary.count({
      where: { receivablesBaseId, memberId: { in: trigger.applicableMemberIds } },
    });
    if (validBeneficiaries !== trigger.applicableMemberIds.length) {
      throw new ConflictError("Um ou mais Beneficiários selecionados não pertencem a esta Base.");
    }
  }

  if (trigger.indicatorType === "META") {
    if (!trigger.conditionalGoalCampaignId) throw new ConflictError("Selecione a Meta Condicional.");
    if (trigger.minAttainmentPercentage == null || trigger.minAttainmentPercentage <= 0) {
      throw new ConflictError("O Atingimento Mínimo deve ser maior que zero.");
    }
    const campaign = await prisma.goalCampaign.findFirst({ where: { id: trigger.conditionalGoalCampaignId, companyId } });
    if (!campaign) throw new NotFoundError("Meta Condicional não encontrada");
    return;
  }

  if (!trigger.resultTypeId) throw new ConflictError("Selecione o Tipo de Resultado.");
  if (trigger.minResultValue == null || trigger.minResultValue <= 0) {
    throw new ConflictError("O Valor Mínimo deve ser maior que zero.");
  }
  const resultType = await prisma.resultType.findFirst({ where: { id: trigger.resultTypeId, companyId } });
  if (!resultType) throw new NotFoundError("Tipo de Resultado não encontrado");
}

// Um Gatilho é "dono" de um Gestor com acesso PARCIAL só se ele mira
// beneficiários específicos (applicableMemberIds não-vazio) e TODOS eles
// estão dentro do que esse Gestor gerencia — Gatilho "global"
// (applicableMemberIds=[], vale para todos os beneficiários) ou que mira
// beneficiário de outro Gestor nunca é dele, mesmo que ele tente enviar.
function isTriggerOwnedByPartialAccess(applicableMemberIds: string[], ownedMemberIds: Set<string>): boolean {
  return applicableMemberIds.length > 0 && applicableMemberIds.every((id) => ownedMemberIds.has(id));
}

function triggerCreateData(companyId: string, receivablesBaseId: string, trigger: ConditionalTriggerInput) {
  return {
    companyId,
    receivablesBaseId,
    verificationLevel: trigger.verificationLevel,
    indicatorType: trigger.indicatorType,
    conditionalGoalCampaignId: trigger.indicatorType === "META" ? trigger.conditionalGoalCampaignId : null,
    resultTypeId: trigger.indicatorType === "RESULTADO" ? trigger.resultTypeId : null,
    minAttainmentPercentage: trigger.indicatorType === "META" ? trigger.minAttainmentPercentage : null,
    minResultValue: trigger.indicatorType === "RESULTADO" ? trigger.minResultValue : null,
    applicableMemberIds: trigger.applicableMemberIds,
  };
}

export async function setConditionalTriggers(
  companyId: string,
  requestingUser: RequestingUser,
  receivablesBaseId: string,
  triggers: ConditionalTriggerInput[],
) {
  const base = await prisma.receivablesBase.findFirst({
    where: { id: receivablesBaseId, companyId },
    include: { beneficiaries: { select: { memberId: true } } },
  });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");

  const access = await resolveReceivablesBaseAccess(companyId, requestingUser, base.beneficiaries.map((b) => b.memberId));
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para editar Gatilhos desta Base.");
  }

  const includeRelations = {
    conditionalGoal: { select: { id: true, name: true } },
    resultType: { select: { id: true, name: true } },
  } as const;

  if (access.level === "FULL") {
    for (const trigger of triggers) {
      await assertConditionalTriggerFields(companyId, receivablesBaseId, trigger);
    }
    return withTenant(async (tx) => {
      await tx.receivablesConditionalTrigger.deleteMany({ where: { receivablesBaseId } });
      if (triggers.length > 0) {
        await tx.receivablesConditionalTrigger.createMany({
          data: triggers.map((trigger) => triggerCreateData(companyId, receivablesBaseId, trigger)),
        });
      }
      return tx.receivablesConditionalTrigger.findMany({ where: { receivablesBaseId }, include: includeRelations });
    });
  }

  // Acesso PARCIAL: a tela sempre reenvia a lista INTEIRA de Gatilhos
  // (padrão "substituição completa" já usado em toda a Base), inclusive os
  // que não são dele (globais ou de outros Gestores) — ele não tem como
  // deixar de reenviá-los sem quebrar a UI de todo mundo. Em vez de
  // rejeitar a chamada inteira por causa disso, filtramos: só os Gatilhos
  // que ele DE FATO possui (applicableMemberIds só com Beneficiários dele)
  // entram na substituição; qualquer coisa fora disso no payload é
  // ignorada — os Gatilhos existentes que não são dele são sempre
  // preservados como estão no banco, nunca a partir do que ele enviou.
  const ownedSubmitted = triggers.filter((trigger) => isTriggerOwnedByPartialAccess(trigger.applicableMemberIds, access.ownedMemberIds));
  for (const trigger of ownedSubmitted) {
    await assertConditionalTriggerFields(companyId, receivablesBaseId, trigger);
  }

  const existingTriggers = await prisma.receivablesConditionalTrigger.findMany({ where: { receivablesBaseId } });
  const ownedExistingIds = existingTriggers
    .filter((trigger) => isTriggerOwnedByPartialAccess(trigger.applicableMemberIds, access.ownedMemberIds))
    .map((trigger) => trigger.id);

  return withTenant(async (tx) => {
    if (ownedExistingIds.length > 0) {
      await tx.receivablesConditionalTrigger.deleteMany({ where: { id: { in: ownedExistingIds } } });
    }
    if (ownedSubmitted.length > 0) {
      await tx.receivablesConditionalTrigger.createMany({
        data: ownedSubmitted.map((trigger) => triggerCreateData(companyId, receivablesBaseId, trigger)),
      });
    }
    return tx.receivablesConditionalTrigger.findMany({ where: { receivablesBaseId }, include: includeRelations });
  });
}

// ============================================================
// Degraus (Faixa/Cumulativo) + recompensa (Bases de Recebível §3-§5) —
// substituição completa. Trilha META reaproveita GoalTrigger/setGoalTriggers
// (metas.service.ts — gatilhos pertencem conceitualmente ao módulo Metas,
// "dormentes" na UI de lá até este módulo os consumir de verdade, conforme
// já registrado no .planosistemametas). Trilha RESULTADO usa
// ReceivablesValueTier, que pertence só a esta Base.
// ============================================================

export interface TierLadderRungInput {
  order: number;
  // % de atingimento (META) ou valor absoluto do Tipo de Resultado (RESULTADO).
  threshold: number;
  rewardType: RewardType;
  rewardResultTypeId: string | null;
  rewardPercentage: number | null;
  rewardFixedValue: number | null;
  rewardDescription: string | null;
}

function assertRewardFields(rung: TierLadderRungInput) {
  switch (rung.rewardType) {
    case "PERCENT_FIXO":
      if (rung.rewardPercentage == null || rung.rewardPercentage <= 0) {
        throw new ConflictError("Informe o percentual sobre o Fixo.");
      }
      return;
    case "PERCENT_RESULTADO":
      if (!rung.rewardResultTypeId) throw new ConflictError("Selecione o Tipo de Resultado da comissão.");
      if (rung.rewardPercentage == null || rung.rewardPercentage <= 0) {
        throw new ConflictError("Informe o percentual sobre o Resultado.");
      }
      return;
    case "VALOR_FIXO":
      if (rung.rewardFixedValue == null || rung.rewardFixedValue <= 0) {
        throw new ConflictError("Informe o Valor Específico.");
      }
      return;
    case "PREMIO_FISICO":
      if (!rung.rewardDescription?.trim()) throw new ConflictError("Descreva a Premiação Física.");
      return;
  }
}

export async function setTierLadder(
  companyId: string,
  requestingUser: RequestingUser,
  receivablesBaseId: string,
  rungs: TierLadderRungInput[],
) {
  const base = await prisma.receivablesBase.findFirst({ where: { id: receivablesBaseId, companyId } });
  if (!base) throw new NotFoundError("Base de Recebível não encontrada");
  // Degraus são 1 escada só para a Base inteira (não dá pra ter 1 por
  // Beneficiário) — sempre exige acesso FULL, mesmo que o Gestor tenha
  // acesso PARCIAL (ele só vê os Degraus em modo leitura nesse caso).
  await assertBaseBeneficiariesWithinScope(companyId, requestingUser, receivablesBaseId, "Você só pode editar Degraus de Bases dentro da sua hierarquia.");
  if (rungs.length === 0) throw new ConflictError("Informe ao menos um degrau.");

  for (const rung of rungs) {
    if (rung.threshold <= 0) throw new ConflictError("O limiar do degrau deve ser maior que zero.");
    assertRewardFields(rung);
  }

  const sortedRungs = [...rungs].sort((a, b) => a.order - b.order);

  // Degraus são sempre próprios desta Base (ReceivablesValueTier é
  // receivablesBaseId-scoped) — trilha META guarda o percentual de
  // atingimento em thresholdValue, trilha RESULTADO guarda o valor absoluto.
  // Mesmo código para as duas trilhas: substituição completa, numa única
  // transação, sem tocar em nenhuma outra Base ou no módulo Metas.
  return withTenant(async (tx) => {
    await tx.receivablesTierRule.deleteMany({ where: { receivablesBaseId } });
    await tx.receivablesValueTier.deleteMany({ where: { receivablesBaseId } });
    await tx.receivablesValueTier.createMany({
      data: sortedRungs.map((rung) => ({
        companyId,
        receivablesBaseId,
        order: rung.order,
        thresholdValue: rung.threshold,
      })),
    });
    const created = await tx.receivablesValueTier.findMany({ where: { receivablesBaseId }, orderBy: { order: "asc" } });
    await tx.receivablesTierRule.createMany({
      data: sortedRungs.map((rung) => {
        const tier = created.find((c) => c.order === rung.order)!;
        return {
          companyId,
          receivablesBaseId,
          valueTierId: tier.id,
          rewardType: rung.rewardType,
          rewardResultTypeId: rung.rewardResultTypeId,
          rewardPercentage: rung.rewardPercentage,
          rewardFixedValue: rung.rewardFixedValue,
          rewardDescription: rung.rewardDescription,
        };
      }),
    });
    return tx.receivablesTierRule.findMany({ where: { receivablesBaseId }, include: { valueTier: true } });
  });
}

// ============================================================
// Duplicar (Bases de Recebível §6) — clona a Base inteira, pronta para
// edição imediata (mesmo espírito do "Recalcular" de Metas).
// ============================================================

export async function duplicateReceivablesBase(companyId: string, requestingUser: RequestingUser, id: string) {
  // getReceivablesBaseDetail já valida existência + escopo do requisitante
  // contra os beneficiários da Base original — nenhuma checagem extra aqui.
  const base = await getReceivablesBaseDetail(companyId, requestingUser, id);

  const clone = await createReceivablesBase(companyId, requestingUser, {
    name: `${base.name} (cópia)`,
    indicatorType: base.indicatorType,
    primaryGoalCampaignId: base.primaryGoalCampaignId,
    resultTypeId: base.resultTypeId,
    periodicity: base.periodicity,
    triggerMode: base.triggerMode,
    startDate: base.startDate ? isoKey(base.startDate) : null,
    endDate: base.endDate ? isoKey(base.endDate) : null,
  });

  if (base.beneficiaries.length > 0) {
    await setBeneficiaries(
      companyId,
      requestingUser,
      clone.id,
      base.beneficiaries.map((beneficiary) => ({
        memberId: beneficiary.memberId,
        entityType: beneficiary.entityType,
        entityId: beneficiary.entityId,
      })),
    );
  }

  if (base.conditionalTriggers.length > 0) {
    await setConditionalTriggers(
      companyId,
      requestingUser,
      clone.id,
      base.conditionalTriggers.map((trigger) => ({
        verificationLevel: trigger.verificationLevel,
        indicatorType: trigger.indicatorType,
        conditionalGoalCampaignId: trigger.conditionalGoalCampaignId,
        resultTypeId: trigger.resultTypeId,
        minAttainmentPercentage: trigger.minAttainmentPercentage ? trigger.minAttainmentPercentage.toNumber() : null,
        minResultValue: trigger.minResultValue ? trigger.minResultValue.toNumber() : null,
        applicableMemberIds: trigger.applicableMemberIds,
      })),
    );
  }

  if (base.tierRules.length > 0) {
    const rungs: TierLadderRungInput[] = base.tierRules.map((rule) => {
      const threshold = rule.valueTier!.thresholdValue.toNumber();
      const order = rule.valueTier!.order;
      return {
        order,
        threshold,
        rewardType: rule.rewardType,
        rewardResultTypeId: rule.rewardResultTypeId,
        rewardPercentage: rule.rewardPercentage ? rule.rewardPercentage.toNumber() : null,
        rewardFixedValue: rule.rewardFixedValue ? rule.rewardFixedValue.toNumber() : null,
        rewardDescription: rule.rewardDescription,
      };
    });
    await setTierLadder(companyId, requestingUser, clone.id, rungs);
  }

  return fetchReceivablesBaseDetail(companyId, clone.id);
}

// ============================================================
// Motor de Cálculo — funções puras (Bases de Recebível §3-§5)
// ============================================================

export type TierMode = TriggerMode;

export interface TierThreshold {
  id: string;
  order: number;
  threshold: Prisma.Decimal;
}

// AtingimentoValue = % de atingimento (indicatorType=META) ou o próprio
// Realizado (indicatorType=RESULTADO, faixas de valor absoluto). Em ambos os
// casos, `realized` já deve vir recortado à janela do Período de Fechamento.
export function computeAttainmentValue(
  indicatorType: ReceivablesIndicatorType,
  realized: Prisma.Decimal,
  metaTotal: Prisma.Decimal,
): Prisma.Decimal {
  if (indicatorType === "RESULTADO") return realized;
  if (metaTotal.isZero()) return new Prisma.Decimal(0);
  return realized.dividedBy(metaTotal).times(100);
}

// "Degrau Rígido" (§3): o participante fica retido no maior degrau cujo
// limiar já foi alcançado, até bater o limiar do próximo. FAIXA aplica só
// esse degrau; CUMULATIVO aplica todos os degraus já alcançados (§5) — a
// mesma comparação de limiar serve para os dois modos, cumulativo só muda
// quantos elementos voltam.
export function pickAchievedTiers<T extends TierThreshold>(attainmentValue: Prisma.Decimal, tiers: T[], mode: TierMode): T[] {
  const sorted = [...tiers].sort((a, b) => a.order - b.order);
  const achieved = sorted.filter((tier) => attainmentValue.greaterThanOrEqualTo(tier.threshold));
  if (achieved.length === 0) return [];
  if (mode === "CUMULATIVO") return achieved;
  return [achieved[achieved.length - 1]];
}

// Ladder completo com o status de "atingido" por Degrau — comparação PURA
// de limiar (attainmentValue >= tier.threshold), independente do Modo
// (Faixa/Cumulativo). NÃO reaproveitar pickAchievedTiers aqui: em modo
// Faixa ela devolve só o Degrau mais alto batido (correto pra CALCULAR o
// pagamento), e usar isso pra marcar "achieved" no ladder completo faz os
// Degraus abaixo do atual aparecerem como não batidos — bug encontrado no
// "Próximo Degrau"/"No Topo" de Recebíveis (um Membro no Degrau 2 de 5
// aparecia como "No Topo", porque o Degrau 1 — já ultrapassado — era o
// primeiro "não batido" encontrado).
export function buildFullLadder(attainmentValue: Prisma.Decimal, thresholds: TierThreshold[]): LadderRungStatus[] {
  return [...thresholds]
    .sort((a, b) => a.order - b.order)
    .map((tier) => ({ order: tier.order, threshold: tier.threshold, achieved: attainmentValue.greaterThanOrEqualTo(tier.threshold) }));
}

export interface TierRewardConfig {
  rewardType: RewardType;
  rewardResultTypeId: string | null;
  rewardPercentage: Prisma.Decimal | null;
  rewardFixedValue: Prisma.Decimal | null;
  rewardDescription: string | null;
}

export interface RewardContext {
  member: { customFixedSalary: Prisma.Decimal | null };
  cargo: { defaultFixedSalary: Prisma.Decimal };
  // Realizado (dentro da janela do Período de Fechamento) do Tipo de
  // Resultado escolhido como base da comissão (rewardResultTypeId), apurado
  // na Entidade de Análise DESTE Beneficiário (individual ou de grupo,
  // conforme configurado) — só é necessário quando rewardType=PERCENT_RESULTADO.
  rewardResultRealized: Prisma.Decimal | null;
}

// Base de Cálculo Dinâmica (§4): cada tipo de recompensa usa uma fonte de
// valor diferente do indicador de Atingimento da Meta Principal.
// PERCENT_FIXO: sobre o salário do Beneficiário (ctx.member/ctx.cargo).
// PERCENT_RESULTADO: sobre o Realizado da Entidade de Análise do
// Beneficiário (ctx.rewardResultRealized).
export function computeTierPayout(
  tier: TierRewardConfig,
  ctx: RewardContext,
): { payoutValue: Prisma.Decimal; physicalPrizeDescription: string | null } {
  switch (tier.rewardType) {
    case "PERCENT_FIXO": {
      const salary = resolveFixedSalary(ctx.member, ctx.cargo);
      return { payoutValue: salary.times(tier.rewardPercentage ?? 0).dividedBy(100), physicalPrizeDescription: null };
    }
    case "PERCENT_RESULTADO": {
      const base = ctx.rewardResultRealized ?? new Prisma.Decimal(0);
      return { payoutValue: base.times(tier.rewardPercentage ?? 0).dividedBy(100), physicalPrizeDescription: null };
    }
    case "VALOR_FIXO":
      return { payoutValue: tier.rewardFixedValue ?? new Prisma.Decimal(0), physicalPrizeDescription: null };
    case "PREMIO_FISICO":
      return { payoutValue: new Prisma.Decimal(0), physicalPrizeDescription: tier.rewardDescription };
  }
}

// FAIXA: 1 degrau só (calcula isolado). CUMULATIVO: soma o payout de cada
// degrau alcançado — matematicamente equivalente a "somar as taxas antes de
// aplicar", já que a base de cálculo é a mesma em todos os degraus da mesma
// Base (§5: "soma as taxas" ou "soma os valores" ou "soma os prêmios").
export function computePayout(
  achievedTiers: TierRewardConfig[],
  ctxOf: (tier: TierRewardConfig) => RewardContext,
): { payoutValue: Prisma.Decimal; physicalPrizeDescription: string | null } {
  let payoutValue = new Prisma.Decimal(0);
  const prizeDescriptions: string[] = [];

  for (const tier of achievedTiers) {
    const result = computeTierPayout(tier, ctxOf(tier));
    payoutValue = payoutValue.plus(result.payoutValue);
    if (result.physicalPrizeDescription) prizeDescriptions.push(result.physicalPrizeDescription);
  }

  return {
    payoutValue,
    physicalPrizeDescription: prizeDescriptions.length > 0 ? prizeDescriptions.join("; ") : null,
  };
}

// ============================================================
// Gatilhos Condicionais — motor de elegibilidade (§2, pseudocódigo pronto)
// ============================================================

export interface ConditionalTriggerCheck {
  id: string;
  verificationLevel: OrgScopeType;
  indicatorType: ReceivablesIndicatorType;
  conditionalGoalCampaignId: string | null;
  resultTypeId: string | null;
  minAttainmentPercentage: Prisma.Decimal | null;
  minResultValue: Prisma.Decimal | null;
  applicableMemberIds: string[];
}

export interface ConditionalEvaluationResult {
  eligible: boolean;
  failedTrigger: ConditionalTriggerCheck | null;
}

// [] = Condição vale para todos os Beneficiários da Base; não-vazia = só
// para os listados. Pura — sem banco.
export function triggerAppliesToMember(applicableMemberIds: string[], memberId: string): boolean {
  return applicableMemberIds.length === 0 || applicableMemberIds.includes(memberId);
}

async function resolveConditionalMetaTotal(
  companyId: string,
  verificationLevel: OrgScopeType,
  entityId: string,
  conditionalGoalCampaignId: string | null,
  window: PeriodWindow,
): Promise<Prisma.Decimal> {
  if (!conditionalGoalCampaignId) return new Prisma.Decimal(0);
  const daily = await dailyMapOfActiveLine(companyId, conditionalGoalCampaignId, verificationLevel, entityId);
  return sumDailyMapInWindow(daily, window);
}

// PARA CADA Condição: resolve a Entidade do Nível pedido relativa a ESTE
// Beneficiário (resolveMemberLevelEntity); AtingimentoReal = Realizado/Meta
// * 100 (indicatorType META) OU o próprio Realizado (RESULTADO), ambos
// dentro da janela do Período de Fechamento; se abaixo do mínimo exigido
// (ou se o Beneficiário não tem esse Nível de nenhuma forma), interrompe e
// fica bloqueado (§2).
export async function evaluateConditionalTriggers(
  companyId: string,
  memberId: string,
  triggers: ConditionalTriggerCheck[],
  window: PeriodWindow,
): Promise<ConditionalEvaluationResult> {
  const applicableTriggers = triggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));

  for (const trigger of applicableTriggers) {
    const entityId = await resolveMemberLevelEntity(companyId, memberId, trigger.verificationLevel);
    if (!entityId) return { eligible: false, failedTrigger: trigger };

    if (trigger.indicatorType === "META") {
      const metaTotal = await resolveConditionalMetaTotal(companyId, trigger.verificationLevel, entityId, trigger.conditionalGoalCampaignId, window);
      if (metaTotal.isZero() || !trigger.conditionalGoalCampaignId || !trigger.minAttainmentPercentage) {
        return { eligible: false, failedTrigger: trigger };
      }
      const campaign = await prisma.goalCampaign.findFirst({ where: { id: trigger.conditionalGoalCampaignId, companyId } });
      if (!campaign) throw new NotFoundError("Meta Condicional não encontrada");

      const realizadoDaily = await getRealizadoDailyMap(
        companyId,
        campaign.resultTypeId,
        trigger.verificationLevel,
        entityId,
        window.start,
        window.endExclusive,
      );
      const realizadoTotal = summarizeDailyMap(realizadoDaily).total;
      const atingimentoReal = realizadoTotal.dividedBy(metaTotal).times(100);
      if (atingimentoReal.lessThan(trigger.minAttainmentPercentage)) {
        return { eligible: false, failedTrigger: trigger };
      }
    } else {
      if (!trigger.resultTypeId || !trigger.minResultValue) {
        return { eligible: false, failedTrigger: trigger };
      }
      const realizadoDaily = await getRealizadoDailyMap(
        companyId,
        trigger.resultTypeId,
        trigger.verificationLevel,
        entityId,
        window.start,
        window.endExclusive,
      );
      const realizadoTotal = summarizeDailyMap(realizadoDaily).total;
      if (realizadoTotal.lessThan(trigger.minResultValue)) {
        return { eligible: false, failedTrigger: trigger };
      }
    }
  }

  return { eligible: true, failedTrigger: null };
}

// ============================================================
// Simulador (§7) — usa valores DIGITADOS (não o Realizado real) para a
// Meta/Resultado Principal e para as Condições; a base de cálculo de
// PERCENT_RESULTADO continua usando o Realizado real da Entidade Analisada
// da Base (não simulado — a spec só pede simulação da Meta Principal +
// Condicionais). Tudo apurado dentro da janela do Período de Fechamento da
// data de referência (hoje, por padrão — parametrizável para quando o
// Fechamento (PASSO 3) precisar simular/fechar uma data específica).
// ============================================================

export interface ConditionalSimulationInput {
  conditionalTriggerId: string;
  simulatedRealized: number;
}

export interface AchievedTierInfo {
  order: number;
  threshold: Prisma.Decimal;
}

export interface BlockedTriggerInfo {
  verificationLevel: OrgScopeType;
  indicatorType: ReceivablesIndicatorType;
  // Nome da Meta Condicional (META) ou do Tipo de Resultado (RESULTADO).
  label: string;
  // % mínimo exigido (META) ou valor mínimo exigido (RESULTADO) — o que
  // faltava bater para desbloquear o Recebível.
  requiredMinimum: Prisma.Decimal;
  // % de atingimento calculado (META) ou o próprio valor simulado (RESULTADO)
  // com os dados informados na simulação.
  simulatedValue: Prisma.Decimal;
}

export interface ConditionalCheckResult extends BlockedTriggerInfo {
  triggerId: string;
  passed: boolean;
}

export interface LadderRungStatus {
  order: number;
  threshold: Prisma.Decimal;
  achieved: boolean;
}

export interface TierPayoutBreakdown {
  order: number;
  rewardType: RewardType;
  // Fixo do Beneficiário (PERCENT_FIXO) ou Realizado da Entidade
  // (PERCENT_RESULTADO) usado como base do cálculo — null para
  // VALOR_FIXO/PREMIO_FISICO (não têm base variável).
  baseValueUsed: Prisma.Decimal | null;
  computedAmount: Prisma.Decimal;
  physicalPrizeDescription: string | null;
}

export interface SimulationResult {
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  // Sempre presentes, mesmo quando bloqueado — o usuário precisa ver qual
  // janela foi analisada independente do resultado.
  periodStart: Date;
  periodEndExclusive: Date;
  // Só preenchido quando indicatorType=META (a Meta 100% do período).
  metaTotal: Prisma.Decimal | null;
  // % de atingimento (META) ou o próprio Realizado simulado (RESULTADO).
  attainmentValue: Prisma.Decimal;
  achievedTiers: AchievedTierInfo[];
  // Todos os degraus configurados da Base (não só os atingidos), para o
  // Simulador mostrar o ladder completo.
  fullLadder: LadderRungStatus[];
  // Detalhamento do cálculo de cada degrau atingido — soma para o total em
  // modo Cumulativo.
  tierBreakdown: TierPayoutBreakdown[];
  // Todas as Condições aplicáveis a este Beneficiário, avaliadas (não só a
  // que bloqueou primeiro) — para o Simulador mostrar ✅/❌ de cada uma.
  conditionalChecks: ConditionalCheckResult[];
  // Só preenchido quando eligible=false: qual Condição bloqueou primeiro e
  // qual era o mínimo exigido para a situação simulada desbloquear o
  // Recebível.
  blockedTrigger: BlockedTriggerInfo | null;
}

export async function simulateReceivablesBase(
  companyId: string,
  requestingUser: RequestingUser,
  receivablesBaseId: string,
  memberId: string,
  simulatedMainRealized: number,
  conditionalSimulations: ConditionalSimulationInput[],
  referenceDate: Date = new Date(),
): Promise<SimulationResult> {
  // Autoatendimento ("Minhas Bases"): simular para o próprio Membro
  // vinculado nunca passa pela checagem de acesso de GESTÃO da Base (que
  // bloquearia OPERACIONAL de cara) — ser Beneficiário já é suficiente,
  // mesma regra de listMyReceivablesBases. Simular para outro Membro segue
  // exigindo acesso de gestão (FULL, ou PARTIAL restrito aos próprios
  // Beneficiários, checado abaixo).
  const ownMemberId = await resolveRequesterMemberId(companyId, requestingUser);
  const isSelfSimulation = ownMemberId !== null && ownMemberId === memberId;

  const base = isSelfSimulation
    ? await fetchReceivablesBaseDetail(companyId, receivablesBaseId)
    : await getReceivablesBaseDetail(companyId, requestingUser, receivablesBaseId);
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) {
    throw new NotFoundError("Membro não é Beneficiário desta Base de Recebível");
  }

  if (!isSelfSimulation) {
    const access = await resolveReceivablesBaseAccess(companyId, requestingUser, base.beneficiaries.map((b) => b.memberId));
    if (access.level === "PARTIAL" && !access.ownedMemberIds.has(memberId)) {
      throw new ForbiddenError("Você só pode simular Recebíveis dos seus próprios Beneficiários.");
    }
  }
  // Entidade de Análise DESTE Beneficiário — pode ser ele mesmo (avaliação
  // individual) ou qualquer nó acima (ex: o Time inteiro), configurado por
  // linha em ReceivablesBeneficiary. Não existe mais uma Entidade da Base.
  const { entityType, entityId } = beneficiary;

  const window = resolvePeriodWindow(base.periodicity, referenceDate);

  let metaTotal = new Prisma.Decimal(0);
  if (base.indicatorType === "META" && base.primaryGoalCampaignId) {
    const daily = await dailyMapOfActiveLine(companyId, base.primaryGoalCampaignId, entityType, entityId);
    metaTotal = sumDailyMapInWindow(daily, window);
  }
  const attainmentValue = computeAttainmentValue(base.indicatorType, new Prisma.Decimal(simulatedMainRealized), metaTotal);

  const thresholds: TierThreshold[] = base.valueTiers.map((tier) => ({ id: tier.id, order: tier.order, threshold: tier.thresholdValue }));
  const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
  const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
  const achievedTiersInfo: AchievedTierInfo[] = achievedThresholds.map((tier) => ({ order: tier.order, threshold: tier.threshold }));
  const fullLadder = buildFullLadder(attainmentValue, thresholds);

  // Avalia TODAS as Condições aplicáveis a este Beneficiário (não para no
  // primeiro bloqueio) — o Simulador mostra o status de cada uma.
  const simulatedByTriggerId = new Map(conditionalSimulations.map((sim) => [sim.conditionalTriggerId, sim.simulatedRealized]));
  const applicableTriggers = base.conditionalTriggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));
  const conditionalChecks: ConditionalCheckResult[] = [];

  for (const trigger of applicableTriggers) {
    const simulatedValue = new Prisma.Decimal(simulatedByTriggerId.get(trigger.id) ?? 0);
    const conditionEntityId = await resolveMemberLevelEntity(companyId, memberId, trigger.verificationLevel);

    if (trigger.indicatorType === "META") {
      const label = trigger.conditionalGoal?.name ?? "—";
      const requiredMinimum = trigger.minAttainmentPercentage ?? new Prisma.Decimal(0);
      if (!conditionEntityId) {
        conditionalChecks.push({ triggerId: trigger.id, verificationLevel: trigger.verificationLevel, indicatorType: "META", label, requiredMinimum, simulatedValue: new Prisma.Decimal(0), passed: false });
        continue;
      }
      const conditionalMetaTotal = await resolveConditionalMetaTotal(companyId, trigger.verificationLevel, conditionEntityId, trigger.conditionalGoalCampaignId, window);
      const atingimentoReal = conditionalMetaTotal.isZero() ? new Prisma.Decimal(0) : simulatedValue.dividedBy(conditionalMetaTotal).times(100);
      const passed = !!trigger.minAttainmentPercentage && atingimentoReal.greaterThanOrEqualTo(trigger.minAttainmentPercentage);
      conditionalChecks.push({ triggerId: trigger.id, verificationLevel: trigger.verificationLevel, indicatorType: "META", label, requiredMinimum, simulatedValue: atingimentoReal, passed });
    } else {
      const label = trigger.resultType?.name ?? "—";
      const requiredMinimum = trigger.minResultValue ?? new Prisma.Decimal(0);
      const passed = !!trigger.minResultValue && simulatedValue.greaterThanOrEqualTo(trigger.minResultValue);
      conditionalChecks.push({ triggerId: trigger.id, verificationLevel: trigger.verificationLevel, indicatorType: "RESULTADO", label, requiredMinimum, simulatedValue, passed });
    }
  }

  const firstFailed = conditionalChecks.find((check) => !check.passed) ?? null;
  if (firstFailed) {
    return {
      eligible: false,
      blockedReason: "Bloqueado por Condição Comercial",
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      periodStart: window.start,
      periodEndExclusive: window.endExclusive,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: firstFailed,
    };
  }

  const achievedRules = base.tierRules.filter((rule) => achievedIds.has(rule.valueTierId));
  if (achievedRules.length === 0) {
    return {
      eligible: true,
      blockedReason: null,
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      periodStart: window.start,
      periodEndExclusive: window.endExclusive,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: null,
    };
  }

  const member = await prisma.member.findFirst({
    where: { id: memberId, companyId },
    include: { cargo: { select: { defaultFixedSalary: true } } },
  });
  if (!member || !member.cargo) throw new NotFoundError("Membro ou Cargo não encontrado");

  // PERCENT_RESULTADO usa o Realizado da Entidade de Análise DESTE
  // Beneficiário (individual ou de grupo, conforme configurado na linha) —
  // nunca uma "Entidade da Base" (não existe mais). Exceção: se o Tipo de
  // Resultado da recompensa é o MESMO que já é a base do indicador
  // principal da Base, reaproveita o valor SIMULADO (simulatedMainRealized)
  // em vez de buscar o Realizado real no banco — senão o usuário digita um
  // "Realizado Simulado" e o sistema silenciosamente usa outro número (o
  // real do período) para calcular o prêmio, o que é inconsistente quando é
  // o mesmo indicador. Só faz sentido buscar o Realizado real quando a
  // recompensa é sobre um Tipo de Resultado DIFERENTE do indicador
  // principal (não há valor simulado para reaproveitar nesse caso).
  const mainIndicatorResultTypeId = base.indicatorType === "META" ? (base.primaryGoal?.resultTypeId ?? null) : base.resultTypeId;
  const realizedByResultType = new Map<string, Prisma.Decimal>();
  for (const rule of achievedRules) {
    if (rule.rewardType !== "PERCENT_RESULTADO" || !rule.rewardResultTypeId) continue;
    if (realizedByResultType.has(rule.rewardResultTypeId)) continue;

    if (rule.rewardResultTypeId === mainIndicatorResultTypeId) {
      realizedByResultType.set(rule.rewardResultTypeId, new Prisma.Decimal(simulatedMainRealized));
      continue;
    }

    const daily = await getRealizadoDailyMap(companyId, rule.rewardResultTypeId, entityType, entityId, window.start, window.endExclusive);
    realizedByResultType.set(rule.rewardResultTypeId, summarizeDailyMap(daily).total);
  }

  const rewardContextOf = (rule: TierRewardConfig): RewardContext => ({
    member: { customFixedSalary: member.customFixedSalary },
    cargo: { defaultFixedSalary: member.cargo!.defaultFixedSalary },
    rewardResultRealized: rule.rewardResultTypeId ? (realizedByResultType.get(rule.rewardResultTypeId) ?? null) : null,
  });

  const { payoutValue, physicalPrizeDescription } = computePayout(achievedRules, rewardContextOf);

  const tierBreakdown: TierPayoutBreakdown[] = achievedRules.map((rule) => {
    const source = base.valueTiers.find((t) => t.id === rule.valueTierId)!;
    const ctx = rewardContextOf(rule);
    const result = computeTierPayout(rule, ctx);
    const baseValueUsed =
      rule.rewardType === "PERCENT_FIXO"
        ? resolveFixedSalary(ctx.member, ctx.cargo)
        : rule.rewardType === "PERCENT_RESULTADO"
          ? ctx.rewardResultRealized
          : null;
    return {
      order: source.order,
      rewardType: rule.rewardType,
      baseValueUsed,
      computedAmount: result.payoutValue,
      physicalPrizeDescription: result.physicalPrizeDescription,
    };
  });

  return {
    eligible: true,
    blockedReason: null,
    payoutValue,
    physicalPrizeDescription,
    periodStart: window.start,
    periodEndExclusive: window.endExclusive,
    metaTotal: base.indicatorType === "META" ? metaTotal : null,
    attainmentValue,
    achievedTiers: achievedTiersInfo,
    fullLadder,
    tierBreakdown,
    conditionalChecks,
    blockedTrigger: null,
  };
}

// ============================================================
// Recebíveis (macroambiente 8) — mesmo motor do Simulador (§7), mas
// alimentado com o Realizado REAL (não digitado) dentro de uma janela já
// resolvida por quem chama (enumeratePeriodWindows). Reaproveita as mesmas
// funções puras de degraus/pagamento do Simulador — só a origem dos
// valores muda. Também calcula o "Próximo Degrau" (estático, sem projeção
// por ritmo — só "quanto falta" e "quanto pagaria se batesse").
// ============================================================

export interface NextTierInfo {
  order: number;
  gap: Prisma.Decimal;
  potentialPayout: Prisma.Decimal;
}

export interface LiveReceivablesOutcome {
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  metaTotal: Prisma.Decimal | null;
  // Realizado bruto do Tipo de Resultado do indicador principal (META ou
  // RESULTADO) — na trilha RESULTADO é o mesmo valor de attainmentValue; na
  // trilha META, attainmentValue já é o % (realizado/metaTotal*100), então
  // este campo expõe o valor absoluto por trás do %, usado pelo Fechamento.
  mainRealized: Prisma.Decimal;
  attainmentValue: Prisma.Decimal;
  achievedTiers: AchievedTierInfo[];
  fullLadder: LadderRungStatus[];
  tierBreakdown: TierPayoutBreakdown[];
  conditionalChecks: ConditionalCheckResult[];
  blockedTrigger: BlockedTriggerInfo | null;
  nextTier: NextTierInfo | null;
  // "Ganho Potencial": o pagamento SE o Beneficiário batesse exatamente o
  // Degrau de maior order (não o próximo) — respeitando Faixa/Cumulativo
  // automaticamente (pickAchievedTiers já resolve isso pro limiar do Degrau
  // de topo). 0 quando a Base não tem nenhum Degrau configurado.
  topTierPotentialPayout: Prisma.Decimal;
}

export async function computeLiveReceivablesOutcome(
  companyId: string,
  base: ReceivablesBaseDetail,
  beneficiary: ReceivablesBaseDetail["beneficiaries"][number],
  window: PeriodWindow,
): Promise<LiveReceivablesOutcome> {
  const { memberId, entityType, entityId } = beneficiary;
  const mainIndicatorResultTypeId = base.indicatorType === "META" ? (base.primaryGoal?.resultTypeId ?? null) : base.resultTypeId;

  let metaTotal = new Prisma.Decimal(0);
  if (base.indicatorType === "META" && base.primaryGoalCampaignId) {
    const daily = await dailyMapOfActiveLine(companyId, base.primaryGoalCampaignId, entityType, entityId);
    metaTotal = sumDailyMapInWindow(daily, window);
  }
  let mainRealized = new Prisma.Decimal(0);
  if (mainIndicatorResultTypeId) {
    const realizadoDaily = await getRealizadoDailyMap(companyId, mainIndicatorResultTypeId, entityType, entityId, window.start, window.endExclusive);
    mainRealized = summarizeDailyMap(realizadoDaily).total;
  }
  const attainmentValue = computeAttainmentValue(base.indicatorType, mainRealized, metaTotal);

  const thresholds: TierThreshold[] = base.valueTiers.map((tier) => ({ id: tier.id, order: tier.order, threshold: tier.thresholdValue }));
  const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
  const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
  const achievedTiersInfo: AchievedTierInfo[] = achievedThresholds.map((tier) => ({ order: tier.order, threshold: tier.threshold }));
  const fullLadder = buildFullLadder(attainmentValue, thresholds);

  const applicableTriggers = base.conditionalTriggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));
  const conditionalChecks: ConditionalCheckResult[] = [];

  for (const trigger of applicableTriggers) {
    const conditionEntityId = await resolveMemberLevelEntity(companyId, memberId, trigger.verificationLevel);

    if (trigger.indicatorType === "META") {
      const label = trigger.conditionalGoal?.name ?? "—";
      const requiredMinimum = trigger.minAttainmentPercentage ?? new Prisma.Decimal(0);
      if (!conditionEntityId) {
        conditionalChecks.push({
          triggerId: trigger.id,
          verificationLevel: trigger.verificationLevel,
          indicatorType: "META",
          label,
          requiredMinimum,
          simulatedValue: new Prisma.Decimal(0),
          passed: false,
        });
        continue;
      }
      const conditionalMetaTotal = await resolveConditionalMetaTotal(
        companyId,
        trigger.verificationLevel,
        conditionEntityId,
        trigger.conditionalGoalCampaignId,
        window,
      );
      let atingimentoReal = new Prisma.Decimal(0);
      if (!conditionalMetaTotal.isZero() && trigger.conditionalGoalCampaignId) {
        const campaign = await prisma.goalCampaign.findFirst({ where: { id: trigger.conditionalGoalCampaignId, companyId } });
        if (campaign) {
          const realizadoDaily = await getRealizadoDailyMap(
            companyId,
            campaign.resultTypeId,
            trigger.verificationLevel,
            conditionEntityId,
            window.start,
            window.endExclusive,
          );
          atingimentoReal = summarizeDailyMap(realizadoDaily).total.dividedBy(conditionalMetaTotal).times(100);
        }
      }
      const passed = !!trigger.minAttainmentPercentage && atingimentoReal.greaterThanOrEqualTo(trigger.minAttainmentPercentage);
      conditionalChecks.push({
        triggerId: trigger.id,
        verificationLevel: trigger.verificationLevel,
        indicatorType: "META",
        label,
        requiredMinimum,
        simulatedValue: atingimentoReal,
        passed,
      });
    } else {
      const label = trigger.resultType?.name ?? "—";
      const requiredMinimum = trigger.minResultValue ?? new Prisma.Decimal(0);
      let realizadoTotal = new Prisma.Decimal(0);
      if (conditionEntityId && trigger.resultTypeId) {
        const realizadoDaily = await getRealizadoDailyMap(
          companyId,
          trigger.resultTypeId,
          trigger.verificationLevel,
          conditionEntityId,
          window.start,
          window.endExclusive,
        );
        realizadoTotal = summarizeDailyMap(realizadoDaily).total;
      }
      const passed = !!conditionEntityId && !!trigger.resultTypeId && !!trigger.minResultValue && realizadoTotal.greaterThanOrEqualTo(trigger.minResultValue);
      conditionalChecks.push({
        triggerId: trigger.id,
        verificationLevel: trigger.verificationLevel,
        indicatorType: "RESULTADO",
        label,
        requiredMinimum,
        simulatedValue: realizadoTotal,
        passed,
      });
    }
  }

  // Membro/Cargo e o mapa de Realizado por Tipo de Resultado (base de
  // PERCENT_RESULTADO) são resolvidos incondicionalmente — servem tanto
  // para o payout real (degraus já alcançados) quanto para o "Ganho
  // Potencial" hipotético do próximo degrau.
  const member = await prisma.member.findFirst({ where: { id: memberId, companyId }, include: { cargo: { select: { defaultFixedSalary: true } } } });
  if (!member || !member.cargo) throw new NotFoundError("Membro ou Cargo não encontrado");

  const allRules = base.tierRules;
  const realizedByResultType = new Map<string, Prisma.Decimal>();
  for (const rule of allRules) {
    if (rule.rewardType !== "PERCENT_RESULTADO" || !rule.rewardResultTypeId) continue;
    if (realizedByResultType.has(rule.rewardResultTypeId)) continue;
    if (rule.rewardResultTypeId === mainIndicatorResultTypeId) {
      realizedByResultType.set(rule.rewardResultTypeId, mainRealized);
      continue;
    }
    const daily = await getRealizadoDailyMap(companyId, rule.rewardResultTypeId, entityType, entityId, window.start, window.endExclusive);
    realizedByResultType.set(rule.rewardResultTypeId, summarizeDailyMap(daily).total);
  }

  const rewardContextOf = (rule: TierRewardConfig): RewardContext => ({
    member: { customFixedSalary: member.customFixedSalary },
    cargo: { defaultFixedSalary: member.cargo!.defaultFixedSalary },
    rewardResultRealized: rule.rewardResultTypeId ? (realizedByResultType.get(rule.rewardResultTypeId) ?? null) : null,
  });

  function payoutForTierIds(tierIds: Set<string>) {
    const rules = allRules.filter((rule) => tierIds.has(rule.valueTierId));
    return { rules, ...computePayout(rules, rewardContextOf) };
  }

  const nextRung = fullLadder.find((rung) => !rung.achieved) ?? null;
  const nextTier: NextTierInfo | null = nextRung
    ? {
        order: nextRung.order,
        gap: Prisma.Decimal.max(nextRung.threshold.minus(attainmentValue), 0),
        potentialPayout: payoutForTierIds(new Set(pickAchievedTiers(nextRung.threshold, thresholds, base.triggerMode).map((t) => t.id))).payoutValue,
      }
    : null;

  const topRung = [...thresholds].sort((a, b) => b.order - a.order)[0] ?? null;
  const topTierPotentialPayout = topRung
    ? payoutForTierIds(new Set(pickAchievedTiers(topRung.threshold, thresholds, base.triggerMode).map((t) => t.id))).payoutValue
    : new Prisma.Decimal(0);

  const firstFailed = conditionalChecks.find((check) => !check.passed) ?? null;
  if (firstFailed) {
    return {
      eligible: false,
      blockedReason: "Bloqueado por Condição Comercial",
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      mainRealized,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: firstFailed,
      nextTier,
      topTierPotentialPayout,
    };
  }

  const { rules: achievedRules, payoutValue, physicalPrizeDescription } = payoutForTierIds(achievedIds);
  if (achievedRules.length === 0) {
    return {
      eligible: true,
      blockedReason: null,
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      mainRealized,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: null,
      nextTier,
      topTierPotentialPayout,
    };
  }

  const tierBreakdown: TierPayoutBreakdown[] = achievedRules.map((rule) => {
    const source = base.valueTiers.find((t) => t.id === rule.valueTierId)!;
    const ctx = rewardContextOf(rule);
    const result = computeTierPayout(rule, ctx);
    const baseValueUsed =
      rule.rewardType === "PERCENT_FIXO" ? resolveFixedSalary(ctx.member, ctx.cargo) : rule.rewardType === "PERCENT_RESULTADO" ? ctx.rewardResultRealized : null;
    return {
      order: source.order,
      rewardType: rule.rewardType,
      baseValueUsed,
      computedAmount: result.payoutValue,
      physicalPrizeDescription: result.physicalPrizeDescription,
    };
  });

  return {
    eligible: true,
    blockedReason: null,
    payoutValue,
    physicalPrizeDescription,
    metaTotal: base.indicatorType === "META" ? metaTotal : null,
    mainRealized,
    attainmentValue,
    achievedTiers: achievedTiersInfo,
    fullLadder,
    tierBreakdown,
    conditionalChecks,
    blockedTrigger: null,
    nextTier,
    topTierPotentialPayout,
  };
}

// ============================================================
// Minhas Bases — Detalhe (autoatendimento, ambiente SIMULADO): nunca lê
// Realizado, só converte os limiares (Gatilhos/Degraus) em valor-alvo por
// período de fechamento. Na trilha META o limiar é um percentual — o valor
// absoluto exigido muda de período pra período porque a Meta de referência
// tem sazonalidade; na trilha RESULTADO o limiar já é um valor absoluto,
// constante em todo período (comportamento esperado, confirmado pelo
// usuário).
// ============================================================

export function computeRequiredValue(
  indicatorType: ReceivablesIndicatorType,
  thresholdOrMinimum: Prisma.Decimal,
  referenceTotalForWindow: Prisma.Decimal,
): Prisma.Decimal {
  if (indicatorType === "RESULTADO") return thresholdOrMinimum;
  return thresholdOrMinimum.dividedBy(100).times(referenceTotalForWindow);
}

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Mesmo padrão de monthWindow (acompanhamento.service.ts), duplicado
// localmente (convenção já usada no projeto para helpers pequenos de data).
function monthPageWindow(referenceStart: Date, monthOffset: number): PeriodWindow {
  const start = new Date(Date.UTC(referenceStart.getUTCFullYear(), referenceStart.getUTCMonth() + monthOffset, 1));
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, endExclusive };
}

function twelveMonthPageWindow(referenceStart: Date, blockOffset: number): PeriodWindow {
  const start = new Date(Date.UTC(referenceStart.getUTCFullYear(), referenceStart.getUTCMonth() + blockOffset * 12, 1));
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 1));
  return { start, endExclusive };
}

function totalMonthsBetween(start: Date, endExclusive: Date): number {
  const endInclusive = addDaysUtc(endExclusive, -1);
  return (endInclusive.getUTCFullYear() - start.getUTCFullYear()) * 12 + (endInclusive.getUTCMonth() - start.getUTCMonth()) + 1;
}

export interface ReceivablesBasePageResult {
  periodWindows: PeriodWindow[];
  pagination: { offset: number; hasPrev: boolean; hasNext: boolean } | null;
}

// Diário/Semanal sempre paginam por mês civil (mesmo padrão de Acompanhamento
// pra granularidade Dia/Semana). Mensal/Trimestral/Anual só paginam (em
// blocos de 12 meses) se o total de janelas passar de 12; senão devolvem
// tudo numa página só (pagination null).
export function resolveReceivablesBasePage(
  periodicity: ReceivablesPeriodicity,
  rangeStart: Date,
  rangeEndExclusive: Date,
  page: number,
): ReceivablesBasePageResult {
  if (rangeStart >= rangeEndExclusive) return { periodWindows: [], pagination: null };

  const isDailyOrWeekly = periodicity === "DIARIO" || periodicity === "SEMANAL";
  const totalMonths = Math.max(totalMonthsBetween(rangeStart, rangeEndExclusive), 1);

  function clip(window: PeriodWindow): PeriodWindow {
    const start = window.start < rangeStart ? rangeStart : window.start;
    const endExclusive = window.endExclusive > rangeEndExclusive ? rangeEndExclusive : window.endExclusive;
    return { start, endExclusive };
  }

  if (isDailyOrWeekly) {
    const clampedOffset = Math.min(Math.max(page, 0), totalMonths - 1);
    const clipped = clip(monthPageWindow(rangeStart, clampedOffset));
    return {
      periodWindows: enumeratePeriodWindows(periodicity, clipped.start, clipped.endExclusive),
      pagination: { offset: clampedOffset, hasPrev: clampedOffset > 0, hasNext: clampedOffset < totalMonths - 1 },
    };
  }

  const allWindows = enumeratePeriodWindows(periodicity, rangeStart, rangeEndExclusive);
  if (allWindows.length <= 12) {
    return { periodWindows: allWindows, pagination: null };
  }

  const totalBlocks = Math.max(Math.ceil(totalMonths / 12), 1);
  const clampedOffset = Math.min(Math.max(page, 0), totalBlocks - 1);
  const clipped = clip(twelveMonthPageWindow(rangeStart, clampedOffset));
  return {
    periodWindows: enumeratePeriodWindows(periodicity, clipped.start, clipped.endExclusive),
    pagination: { offset: clampedOffset, hasPrev: clampedOffset > 0, hasNext: clampedOffset < totalBlocks - 1 },
  };
}

export interface MyReceivablesBaseDetailResponse {
  id: string;
  name: string;
  indicatorType: ReceivablesIndicatorType;
  goalOrResultLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: Date | null;
  endDate: Date | null;
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  // Ancestralidade da Entidade de Análise (canal→...→pai imediato, mesmo
  // formato de buildHierarchyPath usado em Metas/Fechamento) — null quando
  // não há nada acima (Canal/Empresa). O client monta a string final
  // (ordem invertida + nome/nível no fim) — ver MyReceivablesBaseDetailPage.tsx.
  hierarchyPath: string | null;
  // false só quando um Gestor de acesso PARCIAL está vendo o detalhe de um
  // Beneficiário fora do seu escopo (getReceivablesBaseDetailForBeneficiary)
  // — autoatendimento (getMyReceivablesBaseDetail) é sempre true, já que
  // simular o próprio Recebível nunca é bloqueado por escopo.
  canSimulate: boolean;
  conditionalTriggers: {
    id: string;
    label: string;
    verificationLevel: OrgScopeType;
    indicatorType: ReceivablesIndicatorType;
    requiredMinimum: Prisma.Decimal;
  }[];
  tierLadder: {
    order: number;
    thresholdValue: Prisma.Decimal;
    rules: {
      rewardType: RewardType;
      rewardResultTypeName: string | null;
      rewardPercentage: Prisma.Decimal | null;
      rewardFixedValue: Prisma.Decimal | null;
      rewardDescription: string | null;
    }[];
  }[];
  tierPeriods: { periodStart: Date; periodEndExclusive: Date; tiers: { order: number; requiredValue: Prisma.Decimal }[] }[];
  triggerSeries: {
    triggerId: string;
    label: string;
    points: { periodStart: Date; periodEndExclusive: Date; requiredValue: Prisma.Decimal }[];
  }[];
  pagination: { offset: number; hasPrev: boolean; hasNext: boolean } | null;
}

async function buildReceivablesBaseDetailForBeneficiary(
  companyId: string,
  base: Awaited<ReturnType<typeof fetchReceivablesBaseDetail>>,
  beneficiary: Awaited<ReturnType<typeof fetchReceivablesBaseDetail>>["beneficiaries"][number],
  canSimulate: boolean,
  page: number,
): Promise<MyReceivablesBaseDetailResponse> {
  const beneficiaryAncestorIds = await resolveAncestorIds(companyId, beneficiary.entityType, beneficiary.entityId);
  const hierarchyPath = await buildHierarchyPath(companyId, beneficiary.entityType, beneficiaryAncestorIds);

  const goalOrResultLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");

  const applicableTriggers = base.conditionalTriggers.filter((trigger) =>
    triggerAppliesToMember(trigger.applicableMemberIds, beneficiary.memberId),
  );
  const conditionalTriggers = applicableTriggers.map((trigger) => ({
    id: trigger.id,
    label: trigger.indicatorType === "META" ? (trigger.conditionalGoal?.name ?? "—") : (trigger.resultType?.name ?? "—"),
    verificationLevel: trigger.verificationLevel,
    indicatorType: trigger.indicatorType,
    requiredMinimum:
      trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0)),
  }));

  const tierLadder = base.valueTiers.map((tier) => ({
    order: tier.order,
    thresholdValue: tier.thresholdValue,
    rules: base.tierRules
      .filter((rule) => rule.valueTierId === tier.id)
      .map((rule) => ({
        rewardType: rule.rewardType,
        rewardResultTypeName: rule.rewardResultType?.name ?? null,
        rewardPercentage: rule.rewardPercentage,
        rewardFixedValue: rule.rewardFixedValue,
        rewardDescription: rule.rewardDescription,
      })),
  }));

  const rangeStart = base.startDate ?? toUtcDateOnly(base.createdAt);
  const today = toUtcDateOnly(new Date());
  const tomorrow = addDaysUtc(today, 1);
  const vigenciaEndExclusive = base.endDate ? addDaysUtc(base.endDate, 1) : tomorrow;
  const rangeEndExclusive = vigenciaEndExclusive < tomorrow ? vigenciaEndExclusive : tomorrow;

  const { periodWindows, pagination } = resolveReceivablesBasePage(base.periodicity, rangeStart, rangeEndExclusive, page);

  const tierPeriods: MyReceivablesBaseDetailResponse["tierPeriods"] = [];
  const triggerPointsByTriggerId = new Map<string, MyReceivablesBaseDetailResponse["triggerSeries"][number]["points"]>(
    applicableTriggers.map((trigger) => [trigger.id, []]),
  );

  for (const window of periodWindows) {
    let metaTotal = new Prisma.Decimal(0);
    if (base.indicatorType === "META" && base.primaryGoalCampaignId) {
      const daily = await dailyMapOfActiveLine(companyId, base.primaryGoalCampaignId, beneficiary.entityType, beneficiary.entityId);
      metaTotal = sumDailyMapInWindow(daily, window);
    }
    const tiers = base.valueTiers.map((tier) => ({
      order: tier.order,
      requiredValue: computeRequiredValue(base.indicatorType, tier.thresholdValue, metaTotal),
    }));
    tierPeriods.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, tiers });

    for (const trigger of applicableTriggers) {
      let conditionalTotal = new Prisma.Decimal(0);
      if (trigger.indicatorType === "META" && trigger.conditionalGoalCampaignId) {
        const conditionEntityId = await resolveMemberLevelEntity(companyId, beneficiary.memberId, trigger.verificationLevel);
        if (conditionEntityId) {
          const daily = await dailyMapOfActiveLine(companyId, trigger.conditionalGoalCampaignId, trigger.verificationLevel, conditionEntityId);
          conditionalTotal = sumDailyMapInWindow(daily, window);
        }
      }
      const requiredMinimum =
        trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0));
      const requiredValue = computeRequiredValue(trigger.indicatorType, requiredMinimum, conditionalTotal);
      triggerPointsByTriggerId.get(trigger.id)?.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, requiredValue });
    }
  }

  const triggerSeries = conditionalTriggers.map((trigger) => ({
    triggerId: trigger.id,
    label: trigger.label,
    points: triggerPointsByTriggerId.get(trigger.id) ?? [],
  }));

  return {
    id: base.id,
    name: base.name,
    indicatorType: base.indicatorType,
    goalOrResultLabel,
    periodicity: base.periodicity,
    triggerMode: base.triggerMode,
    startDate: base.startDate,
    endDate: base.endDate,
    entityType: beneficiary.entityType,
    entityId: beneficiary.entityId,
    entityName: beneficiary.entityName,
    hierarchyPath,
    canSimulate,
    conditionalTriggers,
    tierLadder,
    tierPeriods,
    triggerSeries,
    pagination,
  };
}

export async function getMyReceivablesBaseDetail(
  companyId: string,
  requestingUser: RequestingUser,
  baseId: string,
  page = 0,
): Promise<MyReceivablesBaseDetailResponse> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) throw new NotFoundError("Base de Recebível não encontrada");

  const base = await fetchReceivablesBaseDetail(companyId, baseId);
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Base de Recebível não encontrada");

  return buildReceivablesBaseDetailForBeneficiary(companyId, base, beneficiary, true, page);
}

// Mesma tela de detalhe de "Minhas Bases", reaproveitada pelo Admin/Gestor
// pra ver o Recebível de QUALQUER Beneficiário da Base de forma objetiva —
// chamada pela tabela de Beneficiários em ReceivablesBaseDetailPage.tsx.
// Visualizar é liberado pra acesso PARCIAL também (mesma filosofia de
// getReceivablesBaseDetail: "abre a Base inteira pra contexto"); só
// `canSimulate` fica false se o Beneficiário estiver fora do escopo do
// Gestor PARCIAL — Simular continua restrito, mesma regra já aplicada em
// simulateReceivablesBase.
export async function getReceivablesBaseDetailForBeneficiary(
  companyId: string,
  requestingUser: RequestingUser,
  baseId: string,
  memberId: string,
  page = 0,
): Promise<MyReceivablesBaseDetailResponse> {
  const base = await fetchReceivablesBaseDetail(companyId, baseId);
  const access = await resolveReceivablesBaseAccess(
    companyId,
    requestingUser,
    base.beneficiaries.map((b) => b.memberId),
  );
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para consultar esta Base de Recebível.");
  }

  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Beneficiário não encontrado nesta Base de Recebível.");

  const canSimulate = access.level === "FULL" || access.ownedMemberIds.has(memberId);
  return buildReceivablesBaseDetailForBeneficiary(companyId, base, beneficiary, canSimulate, page);
}
