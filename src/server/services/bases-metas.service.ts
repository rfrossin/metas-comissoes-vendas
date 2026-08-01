import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import { Prisma, type OrgScopeType } from "@prisma/client";
import { toDate } from "./resultados.service";
import { type DailyMap, isoKey } from "./daily-map.util";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import type { RequestingUser } from "./scope.util";

// Sazonalidade é 100% Admin-only (não é só travar a escrita — a regra é
// "nem aparece" para os demais papéis, então a listagem também barra).
function assertAdmin(requestingUser: RequestingUser): void {
  if (requestingUser.role !== "ADMINISTRADOR") {
    throw new ForbiddenError("Bases para Metas são exclusivas do Administrador.");
  }
}

// Conjunto de tipos de sazonalidade suportados. DIAS_SEMANA/DIAS_MES/
// MESES_ANO/TRIMESTRES/DIAS_ANO são "agrupamento simples" (uma soma por
// balde / total geral, ou a média por balde no caso de DIAS_MES).
// MESES_DIAS_SEMANA/MESES_DIAS_MES são "combinados" (2 níveis: peso do mês
// no ano + peso do balde diário DENTRO daquele mês) — ver
// calculateCombinedWeights. TRIMESTRES existe como Base salvável mas ainda
// não é consumido pelo motor de Metas (getSeasonalityWeights só aceita
// MESES_ANO e combinados) — fora de escopo, não mexer aqui.
export type SupportedAnalysisType =
  | "DIAS_SEMANA"
  | "DIAS_ANO"
  | "DIAS_MES"
  | "MESES_ANO"
  | "MESES_DIAS_SEMANA"
  | "MESES_DIAS_MES"
  | "TRIMESTRES";

const SUPPORTED_ANALYSIS_TYPES: SupportedAnalysisType[] = [
  "DIAS_SEMANA",
  "DIAS_ANO",
  "DIAS_MES",
  "MESES_ANO",
  "MESES_DIAS_SEMANA",
  "MESES_DIAS_MES",
  "TRIMESTRES",
];

export const COMBINED_ANALYSIS_TYPES: SupportedAnalysisType[] = ["MESES_DIAS_SEMANA", "MESES_DIAS_MES"];

export function isCombinedAnalysisType(analysisType: SupportedAnalysisType): boolean {
  return (COMBINED_ANALYSIS_TYPES as string[]).includes(analysisType);
}

// Exportado para reuso pela sazonalidade diária do motor de Metas
// (metas.service.ts), que aplica o mesmo critério "Dias da Semana".
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

// Dia-do-ano em calendário SEMPRE de 365 baldes (Bases para Metas §2 —
// decisão do usuário): em ano bissexto, 29/fev funde no balde 59 (mesmo de
// 28/fev), e 1/mar em diante recua 1 em relação ao dia-do-ano bruto, pra
// sempre cair no mesmo balde que teria num ano não-bissexto. Exportado para
// reuso pela sazonalidade diária do motor de Metas (metas.service.ts).
export function dayOfYear365(date: Date): number {
  const year = date.getUTCFullYear();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const startOfYear = Date.UTC(year, 0, 1);
  const rawDayOfYear = Math.floor((date.getTime() - startOfYear) / 86400000) + 1;

  if (!isLeap || rawDayOfYear < 60) {
    return rawDayOfYear;
  }
  if (rawDayOfYear === 60) {
    return 59; // O próprio 29/fev — mesmo balde de 28/fev.
  }
  return rawDayOfYear - 1;
}

// Número de "baldes" de cada tipo — usado tanto pelo motor agrupado quanto
// pela validação do modo manual (todo tipo é, no fim, N percentuais que
// devem somar 100%). Tipos combinados não têm um "número de baldes" único
// (são 12×7 ou 12×31 células) — não entram neste mapa, ver
// calculateCombinedWeights/COMBINED_DAILY_BUCKET_COUNTS.
const BUCKET_COUNTS: Partial<Record<SupportedAnalysisType, number>> = {
  DIAS_SEMANA: 7,
  DIAS_ANO: 365,
  DIAS_MES: 31,
  MESES_ANO: 12,
  TRIMESTRES: 4,
};

// Só os tipos de agrupamento simples (uma soma por balde / total geral) têm
// extractor aqui — Dias do Mês usa uma lógica própria de duas dimensões
// (ver calculateDiasMesWeights) e não entra neste mapa.
const GROUPED_EXTRACTORS: Partial<Record<SupportedAnalysisType, (date: Date) => number>> = {
  DIAS_SEMANA: isoWeekday,
  DIAS_ANO: dayOfYear365,
  MESES_ANO: (date) => date.getUTCMonth() + 1,
  TRIMESTRES: (date) => Math.floor(date.getUTCMonth() / 3) + 1,
};

// Extractor do balde DIÁRIO (dentro do mês) de cada tipo combinado — mesmo
// critério dos tipos simples equivalentes (DIAS_SEMANA/DIAS_MES), só que
// aplicado por mês em vez de sobre o histórico inteiro de uma vez.
const COMBINED_DAILY_EXTRACTORS: Record<"MESES_DIAS_SEMANA" | "MESES_DIAS_MES", (date: Date) => number> = {
  MESES_DIAS_SEMANA: isoWeekday,
  MESES_DIAS_MES: (date) => date.getUTCDate(),
};

// Exportado para reuso pelo motor de Metas (metas.service.ts), que precisa do
// mesmo mapeamento de escopo organizacional -> filtro de Membros para apurar
// o Realizado Acumulado por linha de meta no Reforecast.
//
// Um Líder de Nó (NodeResponsible — coordenador/gerente/diretor/presidente)
// pode ser responsável por um Canal/Departamento/Time sem estar
// estruturalmente DENTRO dessa hierarquia (normalmente fica no "Time
// Gestão", sem teamId) — por isso todo escopo abaixo de Empresa é um OR
// entre "pertence estruturalmente" (via Member.team) e "é Líder de Nó de
// algum nó dentro do escopo" (via NodeResponsible, subindo até o nível do
// escopo: um Responsável por Time/Departamento aparece também no escopo do
// Canal que os contém). Único ponto de verdade — qualquer filtro de Membros
// por Canal/Departamento/Time no sistema deve reaproveitar esta função em
// vez de reimplementar o where.
export function buildMemberScopeFilter(scopeType: OrgScopeType, scopeId: string | null): Prisma.MemberWhereInput {
  switch (scopeType) {
    case "EMPRESA":
      return {};
    case "MEMBRO":
      return { id: scopeId! };
    case "TIME":
      return {
        OR: [{ teamId: scopeId! }, { nodeResponsibleFor: { some: { nodeType: "TIME", teamId: scopeId! } } }],
      };
    case "DEPARTAMENTO":
      return {
        OR: [
          { team: { departmentId: scopeId! } },
          {
            nodeResponsibleFor: {
              some: {
                OR: [
                  { nodeType: "DEPARTAMENTO", departmentId: scopeId! },
                  { nodeType: "TIME", team: { departmentId: scopeId! } },
                ],
              },
            },
          },
        ],
      };
    case "CANAL":
      return {
        OR: [
          { team: { department: { channelId: scopeId! } } },
          {
            nodeResponsibleFor: {
              some: {
                OR: [
                  { nodeType: "CANAL", channelId: scopeId! },
                  { nodeType: "DEPARTAMENTO", department: { channelId: scopeId! } },
                  { nodeType: "TIME", team: { department: { channelId: scopeId! } } },
                ],
              },
            },
          },
        ],
      };
  }
}

// Soma Resultados Regulares + Ajustes Operacionais por dia, para um escopo
// organizacional livre (via buildMemberScopeFilter) — mapa esparso (só dias
// com lançamento). Mora aqui (não em resultados.service.ts) porque depende
// de buildMemberScopeFilter, definido neste arquivo; mora aqui (não em
// metas.service.ts/acompanhamento.service.ts) para evitar um ciclo de
// import entre os dois (acompanhamento.service.ts já importa de
// metas.service.ts).
export async function getRealizadoDailyMap(
  companyId: string,
  resultTypeId: string,
  entityType: OrgScopeType,
  entityId: string,
  startDate: Date,
  endDateExclusive: Date,
): Promise<DailyMap> {
  const memberFilter = buildMemberScopeFilter(entityType, entityId);

  const [entries, adjustments] = await Promise.all([
    prisma.resultEntry.findMany({
      where: { companyId, typeId: resultTypeId, date: { gte: startDate, lt: endDateExclusive }, member: memberFilter },
      select: { date: true, value: true },
    }),
    prisma.operationalAdjustment.findMany({
      where: {
        companyId,
        typeId: resultTypeId,
        dateReference: { gte: startDate, lt: endDateExclusive },
        member: memberFilter,
      },
      select: { dateReference: true, value: true },
    }),
  ]);

  const daily: DailyMap = new Map();
  for (const entry of entries) {
    const key = isoKey(entry.date);
    daily.set(key, (daily.get(key) ?? new Prisma.Decimal(0)).plus(entry.value));
  }
  for (const adjustment of adjustments) {
    const key = isoKey(adjustment.dateReference);
    daily.set(key, (daily.get(key) ?? new Prisma.Decimal(0)).plus(adjustment.value));
  }
  return daily;
}

export async function assertScopeEntityExists(companyId: string, scopeType: OrgScopeType, scopeId: string | null) {
  if (scopeType === "EMPRESA") {
    return;
  }

  if (!scopeId) {
    throw new ConflictError("Este escopo exige a seleção de uma entidade específica.");
  }

  switch (scopeType) {
    case "MEMBRO": {
      const member = await prisma.member.findFirst({ where: { id: scopeId, companyId } });
      if (!member) throw new NotFoundError("Membro não encontrado");
      break;
    }
    case "TIME": {
      const team = await prisma.team.findFirst({ where: { id: scopeId, companyId } });
      if (!team) throw new NotFoundError("Time não encontrado");
      break;
    }
    case "DEPARTAMENTO": {
      const department = await prisma.department.findFirst({ where: { id: scopeId, companyId } });
      if (!department) throw new NotFoundError("Departamento não encontrado");
      break;
    }
    case "CANAL": {
      const channel = await prisma.channel.findFirst({ where: { id: scopeId, companyId } });
      if (!channel) throw new NotFoundError("Canal não encontrado");
      break;
    }
  }
}

export async function resolveScopeName(companyId: string, scopeType: OrgScopeType, scopeId: string | null) {
  if (scopeType === "EMPRESA") {
    return "Empresa (Geral)";
  }

  if (!scopeId) {
    return "—";
  }

  switch (scopeType) {
    case "MEMBRO": {
      const member = await prisma.member.findFirst({ where: { id: scopeId, companyId }, select: { fullName: true } });
      return member?.fullName ?? "—";
    }
    case "TIME": {
      const team = await prisma.team.findFirst({ where: { id: scopeId, companyId }, select: { name: true } });
      return team?.name ?? "—";
    }
    case "DEPARTAMENTO": {
      const department = await prisma.department.findFirst({
        where: { id: scopeId, companyId },
        select: { name: true },
      });
      return department?.name ?? "—";
    }
    case "CANAL": {
      const channel = await prisma.channel.findFirst({ where: { id: scopeId, companyId }, select: { name: true } });
      return channel?.name ?? "—";
    }
  }
}

interface WeightPoint {
  referenceMonth: number | null;
  referenceKey: number;
  weight: Prisma.Decimal;
}

interface HistoricalParams {
  resultTypeId: string;
  scopeType: OrgScopeType;
  scopeId: string | null;
  startDate: Date;
  endDate: Date;
}

async function fetchScopedEntries(companyId: string, params: HistoricalParams) {
  return prisma.resultEntry.findMany({
    where: {
      companyId,
      typeId: params.resultTypeId,
      date: { gte: params.startDate, lte: params.endDate },
      member: buildMemberScopeFilter(params.scopeType, params.scopeId),
    },
    select: { date: true, value: true },
  });
}

// Núcleo puro do motor de agrupamento simples (Bases para Metas §1/§2):
// Saz_t = Resultado Histórico do Período_t / Resultado Histórico Total do
// Período. Reaproveitado tanto por calculateGroupedWeights (peso do TIPO
// escolhido pelo usuário) quanto por computeAllPreviewSeries (as 4 lentes
// sempre calculadas juntas, independente do tipo escolhido) — evita buscar
// as entries do banco mais de uma vez por lente.
function groupEntriesByBucket(
  entries: { date: Date; value: Prisma.Decimal }[],
  extractor: (date: Date) => number,
  bucketCount: number,
): WeightPoint[] {
  const totals = new Map<number, Prisma.Decimal>();

  for (let bucket = 1; bucket <= bucketCount; bucket++) {
    totals.set(bucket, new Prisma.Decimal(0));
  }

  let grandTotal = new Prisma.Decimal(0);

  for (const entry of entries) {
    const key = extractor(entry.date);
    totals.set(key, totals.get(key)!.plus(entry.value));
    grandTotal = grandTotal.plus(entry.value);
  }

  if (grandTotal.isZero()) {
    throw new ConflictError(
      "Não há dados históricos no período e escopo selecionados para calcular a sazonalidade.",
    );
  }

  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([referenceKey, sum]) => ({
      referenceMonth: null,
      referenceKey,
      weight: sum.dividedBy(grandTotal),
    }));
}

// Motor de Sazonalidade — agrupamento simples (Bases para Metas §1/§2).
// Serve Dias da Semana, Dias do Ano, Meses do Ano e Trimestres — só muda o
// critério de agrupamento (extractor) e o número de baldes.
async function calculateGroupedWeights(
  companyId: string,
  analysisType: SupportedAnalysisType,
  params: HistoricalParams,
): Promise<WeightPoint[]> {
  const count = BUCKET_COUNTS[analysisType]!;
  const extractor = GROUPED_EXTRACTORS[analysisType]!;
  const entries = await fetchScopedEntries(companyId, params);
  return groupEntriesByBucket(entries, extractor, count);
}

// Motor de Sazonalidade — Dias do Mês (Bases para Metas §2): diferente dos
// demais, a spec pede a MÉDIA histórica dos meses do período, não a soma
// simples. Isso evita que um mês com faturamento muito maior distorça o
// padrão: cada mês contribui com seu próprio "formato" (peso de cada dia
// dentro daquele mês), e o resultado final é a média desses formatos.
async function calculateDiasMesWeights(companyId: string, params: HistoricalParams): Promise<WeightPoint[]> {
  const entries = await fetchScopedEntries(companyId, params);

  if (entries.length === 0) {
    throw new ConflictError(
      "Não há dados históricos no período e escopo selecionados para calcular a sazonalidade.",
    );
  }

  const monthTotals = new Map<string, Prisma.Decimal>();
  const monthDayTotals = new Map<string, Map<number, Prisma.Decimal>>();

  for (const entry of entries) {
    const monthKey = `${entry.date.getUTCFullYear()}-${entry.date.getUTCMonth()}`;
    const day = entry.date.getUTCDate();

    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? new Prisma.Decimal(0)).plus(entry.value));

    if (!monthDayTotals.has(monthKey)) {
      monthDayTotals.set(monthKey, new Map());
    }

    const dayMap = monthDayTotals.get(monthKey)!;
    dayMap.set(day, (dayMap.get(day) ?? new Prisma.Decimal(0)).plus(entry.value));
  }

  // Para cada dia (1-31), junta a fração-dentro-do-mês de cada mês que
  // efetivamente teve movimento naquele dia.
  const daySamples = new Map<number, Prisma.Decimal[]>();

  for (let day = 1; day <= 31; day++) {
    daySamples.set(day, []);
  }

  for (const [monthKey, monthTotal] of monthTotals.entries()) {
    if (monthTotal.isZero()) {
      continue;
    }

    const dayMap = monthDayTotals.get(monthKey)!;

    for (const [day, dayTotal] of dayMap.entries()) {
      daySamples.get(day)!.push(dayTotal.dividedBy(monthTotal));
    }
  }

  const rawAverages = new Map<number, Prisma.Decimal>();

  for (let day = 1; day <= 31; day++) {
    const samples = daySamples.get(day)!;

    if (samples.length === 0) {
      rawAverages.set(day, new Prisma.Decimal(0));
      continue;
    }

    const sum = samples.reduce((total, sample) => total.plus(sample), new Prisma.Decimal(0));
    rawAverages.set(day, sum.dividedBy(samples.length));
  }

  // Dias que existem em menos meses (ex: 31) são a média de menos amostras,
  // então a soma bruta das médias por dia não fecha exatamente em 1 —
  // renormaliza no final.
  const grandTotal = [...rawAverages.values()].reduce((total, avg) => total.plus(avg), new Prisma.Decimal(0));

  if (grandTotal.isZero()) {
    throw new ConflictError(
      "Não há dados suficientes no período e escopo selecionados para calcular a sazonalidade.",
    );
  }

  return [...rawAverages.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([referenceKey, avg]) => ({
      referenceMonth: null,
      referenceKey,
      weight: avg.dividedBy(grandTotal),
    }));
}

// Motor de Sazonalidade — Combinadas ("Meses do Ano e Dias da Semana" /
// "Meses do Ano e Dias do Mês", Bases para Metas §2): 2 níveis numa Base só.
// Passo macro: peso de cada Mês sobre o total geral do período (igual ao
// tipo MESES_ANO puro). Passo micro: DENTRO de cada Mês, peso de cada balde
// diário (dia-da-semana ou dia-do-mês) sobre o total DAQUELE mês
// especificamente — não uma média entre meses (diferente de
// calculateDiasMesWeights, que é exclusiva do tipo DIAS_MES puro) — o
// padrão real de cada mês é preservado. O peso final de cada célula
// (mês, balde) já é a fração resolvida sobre o ano inteiro (mesWeight ×
// baldeWeightDentroDoMês), pronta para gravar direto em SeasonalityWeight.
async function calculateCombinedWeights(
  companyId: string,
  analysisType: "MESES_DIAS_SEMANA" | "MESES_DIAS_MES",
  params: HistoricalParams,
): Promise<WeightPoint[]> {
  const dailyExtractor = COMBINED_DAILY_EXTRACTORS[analysisType];
  const entries = await fetchScopedEntries(companyId, params);

  if (entries.length === 0) {
    throw new ConflictError(
      "Não há dados históricos no período e escopo selecionados para calcular a sazonalidade.",
    );
  }

  const monthTotals = new Map<number, Prisma.Decimal>();
  for (let month = 1; month <= 12; month++) {
    monthTotals.set(month, new Prisma.Decimal(0));
  }

  let grandTotal = new Prisma.Decimal(0);
  const monthDailyTotals = new Map<number, Map<number, Prisma.Decimal>>();

  for (const entry of entries) {
    const month = entry.date.getUTCMonth() + 1;
    monthTotals.set(month, monthTotals.get(month)!.plus(entry.value));
    grandTotal = grandTotal.plus(entry.value);

    const bucket = dailyExtractor(entry.date);
    if (!monthDailyTotals.has(month)) {
      monthDailyTotals.set(month, new Map());
    }
    const dayMap = monthDailyTotals.get(month)!;
    dayMap.set(bucket, (dayMap.get(bucket) ?? new Prisma.Decimal(0)).plus(entry.value));
  }

  if (grandTotal.isZero()) {
    throw new ConflictError(
      "Não há dados históricos no período e escopo selecionados para calcular a sazonalidade.",
    );
  }

  const points: WeightPoint[] = [];
  for (const [month, monthTotal] of monthTotals.entries()) {
    if (monthTotal.isZero()) continue; // Sem dado naquele mês — nenhuma célula (peso 0 implícito).

    const monthWeight = monthTotal.dividedBy(grandTotal);
    const dayMap = monthDailyTotals.get(month)!;

    for (const [bucket, bucketTotal] of dayMap.entries()) {
      const withinMonthWeight = bucketTotal.dividedBy(monthTotal);
      points.push({ referenceMonth: month, referenceKey: bucket, weight: monthWeight.times(withinMonthWeight) });
    }
  }

  return points.sort((a, b) => a.referenceMonth! - b.referenceMonth! || a.referenceKey - b.referenceKey);
}

async function calculateWeights(
  companyId: string,
  analysisType: SupportedAnalysisType,
  params: HistoricalParams,
): Promise<WeightPoint[]> {
  if (analysisType === "DIAS_MES") {
    return calculateDiasMesWeights(companyId, params);
  }

  if (isCombinedAnalysisType(analysisType)) {
    return calculateCombinedWeights(companyId, analysisType as "MESES_DIAS_SEMANA" | "MESES_DIAS_MES", params);
  }

  return calculateGroupedWeights(companyId, analysisType, params);
}

interface ManualWeightInput {
  referenceKey: number;
  percentage: number;
}

function buildManualWeights(inputs: ManualWeightInput[], analysisType: SupportedAnalysisType): WeightPoint[] {
  const count = BUCKET_COUNTS[analysisType];

  if (count == null) {
    throw new ConflictError("Este tipo de análise não tem modo Manual.");
  }

  if (inputs.length !== count) {
    throw new ConflictError(`Sazonalidade manual exige exatamente ${count} percentuais.`);
  }

  const sum = inputs.reduce((total, item) => total.plus(item.percentage), new Prisma.Decimal(0));

  if (sum.minus(100).abs().greaterThan(0.01)) {
    throw new ConflictError(`A soma dos percentuais deve fechar em 100%. Soma atual: ${sum.toFixed(2)}%.`);
  }

  return inputs.map((input) => ({
    referenceMonth: null,
    referenceKey: input.referenceKey,
    weight: new Prisma.Decimal(input.percentage).dividedBy(100),
  }));
}

interface PreviewInput {
  resultTypeId: string;
  analysisType: SupportedAnalysisType;
  scopeType: OrgScopeType;
  scopeId: string | null;
  startDate: string;
  endDate: string;
}

export interface AllPreviewSeries {
  weekly: { referenceKey: number; weight: Prisma.Decimal }[];
  dailyOfYear: { referenceKey: number; weight: Prisma.Decimal }[];
  monthly: { referenceKey: number; weight: Prisma.Decimal }[];
  quarterly: { referenceKey: number; weight: Prisma.Decimal }[];
}

// Interface de Salvamento e Pré-visualização (Bases para Metas §2): antes
// de salvar, o gestor vê 4 gráficos de conferência simultâneos — Semanal,
// Diário do Ano, Mensal e Trimestral — SEMPRE juntos, independente de qual
// Tipo de Análise ele vai efetivamente salvar. São 4 lentes simples (soma
// por balde / total geral) sobre o MESMO dado bruto — não usam o algoritmo
// específico do tipo escolhido (ex.: Dias do Mês usa média entre meses só
// quando ELE é o tipo salvo; aqui são sempre soma simples, mesmo se o tipo
// escolhido for Dias do Mês ou uma Combinada).
async function computeAllPreviewSeries(companyId: string, params: HistoricalParams): Promise<AllPreviewSeries> {
  const entries = await fetchScopedEntries(companyId, params);
  const strip = (points: WeightPoint[]) => points.map((p) => ({ referenceKey: p.referenceKey, weight: p.weight }));

  return {
    weekly: strip(groupEntriesByBucket(entries, isoWeekday, 7)),
    dailyOfYear: strip(groupEntriesByBucket(entries, dayOfYear365, 365)),
    monthly: strip(groupEntriesByBucket(entries, (date) => date.getUTCMonth() + 1, 12)),
    quarterly: strip(groupEntriesByBucket(entries, (date) => Math.floor(date.getUTCMonth() / 3) + 1, 4)),
  };
}

export async function previewSeasonality(companyId: string, requestingUser: RequestingUser, data: PreviewInput) {
  assertAdmin(requestingUser);
  const resultType = await prisma.resultType.findFirst({ where: { id: data.resultTypeId, companyId } });

  if (!resultType) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  await assertScopeEntityExists(companyId, data.scopeType, data.scopeId);

  const params: HistoricalParams = {
    resultTypeId: data.resultTypeId,
    scopeType: data.scopeType,
    scopeId: data.scopeId,
    startDate: toDate(data.startDate),
    endDate: toDate(data.endDate),
  };

  const [weights, allSeries] = await Promise.all([
    calculateWeights(companyId, data.analysisType, params),
    computeAllPreviewSeries(companyId, params),
  ]);

  return {
    weights: weights.map((w) => ({ referenceMonth: w.referenceMonth, referenceKey: w.referenceKey, weight: w.weight })),
    allSeries,
  };
}

interface CreateSeasonalityBaseInput {
  name: string;
  resultTypeId: string;
  analysisType: SupportedAnalysisType;
  scopeType: OrgScopeType;
  scopeId: string | null;
  isManual: boolean;
  startDate?: string;
  endDate?: string;
  manualWeights?: ManualWeightInput[];
}

export async function createSeasonalityBase(companyId: string, requestingUser: RequestingUser, data: CreateSeasonalityBaseInput) {
  assertAdmin(requestingUser);
  if (!SUPPORTED_ANALYSIS_TYPES.includes(data.analysisType)) {
    throw new ConflictError("Este tipo de análise ainda não está disponível.");
  }

  const resultType = await prisma.resultType.findFirst({ where: { id: data.resultTypeId, companyId } });

  if (!resultType) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  await assertScopeEntityExists(companyId, data.scopeType, data.scopeId);

  if (data.isManual && isCombinedAnalysisType(data.analysisType)) {
    throw new ConflictError(
      "Sazonalidades Combinadas (Meses + Dias) não têm modo Manual — sempre calculadas a partir do histórico.",
    );
  }

  let weights: WeightPoint[];
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (data.isManual) {
    if (!data.manualWeights) {
      throw new ConflictError("Pesos manuais são obrigatórios quando a sazonalidade é manual.");
    }

    weights = buildManualWeights(data.manualWeights, data.analysisType);
  } else {
    if (!data.startDate || !data.endDate) {
      throw new ConflictError("Período de análise histórica (Data Inicial e Final) é obrigatório.");
    }

    startDate = toDate(data.startDate);
    endDate = toDate(data.endDate);

    weights = await calculateWeights(companyId, data.analysisType, {
      resultTypeId: data.resultTypeId,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      startDate,
      endDate,
    });
  }

  return writeWithTenant((tx) =>
    tx.seasonalityBase.create({
      data: {
        companyId,
        name: data.name,
        resultTypeId: data.resultTypeId,
        analysisType: data.analysisType,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        startDate,
        endDate,
        isManual: data.isManual,
        weights: {
          create: weights.map((w) => ({
            companyId,
            referenceMonth: w.referenceMonth,
            referenceKey: w.referenceKey,
            weight: w.weight,
          })),
        },
      },
      include: {
        weights: { orderBy: { referenceKey: "asc" } },
        resultType: { select: { id: true, name: true, unit: true } },
      },
    }),
  );
}

// PASSO 9.6: editar uma Base de Sazonalidade existente — não existia antes
// (só Criar/Excluir). Mesma validação de createSeasonalityBase; os pesos
// são sempre recalculados/substituídos por completo (delete + recreate na
// mesma transação, mesmo padrão já usado em deleteSeasonalityBase e nas
// Lideranças da Estrutura Organizacional). Não bloqueia edição de Base já
// em uso por Linhas de Meta (diferente de excluir, que bloqueia): o motor
// de Metas grava os valores calculados na própria Linha no momento de
// aplicar ("Persistência Rígida") — editar a Base depois não altera
// retroativamente o que já foi aplicado, só passa a valer pra próxima vez
// que essa Base for usada.
export async function updateSeasonalityBase(
  companyId: string,
  requestingUser: RequestingUser,
  id: string,
  data: CreateSeasonalityBaseInput,
) {
  assertAdmin(requestingUser);

  const base = await prisma.seasonalityBase.findFirst({ where: { id, companyId } });
  if (!base) {
    throw new NotFoundError("Base de Sazonalidade não encontrada");
  }

  if (!SUPPORTED_ANALYSIS_TYPES.includes(data.analysisType)) {
    throw new ConflictError("Este tipo de análise ainda não está disponível.");
  }

  const resultType = await prisma.resultType.findFirst({ where: { id: data.resultTypeId, companyId } });
  if (!resultType) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  await assertScopeEntityExists(companyId, data.scopeType, data.scopeId);

  if (data.isManual && isCombinedAnalysisType(data.analysisType)) {
    throw new ConflictError(
      "Sazonalidades Combinadas (Meses + Dias) não têm modo Manual — sempre calculadas a partir do histórico.",
    );
  }

  let weights: WeightPoint[];
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (data.isManual) {
    if (!data.manualWeights) {
      throw new ConflictError("Pesos manuais são obrigatórios quando a sazonalidade é manual.");
    }

    weights = buildManualWeights(data.manualWeights, data.analysisType);
  } else {
    if (!data.startDate || !data.endDate) {
      throw new ConflictError("Período de análise histórica (Data Inicial e Final) é obrigatório.");
    }

    startDate = toDate(data.startDate);
    endDate = toDate(data.endDate);

    weights = await calculateWeights(companyId, data.analysisType, {
      resultTypeId: data.resultTypeId,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      startDate,
      endDate,
    });
  }

  return withTenant(async (tx) => {
    await tx.seasonalityWeight.deleteMany({ where: { seasonalityBaseId: id } });

    return tx.seasonalityBase.update({
      where: { id },
      data: {
        name: data.name,
        resultTypeId: data.resultTypeId,
        analysisType: data.analysisType,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        startDate,
        endDate,
        isManual: data.isManual,
        weights: {
          create: weights.map((w) => ({
            companyId,
            referenceMonth: w.referenceMonth,
            referenceKey: w.referenceKey,
            weight: w.weight,
          })),
        },
      },
      include: {
        weights: { orderBy: { referenceKey: "asc" } },
        resultType: { select: { id: true, name: true, unit: true } },
      },
    });
  });
}

export async function listSeasonalityBases(companyId: string, requestingUser: RequestingUser) {
  assertAdmin(requestingUser);
  const bases = await prisma.seasonalityBase.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    include: {
      resultType: { select: { id: true, name: true, unit: true } },
      weights: { orderBy: { referenceKey: "asc" } },
    },
  });

  return Promise.all(
    bases.map(async (base) => ({
      ...base,
      scopeName: await resolveScopeName(companyId, base.scopeType, base.scopeId),
    })),
  );
}

export async function deleteSeasonalityBase(companyId: string, requestingUser: RequestingUser, id: string) {
  assertAdmin(requestingUser);
  const base = await prisma.seasonalityBase.findFirst({
    where: { id, companyId },
    include: { _count: { select: { goalLines: true } } },
  });

  if (!base) {
    throw new NotFoundError("Base de Sazonalidade não encontrada");
  }

  if (base._count.goalLines > 0) {
    throw new ConflictError("Não é possível excluir: esta base já está sendo usada em Metas.");
  }

  await withTenant(async (tx) => {
    await tx.seasonalityWeight.deleteMany({ where: { seasonalityBaseId: id } });
    await tx.seasonalityBase.delete({ where: { id } });
  });
}
