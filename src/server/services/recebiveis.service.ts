import { prisma } from "../config/prisma";
import { Prisma, type OrgScopeType, type ReceivablesPeriodicity, type RewardType } from "@prisma/client";
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

async function hasFinancialSnapshot(companyId: string, memberId: string, receivablesBaseId: string, window: PeriodWindow): Promise<boolean> {
  const count = await prisma.financialPeriodSnapshot.count({
    where: {
      companyId,
      memberId,
      receivablesBaseId,
      periodStart: window.start,
      periodEndExclusive: window.endExclusive,
    },
  });
  return count > 0;
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

interface MemberLite {
  id: string;
  fullName: string;
  customFixedSalary: Prisma.Decimal | null;
  cargo: { id: string; name: string; defaultFixedSalary: Prisma.Decimal } | null;
}

async function resolveSelectedMembers(companyId: string, entityType: OrgScopeType, entityIds: string[]): Promise<MemberLite[]> {
  const where: Prisma.MemberWhereInput =
    entityType === "EMPRESA"
      ? { companyId }
      : entityType === "MEMBRO"
        ? { companyId, id: { in: entityIds } }
        : { companyId, OR: entityIds.map((id) => buildMemberScopeFilter(entityType, id)) };

  return prisma.member.findMany({
    where,
    select: { id: true, fullName: true, customFixedSalary: true, cargo: { select: { id: true, name: true, defaultFixedSalary: true } } },
  });
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
): Promise<MemberReceivableRow[]> {
  const beneficiaries = await loadRelevantBeneficiaries(companyId, [memberId], periodStart, periodEndExclusive);
  const rows: MemberReceivableRow[] = [];

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
      const snapshotExists = await hasFinancialSnapshot(companyId, memberId, base.id, window);
      const status = resolveWindowStatus(window, referenceDate, snapshotExists);
      const outcome = await computeLiveReceivablesOutcome(companyId, base, baseBeneficiary, window);
      const indicatorLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");
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

  const rows = await computeMemberReceivablesRows(companyId, memberId, periodStart, periodEndExclusive, referenceDate, new Map());
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
  const members = await resolveSelectedMembers(companyId, filters.entityType, filters.entityIds);
  const memberIds = members.map((m) => m.id);
  await assertCanViewMembers(companyId, requestingUser, memberIds);

  const periodStart = toDate(filters.periodStart);
  const periodEndExclusive = addDaysUtc(toDate(filters.periodEnd), 1);
  const referenceDate = new Date();

  const baseCache = new Map<string, ReceivablesBaseDetail>();
  const memberRows: { member: MemberLite; rows: MemberReceivableRow[] }[] = [];
  for (const member of members) {
    const rows = await computeMemberReceivablesRows(companyId, member.id, periodStart, periodEndExclusive, referenceDate, baseCache);
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
    const monthlySalary = resolveFixedSalary({ customFixedSalary: member.customFixedSalary }, { defaultFixedSalary: member.cargo.defaultFixedSalary });
    fixoTotal = fixoTotal.plus(monthlySalary.times(monthKeys.length));
    for (const monthKey of monthKeys) {
      fixoPorMes.set(monthKey, (fixoPorMes.get(monthKey) ?? new Prisma.Decimal(0)).plus(monthlySalary));
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
              ? resolveFixedSalary({ customFixedSalary: member.customFixedSalary }, { defaultFixedSalary: member.cargo.defaultFixedSalary }).times(
                  monthKeys.length,
                )
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
