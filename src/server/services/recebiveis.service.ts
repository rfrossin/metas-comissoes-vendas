import { prisma } from "../config/prisma";
import { Prisma, type BenefitApprovalStatus, type OrgScopeType, type ReceivablesPeriodicity, type RewardType } from "@prisma/client";
import { NotFoundError } from "../utils/http-errors";
import { toDate } from "./resultados.service";
import { isoKey, monthKeyOf } from "./metas.service";
import { buildMemberScopeFilter } from "./bases-metas.service";
import { assertNativeVisibleMembers } from "./scope.util";
import { resolveFixedSalary } from "./cargos.service";
import {
  computeLiveReceivablesOutcome,
  enumeratePeriodWindows,
  fetchReceivablesBaseDetail,
  type PeriodWindow,
  type ReceivablesBaseDetail,
  type TierPayoutBreakdown,
} from "./bases-recebiveis.service";

function addDaysUtc(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

// Duplicada de fechamento.service.ts (não importada de lá para evitar
// ciclo: fechamento.service.ts já importa computeMemberReceivablesRows
// deste arquivo) — mesma implementação trivial de 1 linha.
function firstDayOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ============================================================
// Vínculo empregatício (regra confirmada em 2026-08-06): o Membro só tem
// Recebíveis e Fechamentos dentro de [entryDate, exitDate]. Mora aqui (e
// não em scope.util.ts) porque é regra de NEGÓCIO do cálculo financeiro,
// não de permissão de acesso — quem está fora da janela não é "proibido de
// ver", simplesmente não tem valor a apurar naquele período.
//
// Ambas as pontas são opcionais: sem entryDate o vínculo vale desde sempre,
// sem exitDate ele segue aberto. As comparações usam as datas puras (a
// coluna é DATE, sem hora), e a janela é fechada nas duas pontas —
// trabalhar no próprio dia da entrada ou da saída conta.
// ============================================================

export interface MemberEmploymentWindow {
  entryDate: Date | null;
  exitDate: Date | null;
}

// A janela [periodStart, periodEndExclusive) tem alguma interseção com o
// vínculo do Membro? Usado para decidir se o Membro entra na apuração.
export function overlapsEmployment(member: MemberEmploymentWindow, periodStart: Date, periodEndExclusive: Date): boolean {
  if (member.entryDate && member.entryDate >= periodEndExclusive) return false;
  if (member.exitDate && member.exitDate < periodStart) return false;
  return true;
}

// Mesma regra, para um mês civil identificado por "AAAA-MM" — o Fixo é
// apurado por mês, não por janela de Campanha. Sem isto o Fixo era somado
// para TODO mês do intervalo consultado, inclusive meses anteriores à
// admissão (o Membro passava no filtro por ter vínculo em ALGUM mês do
// range, e depois recebia Fixo em todos eles).
// Mês a que uma janela pertence: o mês em que ela TERMINA (mesmo critério
// de monthBucketOf em fechamento.service.ts — uma Base Trimestral encerrada
// em Março pertence a Março). Duplicado aqui para não criar ciclo de import
// (fechamento.service.ts já importa deste arquivo).
export function monthBucketOfWindow(periodEndExclusive: Date): Date {
  const lastDay = new Date(periodEndExclusive);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return firstDayOfMonthUtc(lastDay);
}

export function monthOverlapsEmployment(member: MemberEmploymentWindow, monthKey: string): boolean {
  const [year, month] = monthKey.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEndExclusive = new Date(Date.UTC(year, month, 1));
  return overlapsEmployment(member, monthStart, monthEndExclusive);
}

// Filtro Prisma equivalente a overlapsEmployment — para não trazer do banco
// Membros que já sabemos estar fora da janela.
export function employmentOverlapFilter(periodStart: Date, periodEndExclusive: Date): Prisma.MemberWhereInput {
  return {
    AND: [
      { OR: [{ entryDate: null }, { entryDate: { lt: periodEndExclusive } }] },
      { OR: [{ exitDate: null }, { exitDate: { gte: periodStart } }] },
    ],
  };
}

// ============================================================
// Status da janela (Recebíveis, macroambiente 8) — computado, não
// persistido. FECHADO só passa a ocorrer quando o Fechamento (PASSO 3,
// ainda não construído) gravar um FinancialPeriodSnapshot; até lá, toda
// janela já encerrada no tempo é LIBERADO (calculado ao vivo com o
// Realizado final, que não muda mais). PREVISTO = janela ainda em
// andamento — fora das somatórias oficiais.
// ============================================================

export type WindowStatus = "FECHADO" | "LIBERADO" | "PREVISTO";

export function resolveWindowStatus(window: PeriodWindow, referenceDate: Date, hasSnapshot: boolean): WindowStatus {
  if (window.endExclusive > referenceDate) return "PREVISTO";
  return hasSnapshot ? "FECHADO" : "LIBERADO";
}

// ============================================================
// Snapshot do Fechamento — quando um Membro+Mês já tem um MemberClosing
// salvo, Recebíveis passa a exibir os valores CONGELADOS dali (Fixo e
// payout de cada janela) em vez de recalcular ao vivo. Um mês reaberto
// (MemberClosing apagado) volta a cair no cálculo ao vivo automaticamente,
// pela simples ausência no mapa pré-carregado. Ver getClosingDetail em
// fechamento.service.ts — mesmo padrão "snapshot se existir, senão live".
// ============================================================

export interface ClosingSnapshotContext {
  // chave: `${memberId}|${monthKeyOf(referenceMonth)}` — Fixo é por mês civil.
  // manualAdjustmentValue: o "Valor Adicional" lançado à mão pelo gestor no
  // Fechamento. Vive só no MemberClosing (não há FinancialPeriodSnapshot
  // para ele, já que não vem de Campanha nenhuma), então precisa ser
  // carregado aqui para que Recebíveis mostre o mesmo total do Fechamento.
  closingByMemberMonth: Map<string, { fixedSalarySnapshot: Prisma.Decimal; manualAdjustmentValue: Prisma.Decimal }>;
  // chave: `${memberId}|${receivablesBaseId}|${isoKey(periodStart)}` —
  // Benefício é por janela exata (uma Base Semanal tem várias janelas/mês).
  snapshotByWindowKey: Map<
    string,
    {
      realizedNetValue: Prisma.Decimal;
      attainmentPercentage: Prisma.Decimal | null;
      tierBreakdown: TierPayoutBreakdown[];
      eligibilityStatus: boolean;
      blockedReason: string | null;
      payoutValue: Prisma.Decimal;
      physicalPrizeDescription: string | null;
      // Decisão do gestor no Fechamento: um benefício REPROVADO não é pago,
      // mesmo tendo payoutValue calculado. Precisa chegar até aqui para que
      // Recebíveis mostre exatamente o que o Fechamento decidiu.
      approvalStatus: BenefitApprovalStatus;
    }
  >;
}

export function windowSnapshotKey(memberId: string, receivablesBaseId: string, periodStart: Date): string {
  return `${memberId}|${receivablesBaseId}|${isoKey(periodStart)}`;
}

// Pré-carrega, de uma vez, todos os MemberClosing+FinancialPeriodSnapshot
// dos Membros dentro do range consultado — evita 1 query por janela por
// Base por Membro (era o padrão antigo via hasFinancialSnapshot).
export async function loadClosingSnapshotContext(
  companyId: string,
  memberIds: string[],
  periodStart: Date,
  periodEndExclusive: Date,
): Promise<ClosingSnapshotContext> {
  const closingByMemberMonth: ClosingSnapshotContext["closingByMemberMonth"] = new Map();
  const snapshotByWindowKey: ClosingSnapshotContext["snapshotByWindowKey"] = new Map();
  if (memberIds.length === 0) return { closingByMemberMonth, snapshotByWindowKey };

  const closings = await prisma.memberClosing.findMany({
    where: {
      companyId,
      memberId: { in: memberIds },
      referenceMonth: { gte: firstDayOfMonthUtc(periodStart), lt: periodEndExclusive },
    },
    include: { snapshots: true },
  });

  for (const closing of closings) {
    closingByMemberMonth.set(`${closing.memberId}|${monthKeyOf(closing.referenceMonth)}`, {
      fixedSalarySnapshot: closing.fixedSalarySnapshot,
      manualAdjustmentValue: closing.manualAdjustmentValue ?? new Prisma.Decimal(0),
    });
    for (const snapshot of closing.snapshots) {
      snapshotByWindowKey.set(windowSnapshotKey(snapshot.memberId, snapshot.receivablesBaseId, snapshot.periodStart), {
        realizedNetValue: snapshot.realizedNetValue,
        attainmentPercentage: snapshot.attainmentPercentage,
        tierBreakdown: snapshot.tierBreakdown as unknown as TierPayoutBreakdown[],
        eligibilityStatus: snapshot.eligibilityStatus,
        blockedReason: snapshot.blockedReason,
        payoutValue: snapshot.payoutValue,
        physicalPrizeDescription: snapshot.physicalPrizeDescription,
        approvalStatus: snapshot.approvalStatus,
      });
    }
  }

  return { closingByMemberMonth, snapshotByWindowKey };
}

// ============================================================
// Segurança (spec § Recebíveis/4): OPERACIONAL só pode consultar a si
// mesmo; LIDERANCA_NO só pode consultar Membros dentro de nós (Canal/
// Departamento/Time) onde é NodeResponsible, ou a si mesmo;
// ADMINISTRADOR irrestrito.
// ============================================================

export async function assertCanViewMembers(
  companyId: string,
  requestingUser: { id: string; companyId: string; role: string },
  targetMemberIds: string[],
): Promise<void> {
  await assertNativeVisibleMembers(
    companyId,
    requestingUser,
    targetMemberIds,
    requestingUser.role === "OPERACIONAL"
      ? "Você só pode consultar os seus próprios Recebíveis."
      : "Você só pode consultar Recebíveis de Membros dentro dos nós que você lidera.",
  );
}

// ============================================================
// Resolução de Membros selecionados (filtro de Escopo da tela)
// ============================================================

export interface MemberLite {
  id: string;
  fullName: string;
  customFixedSalary: Prisma.Decimal | null;
  entryDate: Date | null;
  exitDate: Date | null;
  cargo: { id: string; name: string; defaultFixedSalary: Prisma.Decimal } | null;
}

async function resolveSelectedMembers(
  companyId: string,
  entityType: OrgScopeType,
  entityIds: string[],
  periodStart: Date,
  periodEndExclusive: Date,
): Promise<MemberLite[]> {
  const scopeWhere: Prisma.MemberWhereInput =
    entityType === "EMPRESA"
      ? {}
      : entityType === "MEMBRO"
        ? { id: { in: entityIds } }
        : { OR: entityIds.map((id) => buildMemberScopeFilter(entityType, id)) };

  return prisma.member.findMany({
    // Quem não esteve na empresa em nenhum momento do período consultado
    // não tem Recebível a apurar (vínculo empregatício — ver
    // employmentOverlapFilter).
    where: { companyId, AND: [scopeWhere, employmentOverlapFilter(periodStart, periodEndExclusive)] },
    select: {
      id: true,
      fullName: true,
      customFixedSalary: true,
      entryDate: true,
      exitDate: true,
      cargo: { select: { id: true, name: true, defaultFixedSalary: true } },
    },
  });
}

// Fixo de um Membro num mês específico: usa o valor CONGELADO do
// Fechamento se o mês já foi fechado para esse Membro; senão, calcula ao
// vivo (Member.customFixedSalary ou Cargo.defaultFixedSalary atuais).
export function resolveMonthlyFixedSalary(member: MemberLite, monthKey: string, snapshotContext: ClosingSnapshotContext): Prisma.Decimal {
  const frozen = snapshotContext.closingByMemberMonth.get(`${member.id}|${monthKey}`);
  if (frozen) return frozen.fixedSalarySnapshot;
  if (!member.cargo) return new Prisma.Decimal(0);
  return resolveFixedSalary({ customFixedSalary: member.customFixedSalary }, { defaultFixedSalary: member.cargo.defaultFixedSalary });
}

// "Valor Adicional" lançado à mão no Fechamento do mês (zero quando o mês
// não foi fechado). Faz parte do total que o Fechamento aprovou, então
// Recebíveis tem de somá-lo — senão as duas telas mostram números
// diferentes para um mês já fechado.
export function resolveMonthlyManualAdjustment(
  memberId: string,
  monthKey: string,
  snapshotContext: ClosingSnapshotContext,
): Prisma.Decimal {
  return snapshotContext.closingByMemberMonth.get(`${memberId}|${monthKey}`)?.manualAdjustmentValue ?? new Prisma.Decimal(0);
}

// ============================================================
// Núcleo: linhas de Recebível por Membro, dentro do Período filtrado —
// reaproveita o motor puro de Bases de Recebível (computeLiveReceivablesOutcome),
// alimentado com uma janela por vez (enumeratePeriodWindows).
// ============================================================

export interface MemberReceivableRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: "META" | "RESULTADO";
  indicatorLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: "FAIXA" | "CUMULATIVO";
  periodStart: Date;
  periodEndExclusive: Date;
  status: WindowStatus;
  attainmentValue: Prisma.Decimal;
  mainRealized: Prisma.Decimal;
  currentTierLabel: string | null;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  nextTierGap: Prisma.Decimal | null;
  topTierPotentialPayout: Prisma.Decimal;
  tierBreakdown: TierPayoutBreakdown[];
}

async function loadRelevantBeneficiaries(companyId: string, memberIds: string[], periodStart: Date, periodEndExclusive: Date) {
  if (memberIds.length === 0) return [];
  return prisma.receivablesBeneficiary.findMany({
    where: {
      companyId,
      memberId: { in: memberIds },
      receivablesBase: {
        status: { in: ["ATIVO", "ENCERRADO"] },
        OR: [{ startDate: null }, { startDate: { lt: periodEndExclusive } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: periodStart } }] }],
      },
    },
  });
}

export async function computeMemberReceivablesRows(
  companyId: string,
  memberId: string,
  periodStart: Date,
  periodEndExclusive: Date,
  referenceDate: Date,
  baseCache: Map<string, ReceivablesBaseDetail>,
  snapshotContext?: ClosingSnapshotContext,
): Promise<MemberReceivableRow[]> {
  const beneficiaries = await loadRelevantBeneficiaries(companyId, [memberId], periodStart, periodEndExclusive);
  const rows: MemberReceivableRow[] = [];

  // Vínculo do Membro: nenhuma janela fora de [entrada, saída] gera
  // Recebível. Filtrar só o Membro no início do período (como faz
  // resolveSelectedMembers) não basta — quem foi admitido no meio do
  // intervalo consultado passa no filtro e ainda assim não pode receber
  // pelas janelas anteriores à admissão.
  const employment = await prisma.member.findFirst({
    where: { id: memberId, companyId },
    select: { entryDate: true, exitDate: true },
  });

  // Meses deste Membro que já têm Fechamento salvo. Dentro deles vale só o
  // que foi congelado (ver a trava dentro do laço de janelas abaixo).
  const closedMonthKeys = snapshotContext
    ? new Set(
        [...snapshotContext.closingByMemberMonth.keys()]
          .filter((key) => key.startsWith(`${memberId}|`))
          .map((key) => key.slice(memberId.length + 1)),
      )
    : undefined;

  for (const beneficiary of beneficiaries) {
    let base = baseCache.get(beneficiary.receivablesBaseId);
    if (!base) {
      base = await fetchReceivablesBaseDetail(companyId, beneficiary.receivablesBaseId);
      baseCache.set(beneficiary.receivablesBaseId, base);
    }
    const baseBeneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
    if (!baseBeneficiary) continue;

    const vigenciaStart = base.startDate && base.startDate > periodStart ? base.startDate : periodStart;
    const vigenciaEndExclusive = base.endDate ? addDaysUtc(base.endDate, 1) : periodEndExclusive;
    const rangeEnd = vigenciaEndExclusive < periodEndExclusive ? vigenciaEndExclusive : periodEndExclusive;
    if (vigenciaStart >= rangeEnd) continue;

    const windows = enumeratePeriodWindows(base.periodicity, vigenciaStart, rangeEnd);

    for (const window of windows) {
      const frozen = snapshotContext?.snapshotByWindowKey.get(windowSnapshotKey(memberId, base.id, window.start));

      // Regra confirmada com o usuário (2026-08-07): existindo Fechamento
      // para o mês, ele SOBREPÕE o cálculo daquele período — vale só o que
      // foi congelado na folha.
      //
      // Não basta usar o snapshot quando ele existe: o Fechamento congela
      // apenas as janelas que existiam no momento em que foi salvo. Uma
      // Base criada (ou reeditada, o que desloca o início da janela) DEPOIS
      // do fechamento cai dentro do mês fechado sem snapshot nenhum e, sem
      // esta trava, voltava a ser calculada ao vivo — somando valor a uma
      // folha que já estava fechada.
      if (!frozen && closedMonthKeys?.has(monthKeyOf(monthBucketOfWindow(window.endExclusive)))) {
        continue;
      }

      // Janela inteiramente fora do vínculo não gera linha. Um Fechamento
      // já salvo (frozen) sobrevive mesmo assim: é histórico consumado, e
      // escondê-lo faria sumir dinheiro real já apurado — mesmo critério
      // usado em listClosings.
      if (!frozen && employment && !overlapsEmployment(employment, window.start, window.endExclusive)) {
        continue;
      }

      const status = resolveWindowStatus(window, referenceDate, !!frozen);
      const indicatorLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");

      if (frozen) {
        // Fechado: valores CONGELADOS no FinancialPeriodSnapshot — nunca
        // recalculados, mesmo que Cargo/Member/regras da Base tenham mudado
        // depois do Fechamento (mesmo padrão de getClosingDetail).
        const topAchieved = frozen.tierBreakdown[frozen.tierBreakdown.length - 1] ?? null;

        // Benefício REPROVADO no Fechamento não é pago: Recebíveis precisa
        // refletir a decisão do gestor, não o valor que o motor calculou
        // antes dela. Sem isto, reprovar uma campanha zerava o valor no
        // Fechamento mas ele continuava aparecendo (e somando) em
        // Recebíveis — exatamente a divergência que a trava de
        // congelamento existe para evitar.
        const reproved = frozen.approvalStatus === "REPROVADO";
        rows.push({
          receivablesBaseId: base.id,
          baseName: base.name,
          indicatorType: base.indicatorType,
          indicatorLabel,
          periodicity: base.periodicity,
          triggerMode: base.triggerMode,
          periodStart: window.start,
          periodEndExclusive: window.endExclusive,
          status,
          attainmentValue: frozen.attainmentPercentage ?? frozen.realizedNetValue,
          mainRealized: frozen.realizedNetValue,
          currentTierLabel: topAchieved ? `Gatilho ${topAchieved.order}` : null,
          eligible: frozen.eligibilityStatus && !reproved,
          blockedReason: reproved ? "Benefício reprovado no Fechamento do período." : frozen.blockedReason,
          payoutValue: reproved ? new Prisma.Decimal(0) : frozen.payoutValue,
          physicalPrizeDescription: reproved ? null : frozen.physicalPrizeDescription,
          // "Próximo degrau"/"potencial" são projeção de janela em
          // andamento — sem sentido para um período já fechado.
          nextTierGap: null,
          topTierPotentialPayout: new Prisma.Decimal(0),
          tierBreakdown: frozen.tierBreakdown,
        });
        continue;
      }

      const outcome = await computeLiveReceivablesOutcome(companyId, base, baseBeneficiary, window);
      const topAchieved = outcome.achievedTiers[outcome.achievedTiers.length - 1] ?? null;
      const currentTierLabel = topAchieved ? `Gatilho ${topAchieved.order}` : null;

      rows.push({
        receivablesBaseId: base.id,
        baseName: base.name,
        indicatorType: base.indicatorType,
        indicatorLabel,
        periodicity: base.periodicity,
        triggerMode: base.triggerMode,
        periodStart: window.start,
        periodEndExclusive: window.endExclusive,
        status,
        attainmentValue: outcome.attainmentValue,
        mainRealized: outcome.mainRealized,
        currentTierLabel,
        eligible: outcome.eligible,
        blockedReason: outcome.blockedReason,
        payoutValue: outcome.eligible ? outcome.payoutValue : new Prisma.Decimal(0),
        physicalPrizeDescription: outcome.eligible ? outcome.physicalPrizeDescription : null,
        nextTierGap: outcome.nextTier?.gap ?? null,
        topTierPotentialPayout: outcome.topTierPotentialPayout,
        tierBreakdown: outcome.eligible ? outcome.tierBreakdown : [],
      });
    }
  }

  return rows.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());
}

function serializeRow(row: MemberReceivableRow) {
  return {
    receivablesBaseId: row.receivablesBaseId,
    baseName: row.baseName,
    indicatorType: row.indicatorType,
    indicatorLabel: row.indicatorLabel,
    periodicity: row.periodicity,
    triggerMode: row.triggerMode,
    periodStart: isoKey(row.periodStart),
    periodEndExclusive: isoKey(row.periodEndExclusive),
    status: row.status,
    attainmentValue: row.attainmentValue.toString(),
    currentTierLabel: row.currentTierLabel,
    eligible: row.eligible,
    blockedReason: row.blockedReason,
    payoutValue: row.payoutValue.toString(),
    physicalPrizeDescription: row.physicalPrizeDescription,
    nextTierGap: row.nextTierGap ? row.nextTierGap.toString() : null,
    topTierPotentialPayout: row.topTierPotentialPayout.toString(),
  };
}

// ============================================================
// Ganho por Meta (Visão Vendedor, spec §2) — 1 Membro. Usado tanto como
// tabela principal (seleção resolvida a 1 Membro) quanto como drill-down
// ao expandir uma linha da tabela de Distribuição (Visão Gestor).
// ============================================================

export async function getMemberGanhoPorMeta(
  companyId: string,
  requestingUser: { id: string; companyId: string; role: string },
  memberId: string,
  periodStartIso: string,
  periodEndIso: string,
) {
  await assertCanViewMembers(companyId, requestingUser, [memberId]);

  const member = await prisma.member.findFirst({ where: { id: memberId, companyId }, select: { id: true, fullName: true } });
  if (!member) throw new NotFoundError("Membro não encontrado");

  const periodStart = toDate(periodStartIso);
  const periodEndExclusive = addDaysUtc(toDate(periodEndIso), 1);
  const referenceDate = new Date();

  const snapshotContext = await loadClosingSnapshotContext(companyId, [memberId], periodStart, periodEndExclusive);
  const rows = await computeMemberReceivablesRows(companyId, memberId, periodStart, periodEndExclusive, referenceDate, new Map(), snapshotContext);
  return { member, rows: rows.map(serializeRow) };
}

// ============================================================
// Overview (tela principal) — resolve o Escopo filtrado, computa as
// linhas de todos os Membros selecionados, e agrega em KPIs, os 2
// gráficos, a tabela adaptativa (Ganho por Meta ou Distribuição), Metas
// 360, Modelos de Benefício e a Lista de Prêmios Físicos.
// ============================================================

export interface RecebiveisFilters {
  entityType: OrgScopeType;
  entityIds: string[];
  periodStart: string;
  periodEnd: string;
}

function monthsElapsedInRange(periodStart: Date, periodEndExclusive: Date, referenceDate: Date): string[] {
  const keys: string[] = [];
  let cursor = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1));
  while (cursor < periodEndExclusive && cursor <= referenceDate) {
    keys.push(monthKeyOf(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return keys;
}

export async function getReceivablesOverview(
  companyId: string,
  requestingUser: { id: string; companyId: string; role: string },
  filters: RecebiveisFilters,
) {
  const periodStart = toDate(filters.periodStart);
  const periodEndExclusive = addDaysUtc(toDate(filters.periodEnd), 1);
  const referenceDate = new Date();

  const members = await resolveSelectedMembers(companyId, filters.entityType, filters.entityIds, periodStart, periodEndExclusive);
  const memberIds = members.map((m) => m.id);
  await assertCanViewMembers(companyId, requestingUser, memberIds);

  const snapshotContext = await loadClosingSnapshotContext(companyId, memberIds, periodStart, periodEndExclusive);

  const baseCache = new Map<string, ReceivablesBaseDetail>();
  const memberRows: { member: MemberLite; rows: MemberReceivableRow[] }[] = [];
  for (const member of members) {
    const rows = await computeMemberReceivablesRows(companyId, member.id, periodStart, periodEndExclusive, referenceDate, baseCache, snapshotContext);
    memberRows.push({ member, rows });
  }

  // KPIs
  let fechadoTotal = new Prisma.Decimal(0);
  let liberadoTotal = new Prisma.Decimal(0);
  let previstoTotal = new Prisma.Decimal(0);
  let premiosCount = 0;
  for (const { rows } of memberRows) {
    for (const row of rows) {
      if (row.status === "FECHADO") fechadoTotal = fechadoTotal.plus(row.payoutValue);
      else if (row.status === "LIBERADO") liberadoTotal = liberadoTotal.plus(row.payoutValue);
      else previstoTotal = previstoTotal.plus(row.payoutValue);
      if (row.status !== "PREVISTO") {
        premiosCount += row.tierBreakdown.filter((tier) => tier.physicalPrizeDescription).length;
      }
    }
  }

  const monthKeys = monthsElapsedInRange(periodStart, periodEndExclusive, referenceDate);
  let fixoTotal = new Prisma.Decimal(0);
  const fixoPorMes = new Map<string, Prisma.Decimal>();
  for (const { member } of memberRows) {
    if (!member.cargo) continue;
    for (const monthKey of monthKeys) {
      // Mês fora do vínculo não gera Fixo: o Membro só tem Recebíveis
      // (Fixo E Benefícios) entre a entrada e a saída. Um mês já FECHADO
      // continua contando mesmo assim — o valor vem do Fechamento, que é
      // histórico consumado e não se recalcula.
      const isClosed = snapshotContext.closingByMemberMonth.has(`${member.id}|${monthKey}`);
      if (!isClosed && !monthOverlapsEmployment(member, monthKey)) continue;

      const monthlySalary = resolveMonthlyFixedSalary(member, monthKey, snapshotContext);
      fixoTotal = fixoTotal.plus(monthlySalary);
      fixoPorMes.set(monthKey, (fixoPorMes.get(monthKey) ?? new Prisma.Decimal(0)).plus(monthlySalary));
    }
  }

  // "Valor Adicional" dos meses já fechados: não vem de Campanha nenhuma
  // (não tem janela nem FinancialPeriodSnapshot), então não aparece em
  // nenhuma `row` acima — mas compõe o total que o Fechamento aprovou.
  // Entra no bucket FECHADO, junto dos benefícios congelados, para que o
  // valor visto aqui bata com o do Fechamento.
  for (const { member } of memberRows) {
    for (const monthKey of monthKeys) {
      const adjustment = resolveMonthlyManualAdjustment(member.id, monthKey, snapshotContext);
      if (!adjustment.isZero()) {
        fechadoTotal = fechadoTotal.plus(adjustment);
      }
    }
  }

  // Gráfico 1 — composição por fechamento, bucket mensal fixo (independente
  // da periodicidade de cada Base — decisão confirmada com o usuário).
  const bucketMap = new Map<
    string,
    {
      monthKey: string;
      receivablesBaseId: string;
      baseName: string;
      status: "FECHADO" | "LIBERADO";
      periodicity: ReceivablesPeriodicity;
      value: Prisma.Decimal;
      windowCount: number;
      sampleStartIso: string;
      sampleEndInclusiveIso: string;
    }
  >();
  for (const { rows } of memberRows) {
    for (const row of rows) {
      if (row.status === "PREVISTO") continue;
      const monthKey = monthKeyOf(addDaysUtc(row.periodEndExclusive, -1));
      const key = `${monthKey}|${row.receivablesBaseId}|${row.status}`;
      const existing = bucketMap.get(key);
      if (existing) {
        existing.value = existing.value.plus(row.payoutValue);
        existing.windowCount += 1;
      } else {
        bucketMap.set(key, {
          monthKey,
          receivablesBaseId: row.receivablesBaseId,
          baseName: row.baseName,
          status: row.status as "FECHADO" | "LIBERADO",
          periodicity: row.periodicity,
          value: row.payoutValue,
          windowCount: 1,
          sampleStartIso: isoKey(row.periodStart),
          sampleEndInclusiveIso: isoKey(addDaysUtc(row.periodEndExclusive, -1)),
        });
      }
    }
  }
  const fechamentoBuckets = [...bucketMap.values()]
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((b) => ({ ...b, value: b.value.toString() }));

  // Gráfico 2 — acumulado Fixo x Benefícios (Fechado+Aberto), mensal.
  const beneficiosPorMes = new Map<string, Prisma.Decimal>();
  for (const bucket of bucketMap.values()) {
    beneficiosPorMes.set(bucket.monthKey, (beneficiosPorMes.get(bucket.monthKey) ?? new Prisma.Decimal(0)).plus(bucket.value));
  }
  let fixoAcc = new Prisma.Decimal(0);
  let beneficiosAcc = new Prisma.Decimal(0);
  const cumulativeSeries = monthKeys.map((monthKey) => {
    fixoAcc = fixoAcc.plus(fixoPorMes.get(monthKey) ?? new Prisma.Decimal(0));
    beneficiosAcc = beneficiosAcc.plus(beneficiosPorMes.get(monthKey) ?? new Prisma.Decimal(0));
    return { monthKey, fixoAcumulado: fixoAcc.toString(), beneficiosAcumulado: beneficiosAcc.toString() };
  });

  // Tabela adaptativa: 1 Membro = Ganho por Meta (Visão Vendedor); Grupo =
  // Distribuição (Visão Gestor, drill-down consome getMemberGanhoPorMeta).
  const table =
    memberRows.length === 1
      ? {
          kind: "GANHO_POR_META" as const,
          member: { id: memberRows[0].member.id, fullName: memberRows[0].member.fullName },
          rows: memberRows[0].rows.map(serializeRow),
        }
      : {
          kind: "DISTRIBUICAO" as const,
          rows: memberRows.map(({ member, rows }) => {
            const comissao = rows.filter((r) => r.status !== "PREVISTO").reduce((acc, r) => acc.plus(r.payoutValue), new Prisma.Decimal(0));
            const premios = rows
              .filter((r) => r.status !== "PREVISTO")
              .reduce((acc, r) => acc + r.tierBreakdown.filter((t) => t.physicalPrizeDescription).length, 0);
            const salarioFixo = member.cargo
              ? monthKeys.reduce((acc, monthKey) => acc.plus(resolveMonthlyFixedSalary(member, monthKey, snapshotContext)), new Prisma.Decimal(0))
              : new Prisma.Decimal(0);
            return {
              memberId: member.id,
              fullName: member.fullName,
              cargoName: member.cargo?.name ?? "—",
              salarioFixo: salarioFixo.toString(),
              comissao: comissao.toString(),
              premiosFisicosCount: premios,
              custoTotal: salarioFixo.plus(comissao).toString(),
            };
          }),
        };

  // Metas 360 — pivot por Base/Meta.
  const metas360Map = new Map<
    string,
    { receivablesBaseId: string; baseName: string; indicatorLabel: string; beneficiarios: Set<string>; total: Prisma.Decimal; premios: number }
  >();
  for (const { member, rows } of memberRows) {
    for (const row of rows) {
      if (row.status === "PREVISTO") continue;
      const premios = row.tierBreakdown.filter((t) => t.physicalPrizeDescription).length;
      const existing = metas360Map.get(row.receivablesBaseId);
      if (existing) {
        existing.total = existing.total.plus(row.payoutValue);
        existing.premios += premios;
        if (row.payoutValue.greaterThan(0) || premios > 0) existing.beneficiarios.add(member.id);
      } else {
        const beneficiarios = new Set<string>();
        if (row.payoutValue.greaterThan(0) || premios > 0) beneficiarios.add(member.id);
        metas360Map.set(row.receivablesBaseId, {
          receivablesBaseId: row.receivablesBaseId,
          baseName: row.baseName,
          indicatorLabel: row.indicatorLabel,
          beneficiarios,
          total: row.payoutValue,
          premios,
        });
      }
    }
  }
  const metas360 = [...metas360Map.values()]
    .sort((a, b) => b.total.comparedTo(a.total))
    .map((m) => ({
      receivablesBaseId: m.receivablesBaseId,
      baseName: m.baseName,
      indicatorLabel: m.indicatorLabel,
      beneficiariosCount: m.beneficiarios.size,
      totalGerado: m.total.toString(),
      premiosFisicosCount: m.premios,
    }));

  // Modelos de Benefício — breakdown por RewardType.
  const modelosMap = new Map<RewardType, { total: Prisma.Decimal; count: number }>();
  for (const { rows } of memberRows) {
    for (const row of rows) {
      if (row.status === "PREVISTO") continue;
      for (const tier of row.tierBreakdown) {
        const existing = modelosMap.get(tier.rewardType) ?? { total: new Prisma.Decimal(0), count: 0 };
        existing.total = existing.total.plus(tier.computedAmount);
        existing.count += 1;
        modelosMap.set(tier.rewardType, existing);
      }
    }
  }
  const modelosBeneficio = [...modelosMap.entries()].map(([rewardType, agg]) => ({ rewardType, total: agg.total.toString(), count: agg.count }));

  // Lista de Prêmios Físicos (separada do monetário).
  const premiosFisicos: {
    memberId: string;
    fullName: string;
    baseName: string;
    degrau: string;
    descricao: string;
    status: WindowStatus;
    periodStart: string;
    periodEndInclusive: string;
  }[] = [];
  for (const { member, rows } of memberRows) {
    for (const row of rows) {
      if (row.status === "PREVISTO") continue;
      for (const tier of row.tierBreakdown) {
        if (!tier.physicalPrizeDescription) continue;
        premiosFisicos.push({
          memberId: member.id,
          fullName: member.fullName,
          baseName: row.baseName,
          degrau: `Gatilho ${tier.order}`,
          descricao: tier.physicalPrizeDescription,
          status: row.status,
          periodStart: isoKey(row.periodStart),
          periodEndInclusive: isoKey(addDaysUtc(row.periodEndExclusive, -1)),
        });
      }
    }
  }

  return {
    kpis: {
      beneficiosTotal: fechadoTotal.plus(liberadoTotal).toString(),
      fechadoTotal: fechadoTotal.toString(),
      liberadoTotal: liberadoTotal.toString(),
      previstoTotal: previstoTotal.toString(),
      fixoTotal: fixoTotal.toString(),
      premiosFisicosCount: premiosCount,
    },
    fechamentoBuckets,
    cumulativeSeries,
    table,
    metas360,
    modelosBeneficio,
    premiosFisicos,
  };
}
