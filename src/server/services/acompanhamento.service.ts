import { prisma } from "../config/prisma";
import { Prisma, type GoalCampaignStatus, type OrgScopeType } from "@prisma/client";
import { buildMemberScopeFilter, getRealizadoDailyMap } from "./bases-metas.service";
import { assertVisibleScope, type RequestingUser } from "./scope.util";
import { toDate } from "./resultados.service";
import {
  addDailyMaps,
  type DailyMap,
  dailyMapOfActiveLine,
  groupDailyMapBy,
  isoKey,
  isoWeekKey,
  monthKeyOf,
  type PeriodTotal,
  quarterKeyOf,
  resolveEntityName,
} from "./metas.service";

export interface AcompanhamentoEntityRef {
  entityType: OrgScopeType;
  entityId: string;
}

export interface AcompanhamentoFilters {
  resultTypeId: string;
  periodStart: string; // ISO "YYYY-MM-DD"
  periodEnd: string;
  realizadoAte: string;
  entityType: OrgScopeType;
  entityIds: string[]; // multi-select dentro de UM nível
  goalCampaignIds: string[]; // multi-select de Metas
}

export type Granularity = "DIA" | "SEMANA" | "MES" | "TRIMESTRE";

// ============================================================
// Helpers de data puros (sem banco) — janela de paginação mensal
// (Dia/Semana) e recorte de um DailyMap por intervalo.
// ============================================================

function addDaysUtc(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount));
}

export function totalMonthsInPeriod(periodStart: Date, periodEnd: Date): number {
  return (
    (periodEnd.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
    (periodEnd.getUTCMonth() - periodStart.getUTCMonth()) +
    1
  );
}

export function monthWindow(periodStart: Date, monthOffset: number): { start: Date; endExclusive: Date } {
  const start = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + monthOffset, 1));
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, endExclusive };
}

function filterDailyMapRange(daily: DailyMap, start: Date, endExclusive: Date): DailyMap {
  const startKey = isoKey(start);
  const endKey = isoKey(endExclusive);
  const result: DailyMap = new Map();
  for (const [key, value] of daily) {
    if (key >= startKey && key < endKey) result.set(key, value);
  }
  return result;
}

function dailyMapToPeriods(daily: DailyMap): PeriodTotal[] {
  return [...daily.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => ({ key, value }));
}

function periodsForGranularity(daily: DailyMap, granularity: Granularity): PeriodTotal[] {
  switch (granularity) {
    case "DIA":
      return dailyMapToPeriods(daily);
    case "SEMANA":
      return groupDailyMapBy(daily, isoWeekKey);
    case "MES":
      return groupDailyMapBy(daily, monthKeyOf);
    case "TRIMESTRE":
      return groupDailyMapBy(daily, quarterKeyOf);
  }
}

function findBucketValue(periods: PeriodTotal[], key: string): Prisma.Decimal {
  return periods.find((p) => p.key === key)?.value ?? new Prisma.Decimal(0);
}

export function sumDailyMapUpTo(daily: DailyMap, cutoffKeyInclusive: string): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const [key, value] of daily) {
    if (key <= cutoffKeyInclusive) total = total.plus(value);
  }
  return total;
}

// ============================================================
// Fórmulas puras de % — reaproveitadas em todo o módulo (KPIs, tabela de
// 8 linhas, drill-down hierárquico). Denominador zero sempre vira null
// (nunca divide por zero, nunca trava em 0%).
// ============================================================

export function safeDivide(numerator: Prisma.Decimal, denominator: Prisma.Decimal): Prisma.Decimal | null {
  if (denominator.isZero()) return null;
  return numerator.dividedBy(denominator);
}

// "Valor de Cobertura": positivo = à frente do ritmo, negativo = devendo meta.
export function computeValorCobertura(realizadoCorrido: Prisma.Decimal, metaAcumuladaAteData: Prisma.Decimal): Prisma.Decimal {
  return realizadoCorrido.minus(metaAcumuladaAteData);
}

// Soma corrida (running total) de uma série já ordenada — usada nas linhas
// 5/6 da tabela de granularidade e no Gráfico Acumulado.
export function cumulativeSum(periods: PeriodTotal[]): PeriodTotal[] {
  let running = new Prisma.Decimal(0);
  return periods.map((p) => {
    running = running.plus(p.value);
    return { key: p.key, value: running };
  });
}

// ============================================================
// KPIs
// ============================================================

export interface KpiCard {
  realizado: Prisma.Decimal;
  meta: Prisma.Decimal;
  percentMeta: Prisma.Decimal | null;
}

function buildKpiCard(realizado: Prisma.Decimal, meta: Prisma.Decimal): KpiCard {
  return { realizado, meta, percentMeta: safeDivide(realizado, meta) };
}

export interface CorridoKpi {
  realizadoCorrido: Prisma.Decimal;
  metaTotalPeriodo: Prisma.Decimal;
  percentMeta: Prisma.Decimal | null;
  // "% Esperado": soma da Meta do início do período até `realizadoAte` /
  // soma TOTAL da Meta do período — curva monotônica 0%->100%, fórmula já
  // validada em rodada anterior deste módulo (ver .planosistemametas).
  percentEsperado: Prisma.Decimal | null;
  valorCobertura: Prisma.Decimal;
}

// ============================================================
// Tabela de granularidade (8 linhas)
// ============================================================

export interface GranularityBucketRow {
  periodKey: string;
  realizado: Prisma.Decimal;
  meta: Prisma.Decimal;
  percentMetaPeriodo: Prisma.Decimal | null; // linha 4: % da Meta do Período
  realizadoAcumulado: Prisma.Decimal; // linha 5
  metaAcumulada: Prisma.Decimal; // linha 6
  percentRealizadoEsperado: Prisma.Decimal | null; // linha 7: % Realizado do Esperado (ritmo)
  percentRealizadoMetaTotal: Prisma.Decimal | null; // linha 8: % Realizado da Meta Total
}

// Une as chaves de Meta e Realizado (podem divergir — ex: mês sem nenhum
// resultado lançado ainda) e acumula em uma única passada. Pura, testável.
export function buildBucketRows(realizadoPeriods: PeriodTotal[], metaPeriods: PeriodTotal[]): GranularityBucketRow[] {
  const keys = [...new Set([...realizadoPeriods.map((p) => p.key), ...metaPeriods.map((p) => p.key)])].sort();
  const realizadoMap = new Map(realizadoPeriods.map((p) => [p.key, p.value]));
  const metaMap = new Map(metaPeriods.map((p) => [p.key, p.value]));
  const metaTotalPeriodo = metaPeriods.reduce((acc, p) => acc.plus(p.value), new Prisma.Decimal(0));

  let realizadoAcumulado = new Prisma.Decimal(0);
  let metaAcumulada = new Prisma.Decimal(0);

  return keys.map((key) => {
    const realizado = realizadoMap.get(key) ?? new Prisma.Decimal(0);
    const meta = metaMap.get(key) ?? new Prisma.Decimal(0);
    realizadoAcumulado = realizadoAcumulado.plus(realizado);
    metaAcumulada = metaAcumulada.plus(meta);

    return {
      periodKey: key,
      realizado,
      meta,
      percentMetaPeriodo: safeDivide(realizado, meta),
      realizadoAcumulado,
      metaAcumulada,
      percentRealizadoEsperado: safeDivide(realizadoAcumulado, metaAcumulada),
      percentRealizadoMetaTotal: safeDivide(realizadoAcumulado, metaTotalPeriodo),
    };
  });
}

export interface EntityBucketValue {
  entityId: string;
  entityType: OrgScopeType;
  label: string;
  realizado: Prisma.Decimal;
  meta: Prisma.Decimal;
}

export interface GranularityBucketRowWithEntities extends GranularityBucketRow {
  byEntity: EntityBucketValue[];
}

export interface AcompanhamentoOverview {
  kpis: {
    dia: KpiCard;
    semana: KpiCard;
    mes: KpiCard;
    trimestre: KpiCard;
    corrido: CorridoKpi;
  };
  granularity: Granularity;
  page: { monthOffset: number; hasPrev: boolean; hasNext: boolean } | null; // null para MES/TRIMESTRE (sem paginação)
  buckets: GranularityBucketRowWithEntities[];
  // realizadoCorrido por entidade (início do Período até "Realizado até") —
  // usado pela Tabela Hierárquica como raiz da árvore (parentRealizado /
  // soma = rootTotal), sem precisar de outra ida ao banco.
  entities: { entityId: string; entityType: OrgScopeType; label: string; realizadoCorrido: Prisma.Decimal }[];
}

// ============================================================
// Primitivos de dados (Realizado / Meta por entidade)
// ============================================================

// Soma a(s) Linha(s) de Meta ATIVA(s) das campanhas selecionadas, para uma
// entidade — reaproveita dailyMapOfActiveLine (metas.service.ts) por
// campanha e soma via addDailyMaps.
export async function getMetaDailyMap(
  companyId: string,
  goalCampaignIds: string[],
  entityType: OrgScopeType,
  entityId: string,
): Promise<DailyMap> {
  let combined: DailyMap = new Map();
  for (const goalCampaignId of goalCampaignIds) {
    const daily = await dailyMapOfActiveLine(companyId, goalCampaignId, entityType, entityId);
    combined = addDailyMaps(combined, daily);
  }
  return combined;
}

// ============================================================
// Campanhas disponíveis
// ============================================================

export interface AvailableCampaignOption {
  goalCampaignId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: GoalCampaignStatus;
}

export async function listAvailableCampaigns(
  companyId: string,
  requestingUser: RequestingUser,
  params: { resultTypeId: string; periodStart: string; periodEnd: string; entities: AcompanhamentoEntityRef[] },
): Promise<AvailableCampaignOption[]> {
  if (params.entities.length === 0) return [];
  await assertVisibleScope(companyId, requestingUser, params.entities);

  const periodStart = toDate(params.periodStart);
  const periodEnd = toDate(params.periodEnd);

  const candidates = await prisma.goalCampaign.findMany({
    where: {
      companyId,
      resultTypeId: params.resultTypeId,
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
  });

  if (candidates.length === 0) return [];

  // Só entram campanhas com pelo menos 1 Linha de Meta DIRETA ativa batendo
  // alguma das entidades selecionadas (mesmo nível/id) — nada de ancestral.
  const linesWithActiveEntity = await prisma.goalLine.findMany({
    where: {
      companyId,
      goalCampaignId: { in: candidates.map((c) => c.id) },
      inactivatedAt: null,
      OR: params.entities.map((e) => ({ entityType: e.entityType, entityId: e.entityId })),
    },
    select: { goalCampaignId: true },
  });

  const availableIds = new Set(linesWithActiveEntity.map((l) => l.goalCampaignId));

  return candidates
    .filter((c) => availableIds.has(c.id))
    .map((c) => ({ goalCampaignId: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate, status: c.status }));
}

// ============================================================
// Overview — KPIs + tabela/gráfico de granularidade (o payload principal)
// ============================================================

export async function getAcompanhamentoOverview(
  companyId: string,
  requestingUser: RequestingUser,
  filters: AcompanhamentoFilters,
  granularity: Granularity,
  monthOffset: number,
): Promise<AcompanhamentoOverview> {
  await assertVisibleScope(
    companyId,
    requestingUser,
    filters.entityIds.map((entityId) => ({ entityType: filters.entityType, entityId })),
  );

  const periodStart = toDate(filters.periodStart);
  const periodEndExclusive = addDaysUtc(toDate(filters.periodEnd), 1);
  const realizadoAteDate = toDate(filters.realizadoAte);
  const realizadoAteKey = isoKey(realizadoAteDate);

  const entityRefs: AcompanhamentoEntityRef[] = filters.entityIds.map((entityId) => ({
    entityType: filters.entityType,
    entityId,
  }));

  const [realizadoByEntity, metaByEntityRaw, labels] = await Promise.all([
    Promise.all(
      entityRefs.map((e) =>
        getRealizadoDailyMap(companyId, filters.resultTypeId, e.entityType, e.entityId, periodStart, periodEndExclusive),
      ),
    ),
    Promise.all(entityRefs.map((e) => getMetaDailyMap(companyId, filters.goalCampaignIds, e.entityType, e.entityId))),
    Promise.all(entityRefs.map((e) => resolveEntityName(companyId, e.entityType, e.entityId))),
  ]);

  // dailyMapOfActiveLine devolve a curva inteira da campanha — recorta ao
  // Período filtrado para não inflar totais com meses fora da tela.
  const metaByEntity = metaByEntityRaw.map((daily) => filterDailyMapRange(daily, periodStart, periodEndExclusive));

  let realizadoAggregate: DailyMap = new Map();
  let metaAggregate: DailyMap = new Map();
  for (const daily of realizadoByEntity) realizadoAggregate = addDailyMaps(realizadoAggregate, daily);
  for (const daily of metaByEntity) metaAggregate = addDailyMaps(metaAggregate, daily);

  // KPIs de balde (Dia/Semana/Mês/Trimestre), todos ancorados em "Realizado até".
  const dia = buildKpiCard(
    realizadoAggregate.get(realizadoAteKey) ?? new Prisma.Decimal(0),
    metaAggregate.get(realizadoAteKey) ?? new Prisma.Decimal(0),
  );
  const semanaKey = isoWeekKey(realizadoAteDate);
  const semana = buildKpiCard(
    findBucketValue(groupDailyMapBy(realizadoAggregate, isoWeekKey), semanaKey),
    findBucketValue(groupDailyMapBy(metaAggregate, isoWeekKey), semanaKey),
  );
  const mesKey = monthKeyOf(realizadoAteDate);
  const mes = buildKpiCard(
    findBucketValue(groupDailyMapBy(realizadoAggregate, monthKeyOf), mesKey),
    findBucketValue(groupDailyMapBy(metaAggregate, monthKeyOf), mesKey),
  );
  const trimestreKey = quarterKeyOf(realizadoAteDate);
  const trimestre = buildKpiCard(
    findBucketValue(groupDailyMapBy(realizadoAggregate, quarterKeyOf), trimestreKey),
    findBucketValue(groupDailyMapBy(metaAggregate, quarterKeyOf), trimestreKey),
  );

  // KPI Corrido — sempre precisão diária, independente da granularidade do gráfico.
  const realizadoCorrido = sumDailyMapUpTo(realizadoAggregate, realizadoAteKey);
  const metaAcumuladaAteData = sumDailyMapUpTo(metaAggregate, realizadoAteKey);
  const metaTotalPeriodo = [...metaAggregate.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));

  const corrido: CorridoKpi = {
    realizadoCorrido,
    metaTotalPeriodo,
    percentMeta: safeDivide(realizadoCorrido, metaTotalPeriodo),
    percentEsperado: safeDivide(metaAcumuladaAteData, metaTotalPeriodo),
    valorCobertura: computeValorCobertura(realizadoCorrido, metaAcumuladaAteData),
  };

  // Janela da granularidade: Dia/Semana paginam por mês; Mês/Trimestre mostram o período inteiro.
  let windowStart = periodStart;
  let windowEndExclusive = periodEndExclusive;
  let page: AcompanhamentoOverview["page"] = null;

  if (granularity === "DIA" || granularity === "SEMANA") {
    const totalMonths = totalMonthsInPeriod(periodStart, toDate(filters.periodEnd));
    const clampedOffset = Math.min(Math.max(monthOffset, 0), Math.max(totalMonths - 1, 0));
    const window = monthWindow(periodStart, clampedOffset);
    windowStart = window.start < periodStart ? periodStart : window.start;
    windowEndExclusive = window.endExclusive > periodEndExclusive ? periodEndExclusive : window.endExclusive;
    page = { monthOffset: clampedOffset, hasPrev: clampedOffset > 0, hasNext: clampedOffset < totalMonths - 1 };
  }

  const realizadoWindowed = filterDailyMapRange(realizadoAggregate, windowStart, windowEndExclusive);
  const metaWindowed = filterDailyMapRange(metaAggregate, windowStart, windowEndExclusive);
  const bucketRows = buildBucketRows(periodsForGranularity(realizadoWindowed, granularity), periodsForGranularity(metaWindowed, granularity));

  const byEntityPerBucket: EntityBucketValue[][] = bucketRows.map(() => []);
  entityRefs.forEach((ref, index) => {
    const rMap = new Map(
      periodsForGranularity(filterDailyMapRange(realizadoByEntity[index], windowStart, windowEndExclusive), granularity).map((p) => [
        p.key,
        p.value,
      ]),
    );
    const mMap = new Map(
      periodsForGranularity(filterDailyMapRange(metaByEntity[index], windowStart, windowEndExclusive), granularity).map((p) => [
        p.key,
        p.value,
      ]),
    );

    bucketRows.forEach((row, bucketIndex) => {
      byEntityPerBucket[bucketIndex].push({
        entityId: ref.entityId,
        entityType: ref.entityType,
        label: labels[index],
        realizado: rMap.get(row.periodKey) ?? new Prisma.Decimal(0),
        meta: mMap.get(row.periodKey) ?? new Prisma.Decimal(0),
      });
    });
  });

  const buckets: GranularityBucketRowWithEntities[] = bucketRows.map((row, index) => ({
    ...row,
    byEntity: byEntityPerBucket[index],
  }));

  return {
    kpis: { dia, semana, mes, trimestre, corrido },
    granularity,
    page,
    buckets,
    entities: entityRefs.map((ref, index) => ({
      entityId: ref.entityId,
      entityType: ref.entityType,
      label: labels[index],
      realizadoCorrido: sumDailyMapUpTo(realizadoByEntity[index], realizadoAteKey),
    })),
  };
}

// ============================================================
// Gráfico Acumulado — sempre mensal, independente do seletor de granularidade.
// ============================================================

export interface CumulativePoint {
  monthKey: string;
  metaAcumulada: Prisma.Decimal;
  realizadoAcumulada: Prisma.Decimal;
}

export function buildCumulativeSeries(realizadoMonthly: PeriodTotal[], metaMonthly: PeriodTotal[]): CumulativePoint[] {
  const keys = [...new Set([...realizadoMonthly.map((p) => p.key), ...metaMonthly.map((p) => p.key)])].sort();
  const realizadoMap = new Map(realizadoMonthly.map((p) => [p.key, p.value]));
  const metaMap = new Map(metaMonthly.map((p) => [p.key, p.value]));

  let realizadoAcc = new Prisma.Decimal(0);
  let metaAcc = new Prisma.Decimal(0);

  return keys.map((key) => {
    realizadoAcc = realizadoAcc.plus(realizadoMap.get(key) ?? new Prisma.Decimal(0));
    metaAcc = metaAcc.plus(metaMap.get(key) ?? new Prisma.Decimal(0));
    return { monthKey: key, realizadoAcumulada: realizadoAcc, metaAcumulada: metaAcc };
  });
}

export async function getCumulativeSeries(
  companyId: string,
  requestingUser: RequestingUser,
  filters: AcompanhamentoFilters,
): Promise<CumulativePoint[]> {
  await assertVisibleScope(
    companyId,
    requestingUser,
    filters.entityIds.map((entityId) => ({ entityType: filters.entityType, entityId })),
  );

  const periodStart = toDate(filters.periodStart);
  const periodEndExclusive = addDaysUtc(toDate(filters.periodEnd), 1);

  const entityRefs: AcompanhamentoEntityRef[] = filters.entityIds.map((entityId) => ({
    entityType: filters.entityType,
    entityId,
  }));

  const [realizadoByEntity, metaByEntityRaw] = await Promise.all([
    Promise.all(
      entityRefs.map((e) =>
        getRealizadoDailyMap(companyId, filters.resultTypeId, e.entityType, e.entityId, periodStart, periodEndExclusive),
      ),
    ),
    Promise.all(entityRefs.map((e) => getMetaDailyMap(companyId, filters.goalCampaignIds, e.entityType, e.entityId))),
  ]);

  let realizadoAggregate: DailyMap = new Map();
  let metaAggregate: DailyMap = new Map();
  for (const daily of realizadoByEntity) realizadoAggregate = addDailyMaps(realizadoAggregate, daily);
  for (const daily of metaByEntityRaw) {
    metaAggregate = addDailyMaps(metaAggregate, filterDailyMapRange(daily, periodStart, periodEndExclusive));
  }

  return buildCumulativeSeries(groupDailyMapBy(realizadoAggregate, monthKeyOf), groupDailyMapBy(metaAggregate, monthKeyOf));
}

// ============================================================
// Gráfico Comparativo — Realizado Atual (barra, período filtrado hoje) x
// Realizado de um ano escolhido (barra) x Meta das campanhas selecionadas
// HOJE, reindexada por mês-do-ano (linha).
// ============================================================

export interface ComparativoPoint {
  monthNumber: number; // 1-12
  realizadoAtual: Prisma.Decimal;
  realizadoAnoSelecionado: Prisma.Decimal;
  metaReindexada: Prisma.Decimal;
}

function monthOnlyKey(date: Date): string {
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

// Pura/testável: recebe as três séries já agrupadas por "MM" (mês sem ano;
// meses repetidos entre anos diferentes já vêm somados por groupDailyMapBy).
export function buildComparativoPoints(
  realizadoAtualByMonth: PeriodTotal[],
  realizadoAnoSelecionadoByMonth: PeriodTotal[],
  metaByMonth: PeriodTotal[],
): ComparativoPoint[] {
  const atualMap = new Map(realizadoAtualByMonth.map((p) => [p.key, p.value]));
  const anoMap = new Map(realizadoAnoSelecionadoByMonth.map((p) => [p.key, p.value]));
  const metaMap = new Map(metaByMonth.map((p) => [p.key, p.value]));

  return Array.from({ length: 12 }, (_, index) => {
    const key = String(index + 1).padStart(2, "0");
    return {
      monthNumber: index + 1,
      realizadoAtual: atualMap.get(key) ?? new Prisma.Decimal(0),
      realizadoAnoSelecionado: anoMap.get(key) ?? new Prisma.Decimal(0),
      metaReindexada: metaMap.get(key) ?? new Prisma.Decimal(0),
    };
  });
}

export async function getComparativoSeries(
  companyId: string,
  requestingUser: RequestingUser,
  filters: Pick<AcompanhamentoFilters, "resultTypeId" | "periodStart" | "periodEnd" | "entityType" | "entityIds" | "goalCampaignIds">,
  year: number,
): Promise<ComparativoPoint[]> {
  await assertVisibleScope(
    companyId,
    requestingUser,
    filters.entityIds.map((entityId) => ({ entityType: filters.entityType, entityId })),
  );

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const periodStart = toDate(filters.periodStart);
  const periodEndExclusive = addDaysUtc(toDate(filters.periodEnd), 1);

  const entityRefs: AcompanhamentoEntityRef[] = filters.entityIds.map((entityId) => ({
    entityType: filters.entityType,
    entityId,
  }));

  const [realizadoAtualByEntity, realizadoAnoSelecionadoByEntity, metaByEntity] = await Promise.all([
    Promise.all(
      entityRefs.map((e) => getRealizadoDailyMap(companyId, filters.resultTypeId, e.entityType, e.entityId, periodStart, periodEndExclusive)),
    ),
    Promise.all(
      entityRefs.map((e) => getRealizadoDailyMap(companyId, filters.resultTypeId, e.entityType, e.entityId, yearStart, yearEndExclusive)),
    ),
    Promise.all(entityRefs.map((e) => getMetaDailyMap(companyId, filters.goalCampaignIds, e.entityType, e.entityId))),
  ]);

  let realizadoAtualAggregate: DailyMap = new Map();
  let realizadoAnoSelecionadoAggregate: DailyMap = new Map();
  let metaAggregate: DailyMap = new Map();
  for (const daily of realizadoAtualByEntity) realizadoAtualAggregate = addDailyMaps(realizadoAtualAggregate, daily);
  for (const daily of realizadoAnoSelecionadoByEntity) {
    realizadoAnoSelecionadoAggregate = addDailyMaps(realizadoAnoSelecionadoAggregate, daily);
  }
  for (const daily of metaByEntity) metaAggregate = addDailyMaps(metaAggregate, daily);

  return buildComparativoPoints(
    groupDailyMapBy(realizadoAtualAggregate, monthOnlyKey),
    groupDailyMapBy(realizadoAnoSelecionadoAggregate, monthOnlyKey),
    groupDailyMapBy(metaAggregate, monthOnlyKey),
  );
}

// ============================================================
// Gráfico Meta Recalculada — apenas os meses restantes após "Realizado até":
// Meta Atual x Meta Recalculada. A Meta Recalculada redistribui o saldo
// necessário para fechar exatamente o Total original da Meta do Período
// (Realizado Acumulado + soma da Meta Recalculada dos meses restantes =
// Meta Total do Período), respeitando a proporção ORIGINAL entre os meses
// restantes entre si (uma escala multiplicativa uniforme preserva razões).
// Matematicamente equivalente ao núcleo de `calculateReforecast` (Saldo ×
// peso relativo dentro do bloco restante) já usado no Recálculo de Rota de
// Metas — aqui reimplementado como função pura própria porque os "pesos"
// são os valores brutos de Meta por mês (não % de sazonalidade) e porque o
// caso "sem meses restantes" deve devolver lista vazia, não lançar erro
// (é um estado normal de visualização, não uma operação do usuário).
// ============================================================

export interface RecalculatedPoint {
  monthKey: string;
  metaAtual: Prisma.Decimal;
  metaRecalculada: Prisma.Decimal;
}

export function buildRecalculatedSeries(
  monthlyMeta: PeriodTotal[],
  realizadoCorrido: Prisma.Decimal,
  realizadoAteMonthKey: string,
): RecalculatedPoint[] {
  const remainingStartIndex = monthlyMeta.findIndex((p) => p.key > realizadoAteMonthKey);
  if (remainingStartIndex === -1) return [];

  const remaining = monthlyMeta.slice(remainingStartIndex);
  const remainingOriginalTotal = remaining.reduce((acc, p) => acc.plus(p.value), new Prisma.Decimal(0));
  if (remainingOriginalTotal.isZero()) return [];

  const metaTotalPeriodo = monthlyMeta.reduce((acc, p) => acc.plus(p.value), new Prisma.Decimal(0));
  const saldoRestante = metaTotalPeriodo.minus(realizadoCorrido);

  return remaining.map((p) => ({
    monthKey: p.key,
    metaAtual: p.value,
    metaRecalculada: saldoRestante.times(p.value.dividedBy(remainingOriginalTotal)),
  }));
}

export async function getRecalculatedMetaSeries(
  companyId: string,
  requestingUser: RequestingUser,
  filters: AcompanhamentoFilters,
): Promise<RecalculatedPoint[]> {
  await assertVisibleScope(
    companyId,
    requestingUser,
    filters.entityIds.map((entityId) => ({ entityType: filters.entityType, entityId })),
  );

  const periodStart = toDate(filters.periodStart);
  const periodEndExclusive = addDaysUtc(toDate(filters.periodEnd), 1);
  const realizadoAteDate = toDate(filters.realizadoAte);
  const realizadoAteKey = isoKey(realizadoAteDate);

  const entityRefs: AcompanhamentoEntityRef[] = filters.entityIds.map((entityId) => ({
    entityType: filters.entityType,
    entityId,
  }));

  const [realizadoByEntity, metaByEntityRaw] = await Promise.all([
    Promise.all(
      entityRefs.map((e) =>
        getRealizadoDailyMap(companyId, filters.resultTypeId, e.entityType, e.entityId, periodStart, periodEndExclusive),
      ),
    ),
    Promise.all(entityRefs.map((e) => getMetaDailyMap(companyId, filters.goalCampaignIds, e.entityType, e.entityId))),
  ]);

  const metaByEntity = metaByEntityRaw.map((daily) => filterDailyMapRange(daily, periodStart, periodEndExclusive));

  let realizadoAggregate: DailyMap = new Map();
  let metaAggregate: DailyMap = new Map();
  for (const daily of realizadoByEntity) realizadoAggregate = addDailyMaps(realizadoAggregate, daily);
  for (const daily of metaByEntity) metaAggregate = addDailyMaps(metaAggregate, daily);

  const monthlyMeta = groupDailyMapBy(metaAggregate, monthKeyOf);
  const realizadoCorrido = sumDailyMapUpTo(realizadoAggregate, realizadoAteKey);
  const realizadoAteMonthKey = monthKeyOf(realizadoAteDate);

  return buildRecalculatedSeries(monthlyMeta, realizadoCorrido, realizadoAteMonthKey);
}

// ============================================================
// Tabela hierárquica (drill-down) — Realizado apenas, sem Meta.
// ============================================================

interface ChildRef {
  entityType: OrgScopeType;
  entityId: string;
  label: string;
}

async function getDirectChildren(companyId: string, entityType: OrgScopeType, entityId: string): Promise<ChildRef[]> {
  switch (entityType) {
    case "EMPRESA": {
      const channels = await prisma.channel.findMany({ where: { companyId }, select: { id: true, name: true } });
      return channels.map((c) => ({ entityType: "CANAL" as const, entityId: c.id, label: c.name }));
    }
    case "CANAL": {
      const departments = await prisma.department.findMany({
        where: { companyId, channelId: entityId },
        select: { id: true, name: true },
      });
      return departments.map((d) => ({ entityType: "DEPARTAMENTO" as const, entityId: d.id, label: d.name }));
    }
    case "DEPARTAMENTO": {
      const teams = await prisma.team.findMany({ where: { companyId, departmentId: entityId }, select: { id: true, name: true } });
      return teams.map((t) => ({ entityType: "TIME" as const, entityId: t.id, label: t.name }));
    }
    case "TIME": {
      // OR estrutural + Líder de Nó responsável por este Time (que pode
      // estar no Time Gestão, sem teamId) — mesmo critério de
      // buildMemberScopeFilter, para o Realizado do Líder também aparecer
      // no drill-down do Time que ele lidera.
      const members = await prisma.member.findMany({
        where: { companyId, status: "ATIVO", ...buildMemberScopeFilter("TIME", entityId) },
        select: { id: true, fullName: true },
      });
      return members.map((m) => ({ entityType: "MEMBRO" as const, entityId: m.id, label: m.fullName }));
    }
    case "MEMBRO":
      return [];
  }
}

export interface HierarchyRow {
  entityType: OrgScopeType;
  entityId: string;
  label: string;
  realizado: Prisma.Decimal;
  percentDoTotal: Prisma.Decimal | null;
  percentDaHierarquia: Prisma.Decimal | null;
  hasChildren: boolean;
}

// % do resultado total / % do resultado da hierarquia calculados aqui (server),
// não no client — mantém decimal.js só no backend. `parentRealizado`/`rootTotal`
// chegam do client (já conhecidos por ele) para não precisar re-buscar a raiz
// a cada expand.
export async function getHierarchyChildren(
  companyId: string,
  requestingUser: RequestingUser,
  filters: Pick<AcompanhamentoFilters, "resultTypeId" | "periodStart" | "realizadoAte">,
  parent: { entityType: OrgScopeType; entityId: string },
  parentRealizado: string,
  rootTotal: string,
): Promise<HierarchyRow[]> {
  await assertVisibleScope(companyId, requestingUser, [parent]);

  const children = await getDirectChildren(companyId, parent.entityType, parent.entityId);
  if (children.length === 0) return [];

  const periodStart = toDate(filters.periodStart);
  const realizadoAteExclusive = addDaysUtc(toDate(filters.realizadoAte), 1);
  const parentRealizadoDecimal = new Prisma.Decimal(parentRealizado);
  const rootTotalDecimal = new Prisma.Decimal(rootTotal);

  return Promise.all(
    children.map(async (child) => {
      const daily = await getRealizadoDailyMap(
        companyId,
        filters.resultTypeId,
        child.entityType,
        child.entityId,
        periodStart,
        realizadoAteExclusive,
      );
      const realizado = [...daily.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));

      return {
        entityType: child.entityType,
        entityId: child.entityId,
        label: child.label,
        realizado,
        percentDoTotal: safeDivide(realizado, rootTotalDecimal),
        percentDaHierarquia: safeDivide(realizado, parentRealizadoDecimal),
        hasChildren: child.entityType !== "MEMBRO",
      };
    }),
  );
}
