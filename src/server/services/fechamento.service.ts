import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import { Prisma, type BenefitApprovalStatus, type OrgScopeType, type PeriodStatus } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "../utils/http-errors";
import { toDate } from "./resultados.service";
import { buildHierarchyPath, resolveAncestorIds } from "./metas.service";
import { buildMemberScopeFilter } from "./bases-metas.service";
import { resolveFixedSalary } from "./cargos.service";
import { computeMemberReceivablesRows, type MemberReceivableRow } from "./recebiveis.service";
import type { TierPayoutBreakdown } from "./bases-recebiveis.service";
import { assertNativeVisibleMembers, resolveNativeVisibleMemberFilter, resolveRequesterMemberId, type RequestingUser } from "./scope.util";

// "Abrir/Fechar Mês" (CommercialPeriod) é a trava de escrita em Resultados
// da empresa inteira — sem Membro pra escopar, continua exclusiva do
// Administrador (PASSO 5b).
function assertAdmin(requestingUser: RequestingUser) {
  if (requestingUser.role !== "ADMINISTRADOR") {
    throw new ForbiddenError("Esta ação é exclusiva do Administrador.");
  }
}

// Detalhe/Salvar/Reabrir de um Fechamento giram em torno de 1 Membro — a
// partir do PASSO 5b, Gestão também acessa (ver + aprovar/reprovar
// benefícios) os Membros dentro da própria hierarquia (escopo nativo, o
// mesmo de Recebíveis — sem teto configurável). Escrita (Fechar/Reabrir)
// continua exclusiva de Admin/Gestor — ver assertAdminOrGestor abaixo.
function assertAdminOrGestor(requestingUser: RequestingUser) {
  if (requestingUser.role === "OPERACIONAL") {
    throw new ForbiddenError("Fechamento não está disponível para o seu nível de acesso.");
  }
}

// PASSO 9.12: leitura (listagem/detalhe) passou a valer para TODOS os
// papéis, inclusive Usuário — só para VER o próprio Fechamento, nunca
// editar/liberar. Sem checagem de role aqui de propósito: o escopo nativo
// (resolveNativeVisibleMemberFilter/assertNativeVisibleMembers, já usado
// por resolveEligibleMembers/getClosingDetail) já restringe Usuário a
// enxergar só o próprio Membro vinculado — esta função existe só para
// documentar, no ponto de chamada, que a decisão de liberar leitura pra
// todo mundo foi deliberada (espelha assertAdminOrGestor/assertAdmin).
function assertCanViewFechamento(_requestingUser: RequestingUser) {
  // Nenhuma checagem de role: a filtragem por Membro (nativa) já cobre.
}

// Trava de auto-fechamento: um Gestor pode ver o próprio Fechamento (fica
// em getClosingDetail, sem essa checagem), mas não pode Fechar nem Reabrir
// o próprio benefício — só um Administrador fecha/reabre o benefício de um
// Gestor. Não se aplica a Membros comuns dentro da hierarquia liderada.
async function assertNotSelfClosing(companyId: string, requestingUser: RequestingUser, targetMemberId: string) {
  if (requestingUser.role === "ADMINISTRADOR") return;
  const ownMemberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (ownMemberId && ownMemberId === targetMemberId) {
    throw new ForbiddenError("Você não pode fechar/reabrir o seu próprio benefício. Peça a um Administrador.");
  }
}

export function firstDayOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
export function firstDayOfNextMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Meses (1º dia de cada mês) cobertos por [rangeStart, rangeEnd], inclusive.
export function monthsInRange(rangeStart: Date, rangeEnd: Date): Date[] {
  const months: Date[] = [];
  let cursor = firstDayOfMonthUtc(rangeStart);
  const last = firstDayOfMonthUtc(rangeEnd);
  while (cursor <= last) {
    months.push(cursor);
    cursor = firstDayOfNextMonthUtc(cursor);
  }
  return months;
}

// Mês a que uma janela de Recebível pertence, para fins de agrupamento do
// Fechamento (Membro+Mês, mesmo critério do bucket mensal fixo já usado no
// gráfico "Benefícios por Fechamento" da tela de Recebíveis): o mês em que a
// janela TERMINA — uma Base Trimestral encerrada em Março pertence a Março,
// mesmo tendo começado em Janeiro.
export function monthBucketOf(periodEndExclusive: Date): Date {
  const lastDay = new Date(periodEndExclusive);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return firstDayOfMonthUtc(lastDay);
}

// Rótulos desta tela: Previsto/Aberto/Fechado — "Aberto" aqui é o mesmo
// conceito de WindowStatus.LIBERADO já usado na tela de Recebíveis (mês
// terminou, ainda sem MemberClosing salvo), só com rótulo diferente
// (confirmado com o usuário: a intenção real era "Fechado", não "Liberado").
export type ClosingStatus = "PREVISTO" | "ABERTO" | "FECHADO";

// ============================================================
// Motor de Cálculo AO VIVO de um Fechamento (Membro+Mês) — reaproveita
// computeMemberReceivablesRows (recebiveis.service.ts), o mesmo motor da
// tela de Recebíveis, alimentado com a janela do mês. Usado tanto para
// pré-visualizar um Fechamento ainda não salvo quanto para congelar os
// valores em saveClosing — "salvar o que foi mostrado".
// ============================================================

export interface ClosingCampaignRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: "META" | "RESULTADO";
  indicatorLabel: string;
  triggerMode: "FAIXA" | "CUMULATIVO";
  periodStart: Date;
  periodEndExclusive: Date;
  // null na trilha RESULTADO — não existe % de atingimento de Meta.
  attainmentPercentage: Prisma.Decimal | null;
  realizedValue: Prisma.Decimal;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  tierBreakdown: TierPayoutBreakdown[];
  approvalStatus: BenefitApprovalStatus;
}

export interface BenefitsByType {
  PERCENT_FIXO: string;
  PERCENT_RESULTADO: string;
  VALOR_FIXO: string;
  PREMIO_FISICO: string[];
}

export interface ResultByType {
  resultTypeId: string;
  resultTypeName: string;
  totalValue: string;
}

function toCampaignRows(rows: MemberReceivableRow[]): ClosingCampaignRow[] {
  return rows.map((row) => ({
    receivablesBaseId: row.receivablesBaseId,
    baseName: row.baseName,
    indicatorType: row.indicatorType,
    indicatorLabel: row.indicatorLabel,
    triggerMode: row.triggerMode,
    periodStart: row.periodStart,
    periodEndExclusive: row.periodEndExclusive,
    attainmentPercentage: row.indicatorType === "META" ? row.attainmentValue : null,
    realizedValue: row.mainRealized,
    eligible: row.eligible,
    blockedReason: row.blockedReason,
    payoutValue: row.payoutValue,
    physicalPrizeDescription: row.physicalPrizeDescription,
    tierBreakdown: row.tierBreakdown,
    approvalStatus: "APROVADO",
  }));
}

// Soma os benefícios das Campanhas APROVADAS (Reprovado some da soma), por
// tipo de recompensa — cada linha de Campanha pode ter vários degraus
// atingidos (Cumulativo), cada um com seu próprio RewardType.
export function computeBenefitsByType(campaigns: ClosingCampaignRow[]) {
  let percentFixo = new Prisma.Decimal(0);
  let percentResultado = new Prisma.Decimal(0);
  let valorFixo = new Prisma.Decimal(0);
  const premios: string[] = [];

  for (const campaign of campaigns) {
    if (campaign.approvalStatus === "REPROVADO") continue;
    for (const tier of campaign.tierBreakdown) {
      switch (tier.rewardType) {
        case "PERCENT_FIXO":
          percentFixo = percentFixo.plus(tier.computedAmount);
          break;
        case "PERCENT_RESULTADO":
          percentResultado = percentResultado.plus(tier.computedAmount);
          break;
        case "VALOR_FIXO":
          valorFixo = valorFixo.plus(tier.computedAmount);
          break;
        case "PREMIO_FISICO":
          if (tier.physicalPrizeDescription) premios.push(tier.physicalPrizeDescription);
          break;
      }
    }
  }

  return { percentFixo, percentResultado, valorFixo, premios };
}

// Todos os Tipos de Resultado lançados pelo Membro no mês (ResultEntry +
// OperationalAdjustment), independente de terem alimentado alguma Meta ou
// Campanha de Recebível ativa — pedido explícito do usuário.
async function computeResultsByType(companyId: string, memberId: string, monthStart: Date, monthEndExclusive: Date): Promise<ResultByType[]> {
  const [entries, adjustments] = await Promise.all([
    prisma.resultEntry.groupBy({
      by: ["typeId"],
      where: { companyId, memberId, date: { gte: monthStart, lt: monthEndExclusive } },
      _sum: { value: true },
    }),
    prisma.operationalAdjustment.groupBy({
      by: ["typeId"],
      where: { companyId, memberId, dateReference: { gte: monthStart, lt: monthEndExclusive } },
      _sum: { value: true },
    }),
  ]);

  const totals = new Map<string, Prisma.Decimal>();
  for (const entry of entries) {
    totals.set(entry.typeId, (totals.get(entry.typeId) ?? new Prisma.Decimal(0)).plus(entry._sum.value ?? 0));
  }
  for (const adjustment of adjustments) {
    totals.set(adjustment.typeId, (totals.get(adjustment.typeId) ?? new Prisma.Decimal(0)).plus(adjustment._sum.value ?? 0));
  }
  if (totals.size === 0) return [];

  const types = await prisma.resultType.findMany({ where: { id: { in: [...totals.keys()] } }, select: { id: true, name: true } });
  const nameById = new Map(types.map((type) => [type.id, type.name]));

  return [...totals.entries()].map(([resultTypeId, totalValue]) => ({
    resultTypeId,
    resultTypeName: nameById.get(resultTypeId) ?? "—",
    totalValue: totalValue.toString(),
  }));
}

interface MemberWithCargo {
  id: string;
  fullName: string;
  customFixedSalary: Prisma.Decimal | null;
  cargo: { id: string; name: string; defaultFixedSalary: Prisma.Decimal };
}

async function computeLiveClosing(companyId: string, member: MemberWithCargo, monthStart: Date, monthEndExclusive: Date, referenceDate: Date) {
  const liveRows = await computeMemberReceivablesRows(companyId, member.id, monthStart, monthEndExclusive, referenceDate, new Map());
  const campaigns = toCampaignRows(liveRows);
  const fixedValue = resolveFixedSalary({ customFixedSalary: member.customFixedSalary }, { defaultFixedSalary: member.cargo.defaultFixedSalary });
  const { percentFixo, percentResultado, valorFixo, premios } = computeBenefitsByType(campaigns);
  const resultsByType = await computeResultsByType(companyId, member.id, monthStart, monthEndExclusive);

  return {
    memberId: member.id,
    memberName: member.fullName,
    cargoName: member.cargo.name,
    fixedValue,
    campaigns,
    benefitsByType: { PERCENT_FIXO: percentFixo.toString(), PERCENT_RESULTADO: percentResultado.toString(), VALOR_FIXO: valorFixo.toString(), PREMIO_FISICO: premios } as BenefitsByType,
    resultsByType,
    totalValue: fixedValue.plus(percentFixo).plus(percentResultado).plus(valorFixo),
  };
}

// ============================================================
// Listagem (Gestor Administrador vê todos os Fechamentos, filtrando por
// Status/Hierarquia/Cargo/Nome/Período) — spec § Fechamento, pedido
// detalhado do usuário.
// ============================================================

export interface ClosingListFilters {
  status: ClosingStatus[];
  entityType: OrgScopeType;
  entityIds: string[];
  cargoId: string | null;
  search: string | null;
  periodStart: string;
  periodEnd: string;
}

export interface ClosingListRow {
  memberId: string;
  memberName: string;
  cargoName: string;
  hierarchyPath: string | null;
  referenceMonth: Date;
  status: ClosingStatus;
  fixedValue: Prisma.Decimal;
  benefitsValue: Prisma.Decimal;
  totalValue: Prisma.Decimal;
}

async function resolveEligibleMembers(
  companyId: string,
  requestingUser: RequestingUser,
  filters: Pick<ClosingListFilters, "entityType" | "entityIds" | "cargoId" | "search">,
) {
  const scopeWhere: Prisma.MemberWhereInput =
    filters.entityType === "EMPRESA"
      ? {}
      : filters.entityType === "MEMBRO"
        ? { id: { in: filters.entityIds } }
        : { OR: filters.entityIds.map((id) => buildMemberScopeFilter(filters.entityType, id)) };

  const visibilityFilter = await resolveNativeVisibleMemberFilter(companyId, requestingUser);

  return prisma.member.findMany({
    where: {
      companyId,
      AND: visibilityFilter === "ALL" ? [scopeWhere] : [scopeWhere, visibilityFilter],
      ...(filters.cargoId ? { cargoId: filters.cargoId } : {}),
      ...(filters.search ? { fullName: { contains: filters.search, mode: "insensitive" as const } } : {}),
    },
    select: {
      id: true,
      fullName: true,
      customFixedSalary: true,
      teamId: true,
      cargo: { select: { id: true, name: true, defaultFixedSalary: true } },
    },
  });
}

export async function listClosings(companyId: string, requestingUser: RequestingUser, filters: ClosingListFilters): Promise<ClosingListRow[]> {
  assertCanViewFechamento(requestingUser);

  const members = await resolveEligibleMembers(companyId, requestingUser, filters);
  const membersWithCargo = members.filter((m): m is typeof m & { cargo: NonNullable<(typeof m)["cargo"]> } => m.cargo !== null);
  if (membersWithCargo.length === 0) return [];

  const rangeStart = toDate(filters.periodStart);
  const rangeEnd = toDate(filters.periodEnd);
  const rangeEndExclusive = firstDayOfNextMonthUtc(rangeEnd);
  const months = monthsInRange(rangeStart, rangeEnd);
  const referenceDate = new Date();

  const existingClosings = await prisma.memberClosing.findMany({
    where: {
      companyId,
      memberId: { in: membersWithCargo.map((m) => m.id) },
      referenceMonth: { gte: firstDayOfMonthUtc(rangeStart), lt: rangeEndExclusive },
    },
  });
  const closingByKey = new Map(existingClosings.map((c) => [`${c.memberId}:${monthKeyOf(c.referenceMonth)}`, c]));

  const baseCache = new Map();
  const rows: ClosingListRow[] = [];

  for (const member of membersWithCargo) {
    const ancestry = await resolveAncestorIds(companyId, "MEMBRO", member.id);
    const hierarchyPath = await buildHierarchyPath(companyId, "MEMBRO", ancestry);
    const monthlyFixed = resolveFixedSalary({ customFixedSalary: member.customFixedSalary }, { defaultFixedSalary: member.cargo.defaultFixedSalary });

    // 1 chamada cobrindo o intervalo inteiro (evita recomputar/duplicar
    // janelas maiores que 1 mês — ex: Base Trimestral apareceria em cada
    // mês do range se chamado mês a mês).
    const liveRows = await computeMemberReceivablesRows(companyId, member.id, rangeStart, rangeEndExclusive, referenceDate, baseCache);
    const liveByMonthKey = new Map<string, MemberReceivableRow[]>();
    for (const row of liveRows) {
      const key = monthKeyOf(monthBucketOf(row.periodEndExclusive));
      const list = liveByMonthKey.get(key) ?? [];
      list.push(row);
      liveByMonthKey.set(key, list);
    }

    for (const month of months) {
      const key = `${member.id}:${monthKeyOf(month)}`;
      const saved = closingByKey.get(key);

      if (saved) {
        rows.push({
          memberId: member.id,
          memberName: member.fullName,
          cargoName: member.cargo.name,
          hierarchyPath,
          referenceMonth: month,
          status: "FECHADO",
          fixedValue: saved.fixedSalarySnapshot,
          benefitsValue: saved.totalValue.minus(saved.fixedSalarySnapshot).minus(saved.manualAdjustmentValue ?? new Prisma.Decimal(0)),
          totalValue: saved.totalValue,
        });
        continue;
      }

      const monthEnded = referenceDate >= firstDayOfNextMonthUtc(month);
      const status: ClosingStatus = monthEnded ? "ABERTO" : "PREVISTO";
      const monthLiveRows = liveByMonthKey.get(monthKeyOf(month)) ?? [];
      const benefitsValue = monthLiveRows
        .filter((row) => row.eligible)
        .reduce((sum, row) => sum.plus(row.payoutValue), new Prisma.Decimal(0));

      rows.push({
        memberId: member.id,
        memberName: member.fullName,
        cargoName: member.cargo.name,
        hierarchyPath,
        referenceMonth: month,
        status,
        fixedValue: monthlyFixed,
        benefitsValue,
        totalValue: monthlyFixed.plus(benefitsValue),
      });
    }
  }

  const statusFilter = new Set(filters.status.length > 0 ? filters.status : (["PREVISTO", "ABERTO", "FECHADO"] as ClosingStatus[]));
  return rows
    .filter((row) => statusFilter.has(row.status))
    .sort((a, b) => b.referenceMonth.getTime() - a.referenceMonth.getTime() || a.memberName.localeCompare(b.memberName));
}

// ============================================================
// Detalhe de um Fechamento (Membro+Mês) — lê do banco se já salvo, senão
// computa ao vivo (mesmo motor do preview).
// ============================================================

export interface ClosingDetail {
  memberId: string;
  memberName: string;
  cargoName: string;
  hierarchyPath: string | null;
  referenceMonth: Date;
  isSaved: boolean;
  status: ClosingStatus;
  fixedValue: Prisma.Decimal;
  campaigns: ClosingCampaignRow[];
  resultsByType: ResultByType[];
  benefitsByType: BenefitsByType;
  totalValue: Prisma.Decimal;
  manualAdjustmentValue: Prisma.Decimal | null;
  manualAdjustmentReason: string | null;
  comments: string | null;
  closedAt: Date | null;
}

async function getMemberWithCargoOrThrow(companyId: string, memberId: string): Promise<MemberWithCargo> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, companyId },
    include: { cargo: { select: { id: true, name: true, defaultFixedSalary: true } } },
  });
  if (!member || !member.cargo) throw new NotFoundError("Membro ou Cargo não encontrado");
  return member as MemberWithCargo;
}

export async function getClosingDetail(companyId: string, requestingUser: RequestingUser, memberId: string, referenceMonthIso: string): Promise<ClosingDetail> {
  assertCanViewFechamento(requestingUser);
  await assertNativeVisibleMembers(companyId, requestingUser, [memberId], "Você não tem permissão para ver o Fechamento deste Membro.");

  const member = await getMemberWithCargoOrThrow(companyId, memberId);
  const monthStart = firstDayOfMonthUtc(toDate(referenceMonthIso));
  const monthEndExclusive = firstDayOfNextMonthUtc(monthStart);
  const referenceDate = new Date();
  const ancestry = await resolveAncestorIds(companyId, "MEMBRO", memberId);
  const hierarchyPath = await buildHierarchyPath(companyId, "MEMBRO", ancestry);

  const saved = await prisma.memberClosing.findUnique({
    where: { memberId_referenceMonth: { memberId, referenceMonth: monthStart } },
    include: {
      snapshots: {
        include: {
          receivablesBase: {
            select: { name: true, indicatorType: true, triggerMode: true, primaryGoal: { select: { name: true } }, resultType: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (saved) {
    const campaigns: ClosingCampaignRow[] = saved.snapshots.map((snapshot) => ({
      receivablesBaseId: snapshot.receivablesBaseId,
      baseName: snapshot.receivablesBase.name,
      indicatorType: snapshot.receivablesBase.indicatorType,
      indicatorLabel:
        snapshot.receivablesBase.indicatorType === "META"
          ? (snapshot.receivablesBase.primaryGoal?.name ?? "—")
          : (snapshot.receivablesBase.resultType?.name ?? "—"),
      triggerMode: snapshot.receivablesBase.triggerMode,
      periodStart: snapshot.periodStart,
      periodEndExclusive: snapshot.periodEndExclusive,
      attainmentPercentage: snapshot.attainmentPercentage,
      realizedValue: snapshot.realizedNetValue,
      eligible: snapshot.eligibilityStatus,
      blockedReason: snapshot.blockedReason,
      payoutValue: snapshot.payoutValue,
      physicalPrizeDescription: snapshot.physicalPrizeDescription,
      tierBreakdown: snapshot.tierBreakdown as unknown as TierPayoutBreakdown[],
      approvalStatus: snapshot.approvalStatus,
    }));

    return {
      memberId,
      memberName: member.fullName,
      cargoName: member.cargo.name,
      hierarchyPath,
      referenceMonth: monthStart,
      isSaved: true,
      status: "FECHADO",
      fixedValue: saved.fixedSalarySnapshot,
      campaigns,
      resultsByType: saved.resultsByType as unknown as ResultByType[],
      benefitsByType: saved.benefitsByType as unknown as BenefitsByType,
      totalValue: saved.totalValue,
      manualAdjustmentValue: saved.manualAdjustmentValue,
      manualAdjustmentReason: saved.manualAdjustmentReason,
      comments: saved.comments,
      closedAt: saved.closedAt,
    };
  }

  const live = await computeLiveClosing(companyId, member, monthStart, monthEndExclusive, referenceDate);
  const monthEnded = referenceDate >= monthEndExclusive;

  return {
    ...live,
    hierarchyPath,
    referenceMonth: monthStart,
    isSaved: false,
    status: monthEnded ? "ABERTO" : "PREVISTO",
    manualAdjustmentValue: null,
    manualAdjustmentReason: null,
    comments: null,
    closedAt: null,
  };
}

// ============================================================
// Salvar / Reabrir — sobrescreve (não versiona, decisão confirmada com o
// usuário): Reabrir apaga o MemberClosing (e as FinancialPeriodSnapshot
// filhas); Salvar de novo grava outra vez em cima. O log de auditoria
// (ClosureAuditLog) referencia memberId+referenceMonth solto (não FK para
// MemberClosing) — precisa sobreviver ao ciclo Fechar→Reabrir→Fechar
// inteiro, spec § Fechamento/4 (segurança jurídica).
// ============================================================

// Uma Base pode aparecer mais de uma vez no mesmo Fechamento (ex: Base
// Semanal ~4 janelas/mês) — receivablesBaseId sozinho não identifica a
// linha, precisa da janela (periodStart) junto.
function campaignRowKey(receivablesBaseId: string, periodStart: Date | string): string {
  const iso = typeof periodStart === "string" ? periodStart : periodStart.toISOString();
  return `${receivablesBaseId}:${iso.slice(0, 10)}`;
}

export interface SaveClosingInput {
  approvals: { receivablesBaseId: string; periodStart: string; approvalStatus: BenefitApprovalStatus }[];
  comments: string | null;
  manualAdjustmentValue: number | null;
  manualAdjustmentReason: string | null;
}

// Motivo do Valor Adicional é opcional (mesmo com Valor preenchido) — pedido
// explícito do usuário.
export async function saveClosing(companyId: string, requestingUser: RequestingUser, memberId: string, referenceMonthIso: string, input: SaveClosingInput) {
  assertAdminOrGestor(requestingUser);
  await assertNativeVisibleMembers(companyId, requestingUser, [memberId], "Você não tem permissão para fechar este Membro.");
  await assertNotSelfClosing(companyId, requestingUser, memberId);

  const member = await getMemberWithCargoOrThrow(companyId, memberId);
  const monthStart = firstDayOfMonthUtc(toDate(referenceMonthIso));
  const monthEndExclusive = firstDayOfNextMonthUtc(monthStart);
  const referenceDate = new Date();

  const live = await computeLiveClosing(companyId, member, monthStart, monthEndExclusive, referenceDate);
  const approvalByKey = new Map(input.approvals.map((a) => [campaignRowKey(a.receivablesBaseId, a.periodStart), a.approvalStatus]));
  const campaigns: ClosingCampaignRow[] = live.campaigns.map((campaign) => ({
    ...campaign,
    approvalStatus: approvalByKey.get(campaignRowKey(campaign.receivablesBaseId, campaign.periodStart)) ?? "APROVADO",
  }));

  const { percentFixo, percentResultado, valorFixo, premios } = computeBenefitsByType(campaigns);
  const benefitsByType: BenefitsByType = {
    PERCENT_FIXO: percentFixo.toString(),
    PERCENT_RESULTADO: percentResultado.toString(),
    VALOR_FIXO: valorFixo.toString(),
    PREMIO_FISICO: premios,
  };
  const manualAdjustmentValue = input.manualAdjustmentValue != null ? new Prisma.Decimal(input.manualAdjustmentValue) : null;
  const totalValue = live.fixedValue.plus(percentFixo).plus(percentResultado).plus(valorFixo).plus(manualAdjustmentValue ?? 0);

  const campaignsSummaryText =
    campaigns.length > 0
      ? campaigns
          .map((c) => `${c.baseName}: R$ ${c.payoutValue.toFixed(2)} (${c.approvalStatus === "APROVADO" ? "Aprovado" : "Reprovado"})`)
          .join("; ")
      : "Sem Campanhas de Recebível ativas neste Fechamento.";

  const ancestry = await resolveAncestorIds(companyId, "MEMBRO", memberId);
  const existing = await prisma.memberClosing.findUnique({ where: { memberId_referenceMonth: { memberId, referenceMonth: monthStart } } });
  const totalsBefore = existing ? { totalValue: existing.totalValue.toString() } : Prisma.JsonNull;

  const closingData = {
    teamId: ancestry.teamId,
    departmentId: ancestry.departmentId,
    channelId: ancestry.channelId,
    cargoId: member.cargo.id,
    fixedSalarySnapshot: live.fixedValue,
    benefitsByType: benefitsByType as unknown as Prisma.InputJsonValue,
    resultsByType: live.resultsByType as unknown as Prisma.InputJsonValue,
    campaignsSummaryText,
    totalValue,
    manualAdjustmentValue,
    manualAdjustmentReason: input.manualAdjustmentReason,
    comments: input.comments,
    closedAt: new Date(),
    closedByUserId: requestingUser.id,
  };

  const saved = await withTenant(async (tx) => {
    if (existing) {
      await tx.financialPeriodSnapshot.deleteMany({ where: { memberClosingId: existing.id } });
    }

    const closing = await tx.memberClosing.upsert({
      where: { memberId_referenceMonth: { memberId, referenceMonth: monthStart } },
      create: { companyId, memberId, referenceMonth: monthStart, ...closingData },
      update: closingData,
    });

    if (campaigns.length > 0) {
      await tx.financialPeriodSnapshot.createMany({
        data: campaigns.map((campaign) => ({
          companyId,
          memberClosingId: closing.id,
          memberId,
          receivablesBaseId: campaign.receivablesBaseId,
          periodStart: campaign.periodStart,
          periodEndExclusive: campaign.periodEndExclusive,
          realizedNetValue: campaign.realizedValue,
          attainmentPercentage: campaign.attainmentPercentage,
          tierBreakdown: campaign.tierBreakdown as unknown as Prisma.InputJsonValue,
          eligibilityStatus: campaign.eligible,
          blockedReason: campaign.blockedReason,
          payoutValue: campaign.payoutValue,
          physicalPrizeDescription: campaign.physicalPrizeDescription,
          approvalStatus: campaign.approvalStatus,
        })),
      });
    }

    await tx.closureAuditLog.create({
      data: {
        companyId,
        memberId,
        referenceMonth: monthStart,
        userId: requestingUser.id,
        action: "FECHAMENTO",
        totalsBefore,
        totalsAfter: { totalValue: totalValue.toString() },
      },
    });

    return closing;
  });

  return saved;
}

export interface CloseBulkItem {
  memberId: string;
  referenceMonth: string;
}

export interface CloseBulkResult {
  memberId: string;
  referenceMonth: string;
  ok: boolean;
  error?: string;
}

// PASSO 11.4: "Fechar Selecionados" na listagem — reaproveita saveClosing
// item a item (aprovação automática de todas as Campanhas, sem Comentários/
// Ajuste Manual — só fazem sentido individualmente), com toda a validação
// que ele já tem "de graça" (escopo nativo, auto-fechamento). Loop com
// try/catch por item em vez de 1 transação externa: sucesso parcial é
// aceitável (ex. 1 linha bloqueada por auto-fechamento não deve derrubar o
// lote inteiro) — cada saveClosing já é atômico por conta própria.
export async function saveClosingBulk(
  companyId: string,
  requestingUser: RequestingUser,
  items: CloseBulkItem[],
): Promise<CloseBulkResult[]> {
  const results: CloseBulkResult[] = [];

  for (const item of items) {
    try {
      await saveClosing(companyId, requestingUser, item.memberId, item.referenceMonth, {
        approvals: [],
        comments: null,
        manualAdjustmentValue: null,
        manualAdjustmentReason: null,
      });
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: false, error: message });
    }
  }

  return results;
}

// Espelho exato de saveClosingBulk — mesmo padrão de sucesso parcial (1
// item bloqueado, ex. auto-reabertura do próprio Gestor, não derruba o
// lote inteiro; reopenClosing já é atômico por conta própria).
export async function reopenClosingBulk(
  companyId: string,
  requestingUser: RequestingUser,
  items: CloseBulkItem[],
): Promise<CloseBulkResult[]> {
  const results: CloseBulkResult[] = [];

  for (const item of items) {
    try {
      await reopenClosing(companyId, requestingUser, item.memberId, item.referenceMonth);
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: false, error: message });
    }
  }

  return results;
}

export async function reopenClosing(companyId: string, requestingUser: RequestingUser, memberId: string, referenceMonthIso: string) {
  assertAdminOrGestor(requestingUser);
  await assertNativeVisibleMembers(companyId, requestingUser, [memberId], "Você não tem permissão para reabrir o Fechamento deste Membro.");
  await assertNotSelfClosing(companyId, requestingUser, memberId);

  const monthStart = firstDayOfMonthUtc(toDate(referenceMonthIso));
  const existing = await prisma.memberClosing.findUnique({ where: { memberId_referenceMonth: { memberId, referenceMonth: monthStart } } });
  if (!existing || existing.companyId !== companyId) {
    throw new NotFoundError("Fechamento não encontrado (ou já está Aberto)");
  }

  await withTenant(async (tx) => {
    await tx.financialPeriodSnapshot.deleteMany({ where: { memberClosingId: existing.id } });
    await tx.memberClosing.delete({ where: { id: existing.id } });
    await tx.closureAuditLog.create({
      data: {
        companyId,
        memberId,
        referenceMonth: monthStart,
        userId: requestingUser.id,
        action: "REABERTURA",
        totalsBefore: { totalValue: existing.totalValue.toString() },
        totalsAfter: Prisma.JsonNull,
      },
    });
  });
}

// ============================================================
// CommercialPeriod (trava mensal de escrita em Resultados, spec §
// Resultados/6) — ação simples e separada da revisão por Membro;
// `assertPeriodOpen` (resultados.service.ts) já lê esta tabela em todo
// ponto de escrita de Resultados, só faltava a tela para gerenciá-la.
// ============================================================

export async function listCommercialPeriods(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);
  return prisma.commercialPeriod.findMany({ where: { companyId }, orderBy: { referenceMonth: "desc" } });
}

export async function setCommercialPeriodStatus(companyId: string, requestingUser: RequestingUser, referenceMonthIso: string, status: PeriodStatus) {
  assertAdmin(requestingUser);

  const referenceMonth = firstDayOfMonthUtc(toDate(referenceMonthIso));
  const now = new Date();

  return writeWithTenant((tx) =>
    tx.commercialPeriod.upsert({
      where: { companyId_referenceMonth: { companyId, referenceMonth } },
      create: {
        companyId,
        referenceMonth,
        status,
        closedAt: status === "FECHADO" ? now : null,
        closedByUserId: status === "FECHADO" ? requestingUser.id : null,
      },
      update:
        status === "FECHADO"
          ? { status, closedAt: now, closedByUserId: requestingUser.id }
          : { status, reopenedAt: now, reopenedByUserId: requestingUser.id },
    }),
  );
}
