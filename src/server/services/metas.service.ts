import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import {
  Prisma,
  type GoalCampaignStatus,
  type GoalEngineType,
  type OrgScopeType,
  type ResultUnit,
  type SeasonalityAnalysisType,
} from "@prisma/client";
import {
  buildMemberScopeFilter,
  dayOfYear365,
  getRealizadoDailyMap,
  isCombinedAnalysisType,
  isoWeekday,
  type SupportedAnalysisType,
} from "./bases-metas.service";
import {
  assertNodeWithinEditableScope,
  assertOwnedOrAdmin,
  assertVisibleScope,
  isNodeWithinEditableScope,
  resolveAncestorIds,
  resolveRequesterMemberId,
  resolveVisibleMemberFilter,
  resolveVisibleNodeIds,
  type AncestorIds,
  type RequestingUser,
} from "./scope.util";
import { toDate } from "./resultados.service";
import {
  addDailyMaps,
  type DailyMap,
  groupDailyMapBy,
  isoKey,
  isoWeekKey,
  monthKeyOf,
  type PeriodTotal,
  quarterKeyOf,
} from "./daily-map.util";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

export { addDailyMaps, groupDailyMapBy, isoKey, isoWeekKey, monthKeyOf, quarterKeyOf };
export type { DailyMap, PeriodTotal };

// ============================================================
// Campanhas de Meta
// ============================================================

interface GoalCampaignInput {
  name: string;
  startDate: string;
  endDate: string;
  resultTypeId: string;
}

function assertValidPeriod(startDate: Date, endDate: Date) {
  if (startDate > endDate) {
    throw new ConflictError("A Data Inicial do período da meta deve ser anterior (ou igual) à Data Final.");
  }
}

// PASSO 9.7: `canManage` (Editar/Desativar/Duplicar/Excluir) segue a MESMA
// regra de assertOwnedOrAdmin (dono ou Admin) — só espelhada aqui, sem
// I/O extra, pro client saber de antemão o que esconder.
function canManageCampaign(requestingUser: RequestingUser, createdByUserId: string | null): boolean {
  if (requestingUser.role === "ADMINISTRADOR") return true;
  return requestingUser.role === "LIDERANCA_NO" && createdByUserId === requestingUser.id;
}

export async function listGoalCampaigns(companyId: string, requestingUser: RequestingUser) {
  const visibilityFilter = await buildGoalCampaignVisibilityFilter(companyId, requestingUser);
  const campaigns = await prisma.goalCampaign.findMany({
    where: { companyId, ...visibilityFilter },
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    include: { resultType: { select: { id: true, name: true, unit: true } } },
  });

  return campaigns.map((campaign) => ({
    ...campaign,
    canManage: canManageCampaign(requestingUser, campaign.createdByUserId),
  }));
}

export async function createGoalCampaign(companyId: string, requestingUser: RequestingUser, data: GoalCampaignInput) {
  if (requestingUser.role === "OPERACIONAL") {
    throw new ForbiddenError("Você não tem permissão para criar Campanhas de Meta.");
  }

  const resultType = await prisma.resultType.findFirst({ where: { id: data.resultTypeId, companyId } });

  if (!resultType) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  const startDate = toDate(data.startDate);
  const endDate = toDate(data.endDate);
  assertValidPeriod(startDate, endDate);

  return writeWithTenant((tx) =>
    tx.goalCampaign.create({
      data: {
        companyId,
        name: data.name,
        resultTypeId: data.resultTypeId,
        startDate,
        endDate,
        createdByUserId: requestingUser.id,
      },
    }),
  );
}

async function getCampaignOrThrow(companyId: string, goalCampaignId: string) {
  const campaign = await prisma.goalCampaign.findFirst({ where: { id: goalCampaignId, companyId } });

  if (!campaign) {
    throw new NotFoundError("Campanha de Meta não encontrada");
  }

  return campaign;
}

// Edição livre de nome/período/Tipo de Resultado — a campanha não fixa mais
// um Nível Base a travar. Alterar o período de uma campanha que já tem
// Linhas de Meta não recalcula os valores diários automaticamente: as
// Linhas precisam ser reaplicadas.
export async function updateGoalCampaign(companyId: string, requestingUser: RequestingUser, id: string, data: GoalCampaignInput) {
  const campaign = await getCampaignOrThrow(companyId, id);
  assertOwnedOrAdmin(requestingUser, campaign.createdByUserId, "Você só pode editar Campanhas que você mesmo criou.");

  if (data.resultTypeId !== campaign.resultTypeId) {
    const resultType = await prisma.resultType.findFirst({ where: { id: data.resultTypeId, companyId } });
    if (!resultType) {
      throw new NotFoundError("Tipo de Resultado não encontrado");
    }
  }

  const startDate = toDate(data.startDate);
  const endDate = toDate(data.endDate);
  assertValidPeriod(startDate, endDate);

  return writeWithTenant((tx) =>
    tx.goalCampaign.update({
      where: { id },
      data: {
        name: data.name,
        startDate,
        endDate,
        resultTypeId: data.resultTypeId,
      },
    }),
  );
}

export async function updateGoalCampaignStatus(companyId: string, requestingUser: RequestingUser, id: string, status: GoalCampaignStatus) {
  const campaign = await getCampaignOrThrow(companyId, id);
  assertOwnedOrAdmin(requestingUser, campaign.createdByUserId, "Você só pode alterar o status de Campanhas que você mesmo criou.");
  return writeWithTenant((tx) => tx.goalCampaign.update({ where: { id }, data: { status } }));
}

// Ativar/Desativar com data efetiva: ao desativar, a campanha para de
// compor Recebíveis (quando esse módulo existir) a partir de `effectiveDate`
// — e continua visível no Acompanhamento, só marcada "Inativa desde X". Ao
// reativar, limpa a data (fica ativa incondicionalmente de novo).
export async function setGoalCampaignActiveStatus(
  companyId: string,
  requestingUser: RequestingUser,
  id: string,
  effectiveDate: string | null,
) {
  const campaign = await getCampaignOrThrow(companyId, id);
  assertOwnedOrAdmin(requestingUser, campaign.createdByUserId, "Você só pode ativar/desativar Campanhas que você mesmo criou.");

  return writeWithTenant((tx) =>
    tx.goalCampaign.update({
      where: { id },
      data: {
        status: effectiveDate ? "INATIVA" : "ATIVA",
        inactivatedAt: effectiveDate ? toDate(effectiveDate) : null,
      },
    }),
  );
}

export async function deleteGoalCampaign(companyId: string, requestingUser: RequestingUser, id: string) {
  const campaign = await prisma.goalCampaign.findFirst({
    where: { id, companyId },
    include: { _count: { select: { lines: true } } },
  });

  if (!campaign) {
    throw new NotFoundError("Campanha de Meta não encontrada");
  }

  assertOwnedOrAdmin(requestingUser, campaign.createdByUserId, "Você só pode excluir Campanhas que você mesmo criou.");

  if (campaign._count.lines > 0) {
    throw new ConflictError("Não é possível excluir: esta campanha já possui Linhas de Meta calculadas.");
  }

  await withTenant(async (tx) => {
    await tx.goalTrigger.deleteMany({ where: { goalCampaignId: id } });
    await tx.goalCampaign.delete({ where: { id } });
  });
}

// Clona a Campanha inteira (nome com sufixo "(cópia)") junto com todas as
// suas Linhas de Meta ATIVAS — cada Linha carrega seus GoalDailyValue
// (copiados diretamente, sem recalcular fórmula: Persistência Rígida, spec
// §7 Metas) e, se for Agrupamento, os GoalLineGroupSource também. Linhas
// inativas/histórico de recálculo não são clonadas — a cópia nasce só com o
// estado ativo atual, pronta para edição independente (mesmo espírito do
// "Duplicar" de Bases de Recebível).
export async function duplicateGoalCampaign(companyId: string, requestingUser: RequestingUser, id: string) {
  const campaign = await getCampaignOrThrow(companyId, id);
  assertOwnedOrAdmin(requestingUser, campaign.createdByUserId, "Você só pode duplicar Campanhas que você mesmo criou.");
  const allLines = await prisma.goalLine.findMany({
    where: { companyId, goalCampaignId: id, inactivatedAt: null },
    include: { dailyValues: true, groupSources: true },
  });

  // PASSO 9.7: quem duplica só é dono OU Admin (checado acima) — mas o
  // escopo do dono pode ter mudado desde que a Campanha foi criada (ex:
  // atribuições editadas depois). Duplicar clona só as Linhas que o
  // requisitante consegue editar HOJE — as demais ficam de fora da cópia,
  // sem abortar a operação inteira (Admin sempre clona tudo).
  const lines =
    requestingUser.role === "ADMINISTRADOR"
      ? allLines
      : (
          await Promise.all(
            allLines.map(async (line) => ({
              line,
              allowed: await isNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId),
            })),
          )
        )
          .filter((item) => item.allowed)
          .map((item) => item.line);

  return withTenant(
    async (tx) => {
      const clone = await tx.goalCampaign.create({
        data: {
          companyId,
          name: `${campaign.name} (cópia)`,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          resultTypeId: campaign.resultTypeId,
          createdByUserId: requestingUser.id,
        },
      });

      for (const line of lines) {
        const newLine = await tx.goalLine.create({
          data: {
            companyId,
            goalCampaignId: clone.id,
            entityType: line.entityType,
            entityId: line.entityId,
            memberId: line.memberId,
            teamId: line.teamId,
            departmentId: line.departmentId,
            channelId: line.channelId,
            seasonalityBaseId: line.seasonalityBaseId,
            dailySeasonalityBaseId: line.dailySeasonalityBaseId,
            engineType: line.engineType,
            initialValue: line.initialValue,
            growthRate: line.growthRate,
            groupDiscountPercentage: line.groupDiscountPercentage,
            isManualOverride: line.isManualOverride,
            appliedAt: new Date(),
          },
        });

        if (line.dailyValues.length > 0) {
          await tx.goalDailyValue.createMany({
            data: line.dailyValues.map((d) => ({ companyId, goalLineId: newLine.id, date: d.date, value: d.value })),
          });
        }
        if (line.groupSources.length > 0) {
          await tx.goalLineGroupSource.createMany({
            data: line.groupSources.map((s) => ({
              companyId,
              goalLineId: newLine.id,
              sourceGoalCampaignId: s.sourceGoalCampaignId,
              sourceEntityType: s.sourceEntityType,
              sourceEntityId: s.sourceEntityId,
            })),
          });
        }
      }

      return clone;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ============================================================
// Gatilhos (escada de percentuais/flags de cor)
// ============================================================

interface GoalTriggerInput {
  percentage: number;
  colorFlag: string;
}

export async function listGoalTriggers(companyId: string, goalCampaignId: string) {
  await getCampaignOrThrow(companyId, goalCampaignId);
  return prisma.goalTrigger.findMany({ where: { companyId, goalCampaignId }, orderBy: { order: "asc" } });
}

// Substitui a escada inteira a cada chamada — mais simples do que CRUD
// individual e evita furos/ordens duplicadas na sequência de gatilhos.
export async function setGoalTriggers(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  triggers: GoalTriggerInput[],
) {
  const campaign = await getCampaignOrThrow(companyId, goalCampaignId);
  assertOwnedOrAdmin(requestingUser, campaign.createdByUserId, "Você só pode alterar Gatilhos de Campanhas que você mesmo criou.");

  if (triggers.length === 0) {
    throw new ConflictError("Informe ao menos um gatilho.");
  }

  for (const trigger of triggers) {
    if (trigger.percentage <= 0) {
      throw new ConflictError("O percentual do gatilho deve ser maior que zero.");
    }

    if (!trigger.colorFlag.trim()) {
      throw new ConflictError("A flag de cor do gatilho é obrigatória.");
    }
  }

  return withTenant(async (tx) => {
    await tx.goalTrigger.deleteMany({ where: { goalCampaignId } });
    await tx.goalTrigger.createMany({
      data: triggers.map((trigger, index) => ({
        companyId,
        goalCampaignId,
        order: index + 1,
        percentage: trigger.percentage,
        colorFlag: trigger.colorFlag,
      })),
    });

    return tx.goalTrigger.findMany({ where: { goalCampaignId }, orderBy: { order: "asc" } });
  });
}

// ============================================================
// Validação de entidade + resolução de nomes
// ============================================================

// Convenção deste projeto: como GoalLine.entityId é uma coluna obrigatória
// no schema (diferente de SeasonalityBase.scopeId, que aceita null), o
// nível EMPRESA usa o próprio companyId como entityId — não existe uma
// segunda entidade "empresa" para referenciar.
export async function assertEntityBelongsToCompany(companyId: string, entityType: OrgScopeType, entityId: string) {
  if (entityType === "EMPRESA") {
    if (entityId !== companyId) {
      throw new ConflictError("Para o nível Empresa, o identificador da entidade deve ser o próprio ID da empresa.");
    }
    return;
  }

  switch (entityType) {
    case "MEMBRO": {
      const member = await prisma.member.findFirst({ where: { id: entityId, companyId } });
      if (!member) throw new NotFoundError("Membro não encontrado");
      return;
    }
    case "TIME": {
      const team = await prisma.team.findFirst({ where: { id: entityId, companyId } });
      if (!team) throw new NotFoundError("Time não encontrado");
      return;
    }
    case "DEPARTAMENTO": {
      const department = await prisma.department.findFirst({ where: { id: entityId, companyId } });
      if (!department) throw new NotFoundError("Departamento não encontrado");
      return;
    }
    case "CANAL": {
      const channel = await prisma.channel.findFirst({ where: { id: entityId, companyId } });
      if (!channel) throw new NotFoundError("Canal não encontrado");
      return;
    }
  }
}

export async function resolveEntityName(companyId: string, entityType: OrgScopeType, entityId: string): Promise<string> {
  if (entityType === "EMPRESA") {
    return "Empresa (Geral)";
  }

  switch (entityType) {
    case "MEMBRO": {
      const member = await prisma.member.findFirst({ where: { id: entityId, companyId }, select: { fullName: true } });
      return member?.fullName ?? "—";
    }
    case "TIME": {
      const team = await prisma.team.findFirst({ where: { id: entityId, companyId }, select: { name: true } });
      return team?.name ?? "—";
    }
    case "DEPARTAMENTO": {
      const department = await prisma.department.findFirst({
        where: { id: entityId, companyId },
        select: { name: true },
      });
      return department?.name ?? "—";
    }
    case "CANAL": {
      const channel = await prisma.channel.findFirst({ where: { id: entityId, companyId }, select: { name: true } });
      return channel?.name ?? "—";
    }
  }
}

// ============================================================
// Períodos mensais do calendário (Metas §7 — GoalDailyValue)
//
// O motor de cálculo é SEMPRE mensal: a unidade atômica de planejamento é o
// mês. A meta Trimestral entende o total por trimestre (crescimento composto
// por trimestre) mas o subdivide entre os 3 meses do trimestre pela
// sazonalidade mensal; a meta diária nunca é um motor à parte — o valor do
// mês é sempre repartido igualmente pelos seus dias (distributeEvenly).
// ============================================================

export function daysInMonth(year: number, month1based: number): number {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

export function daysOfMonth(year: number, month1based: number): Date[] {
  const total = daysInMonth(year, month1based);
  return Array.from({ length: total }, (_, i) => new Date(Date.UTC(year, month1based - 1, i + 1)));
}

// Um mês dentro do período da campanha: sequenceIndex é a posição ordinal do
// mês dentro da campanha (1, 2, 3...), usada como expoente de juros
// compostos no MCDS mensal — independe do calendário. calendarKey é o mês
// real (1-12), usado para consultar o peso na Base de Sazonalidade (permite
// reaproveitar o mesmo "formato" intra-ano de uma Base mesmo quando o
// período da campanha não começa em Janeiro). days já vem cortado pelos
// limites [startDate, endDate] (meses de borda ficam parciais).
export interface CampaignPeriod {
  sequenceIndex: number;
  calendarKey: number;
  days: Date[];
}

function clampToRange(days: Date[], startDate: Date, endDate: Date): Date[] {
  return days.filter((day) => day >= startDate && day <= endDate);
}

export function buildMonthlyPeriods(startDate: Date, endDate: Date): CampaignPeriod[] {
  const periods: CampaignPeriod[] = [];
  let sequenceIndex = 0;

  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth() + 1;
  const endYear = endDate.getUTCFullYear();
  const endMonth = endDate.getUTCMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    sequenceIndex++;
    periods.push({
      sequenceIndex,
      calendarKey: month,
      days: clampToRange(daysOfMonth(year, month), startDate, endDate),
    });

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return periods;
}

// Agrupa os meses da campanha em trimestres-calendário consecutivos (Q1-Q4),
// preservando a sequenceIndex mensal original — usado só pelo motor
// Trimestral para saber o expoente de crescimento (por trimestre) de cada
// mês e como agregar o peso mensal em peso do trimestre.
export interface QuarterGroup {
  quarterSequenceIndex: number;
  monthSequenceIndexes: number[];
}

export function groupMonthsIntoQuarters(monthlyPeriods: CampaignPeriod[]): QuarterGroup[] {
  const groups: QuarterGroup[] = [];
  let currentKey: string | null = null;

  for (const period of monthlyPeriods) {
    const firstDay = period.days[0];
    const year = firstDay.getUTCFullYear();
    const quarter = Math.floor((period.calendarKey - 1) / 3) + 1;
    const key = `${year}-${quarter}`;

    if (key !== currentKey) {
      groups.push({ quarterSequenceIndex: groups.length + 1, monthSequenceIndexes: [period.sequenceIndex] });
      currentKey = key;
    } else {
      groups[groups.length - 1].monthSequenceIndexes.push(period.sequenceIndex);
    }
  }

  return groups;
}

// ============================================================
// Motores de Cálculo (skill-math-comercial.md): Top-Down, MCDS
// ============================================================

async function getSeasonalityWeights(companyId: string, seasonalityBaseId: string) {
  const base = await prisma.seasonalityBase.findFirst({
    where: { id: seasonalityBaseId, companyId },
    include: { weights: { orderBy: { referenceKey: "asc" } } },
  });

  if (!base) {
    throw new NotFoundError("Base de Sazonalidade não encontrada");
  }

  const analysisType = base.analysisType as SupportedAnalysisType;
  const weights = new Map<number, Prisma.Decimal>();

  if (analysisType === "MESES_ANO") {
    for (const weight of base.weights) {
      weights.set(weight.referenceKey, weight.weight);
    }
    return weights;
  }

  if (isCombinedAnalysisType(analysisType)) {
    // Base Combinada: cada linha já é o peso de UMA célula (mês, balde
    // diário) sobre o ano inteiro — somar todas as células de um mesmo
    // referenceMonth recupera o peso daquele mês sozinho, no mesmo formato
    // que o resto do motor mensal já consome.
    for (const weight of base.weights) {
      const month = weight.referenceMonth!;
      weights.set(month, (weights.get(month) ?? new Prisma.Decimal(0)).plus(weight.weight));
    }
    return weights;
  }

  throw new ConflictError(
    'O motor de Metas exige uma Base de Sazonalidade do tipo "Meses do Ano" ou uma Combinada ("Meses do Ano e Dias...").',
  );
}

export interface PeriodWeight {
  sequenceIndex: number;
  weight: Prisma.Decimal;
}

// Resolve o peso de cada mês do período. Sem Base de Sazonalidade: peso
// igual para todos os meses. Com Base: pega o peso original do mês
// (calendarKey) e RENORMALIZA pela soma dos pesos só dos meses que entram
// neste período — é o que faz Julho (10% num ano cheio) virar 20% quando a
// campanha cobre só Julho-Dezembro (que juntos somavam 50% do ano
// original). Para um período de ano completo isso é a identidade (soma = 1).
export function resolvePeriodWeights(
  periods: CampaignPeriod[],
  seasonalityWeights: Map<number, Prisma.Decimal> | null,
): PeriodWeight[] {
  if (!seasonalityWeights) {
    const uniform = new Prisma.Decimal(1).dividedBy(periods.length);
    return periods.map((period) => ({ sequenceIndex: period.sequenceIndex, weight: uniform }));
  }

  const raw = periods.map((period) => ({
    sequenceIndex: period.sequenceIndex,
    raw: seasonalityWeights.get(period.calendarKey) ?? new Prisma.Decimal(0),
  }));

  const total = raw.reduce((acc, w) => acc.plus(w.raw), new Prisma.Decimal(0));

  if (total.isZero()) {
    throw new ConflictError(
      "A Base de Sazonalidade não tem peso em nenhum mês deste período — verifique a Base ou use Sem Sazonalidade.",
    );
  }

  return raw.map((w) => ({ sequenceIndex: w.sequenceIndex, weight: w.raw.dividedBy(total) }));
}

// Top-Down (skill doc §2): M_alvo = V.I.A. * (1 + G); Meta_t = M_alvo * Saz_t.
// Sem juros compostos período a período.
// Exportada (junto com calculateMcds/distributeEvenly abaixo) para permitir
// teste unitário direto das fórmulas, sem depender de banco de dados.
export function calculateTopDown(via: Prisma.Decimal, growthRate: Prisma.Decimal, periodWeights: PeriodWeight[]) {
  const targetTotal = via.times(new Prisma.Decimal(1).plus(growthRate));
  const periodValues = new Map<number, Prisma.Decimal>();

  for (const { sequenceIndex, weight } of periodWeights) {
    periodValues.set(sequenceIndex, targetTotal.times(weight));
  }

  return { targetTotal, periodValues };
}

// MCDS (skill doc §3): aceleração composta atenuada pela sazonalidade real —
// motor mensal direto (CRESCIMENTO_MENSAL) e também o "Sem Sazonalidade"
// mensal (pesos iguais entram como qualquer outro PeriodWeight).
export function calculateMcds(via: Prisma.Decimal, periodRate: Prisma.Decimal, periodWeights: PeriodWeight[]) {
  const periods = periodWeights.length;
  const initialAverage = via.dividedBy(periods);
  const onePlusRate = new Prisma.Decimal(1).plus(periodRate);

  let poolTotal = new Prisma.Decimal(0);
  const wValues = new Map<number, Prisma.Decimal>();
  let wSum = new Prisma.Decimal(0);

  for (const { sequenceIndex, weight } of periodWeights) {
    const growthFactor = onePlusRate.pow(sequenceIndex);
    poolTotal = poolTotal.plus(initialAverage.times(growthFactor));

    const w = weight.times(growthFactor);
    wValues.set(sequenceIndex, w);
    wSum = wSum.plus(w);
  }

  const periodValues = new Map<number, Prisma.Decimal>();

  for (const { sequenceIndex } of periodWeights) {
    const w = wValues.get(sequenceIndex)!;
    periodValues.set(sequenceIndex, wSum.isZero() ? new Prisma.Decimal(0) : w.dividedBy(wSum).times(poolTotal));
  }

  return { poolTotal, periodValues };
}

// MCDS Trimestral (skill doc §3, subdividido por mês): os juros compostos
// aceleram por TRIMESTRE (crescimento "por período" = por trimestre), mas o
// resultado final já sai por MÊS — cada trimestre calcula seu Meta_trimestre
// exatamente como o MCDS normal (usando a soma dos pesos mensais do
// trimestre como Saz do trimestre) e depois reparte esse valor entre seus
// meses proporcionalmente ao peso de cada mês dentro do trimestre.
export function calculateMcdsQuarterlyByMonth(
  via: Prisma.Decimal,
  quarterlyRate: Prisma.Decimal,
  monthlyWeights: PeriodWeight[],
  quarterGroups: QuarterGroup[],
) {
  const totalQuarters = quarterGroups.length;
  const initialAverage = via.dividedBy(totalQuarters);
  const onePlusRate = new Prisma.Decimal(1).plus(quarterlyRate);
  const weightByMonth = new Map(monthlyWeights.map((w) => [w.sequenceIndex, w.weight]));

  let poolTotal = new Prisma.Decimal(0);
  const quarterWeight = new Map<number, Prisma.Decimal>();
  const quarterSaz = new Map<number, Prisma.Decimal>();
  let wSum = new Prisma.Decimal(0);

  for (const group of quarterGroups) {
    const growthFactor = onePlusRate.pow(group.quarterSequenceIndex);
    poolTotal = poolTotal.plus(initialAverage.times(growthFactor));

    const sazQuarter = group.monthSequenceIndexes.reduce(
      (acc, monthIndex) => acc.plus(weightByMonth.get(monthIndex) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const w = sazQuarter.times(growthFactor);
    quarterWeight.set(group.quarterSequenceIndex, w);
    quarterSaz.set(group.quarterSequenceIndex, sazQuarter);
    wSum = wSum.plus(w);
  }

  const periodValues = new Map<number, Prisma.Decimal>();

  for (const group of quarterGroups) {
    const w = quarterWeight.get(group.quarterSequenceIndex)!;
    const metaQuarter = wSum.isZero() ? new Prisma.Decimal(0) : w.dividedBy(wSum).times(poolTotal);
    const sazQuarter = quarterSaz.get(group.quarterSequenceIndex)!;

    for (const monthIndex of group.monthSequenceIndexes) {
      const sazMonth = weightByMonth.get(monthIndex) ?? new Prisma.Decimal(0);
      const share = sazQuarter.isZero()
        ? new Prisma.Decimal(1).dividedBy(group.monthSequenceIndexes.length)
        : sazMonth.dividedBy(sazQuarter);
      periodValues.set(monthIndex, metaQuarter.times(share));
    }
  }

  return { poolTotal, periodValues };
}

interface GoalLineCalcInput {
  entityType: OrgScopeType;
  entityId: string;
  engineType: Extract<GoalEngineType, "VALOR_ALVO_ANUAL" | "CRESCIMENTO_MENSAL" | "CRESCIMENTO_TRIMESTRAL">;
  // null = modo "Sem Sazonalidade" (pesos iguais entre todos os meses).
  seasonalityBaseId: string | null;
  initialValue: number;
  growthRate: number;
}

async function computeGoalLinePeriods(
  companyId: string,
  campaign: { startDate: Date; endDate: Date },
  input: GoalLineCalcInput,
) {
  if (input.initialValue <= 0) {
    throw new ConflictError("O Valor Inicial deve ser maior que zero.");
  }

  const via = new Prisma.Decimal(input.initialValue);
  const rate = new Prisma.Decimal(input.growthRate);

  const periods = buildMonthlyPeriods(campaign.startDate, campaign.endDate);

  if (periods.length === 0) {
    throw new ConflictError("O período da campanha não contém nenhum dia.");
  }

  const seasonalityWeights = input.seasonalityBaseId
    ? await getSeasonalityWeights(companyId, input.seasonalityBaseId)
    : null;

  const monthlyWeights = resolvePeriodWeights(periods, seasonalityWeights);

  if (input.engineType === "VALOR_ALVO_ANUAL") {
    const { periodValues } = calculateTopDown(via, rate, monthlyWeights);
    return { periods, periodValues };
  }

  if (input.engineType === "CRESCIMENTO_MENSAL") {
    const { periodValues } = calculateMcds(via, rate, monthlyWeights);
    return { periods, periodValues };
  }

  const quarterGroups = groupMonthsIntoQuarters(periods);
  const { periodValues } = calculateMcdsQuarterlyByMonth(via, rate, monthlyWeights, quarterGroups);
  return { periods, periodValues };
}

// ============================================================
// Distribuição do valor de cada mês nos seus dias
// ============================================================

// Divide o valor do mês igualmente pelos seus dias, jogando o resto de
// arredondamento no último dia — garante que a soma diária bate exatamente
// com o valor do mês, sem sobra nem falta de centavos. É sempre assim,
// automaticamente — não existe um modo "diário" separado do motor mensal.
export function distributeEvenly(total: Prisma.Decimal, days: Date[]): Map<string, Prisma.Decimal> {
  const count = days.length;
  const base = total.dividedBy(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const result = new Map<string, Prisma.Decimal>();
  let running = new Prisma.Decimal(0);

  days.forEach((day, index) => {
    const key = isoKey(day);

    if (index === count - 1) {
      result.set(key, total.minus(running));
    } else {
      result.set(key, base);
      running = running.plus(base);
    }
  });

  return result;
}

export function periodValuesToDaily(
  periods: CampaignPeriod[],
  periodValues: Map<number, Prisma.Decimal>,
): Map<string, Prisma.Decimal> {
  const daily = new Map<string, Prisma.Decimal>();

  for (const period of periods) {
    const value = periodValues.get(period.sequenceIndex) ?? new Prisma.Decimal(0);

    for (const [key, dailyValue] of distributeEvenly(value, period.days).entries()) {
      daily.set(key, dailyValue);
    }
  }

  return daily;
}

// ============================================================
// Linhas de Meta (uma por entidade dentro do Nível Base)
// ============================================================

// Calcula sem persistir — permite o Gestor ajustar Valor Inicial/Crescimento
// e ver a curva mensal resultante antes de aplicar (mesmo padrão de
// preview/create de bases-metas.service.ts).
export async function previewGoalLine(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  input: GoalLineCalcInput,
) {
  const campaign = await getCampaignOrThrow(companyId, goalCampaignId);
  await assertEntityBelongsToCompany(companyId, input.entityType, input.entityId);
  await assertNodeWithinEditableScope(companyId, requestingUser, input.entityType, input.entityId);

  const { periods, periodValues } = await computeGoalLinePeriods(companyId, campaign, input);
  const total = [...periodValues.values()].reduce((acc, value) => acc.plus(value), new Prisma.Decimal(0));

  return {
    total,
    periods: periods.map((period) => ({
      period: period.sequenceIndex,
      value: periodValues.get(period.sequenceIndex) ?? new Prisma.Decimal(0),
      startDate: period.days[0] ? isoKey(period.days[0]) : null,
      endDate: period.days[period.days.length - 1] ? isoKey(period.days[period.days.length - 1]) : null,
    })),
  };
}

// Cria OU edita a Linha de Meta ATIVA desta entidade (se houver uma
// inativa — ex: substituída por um recálculo — não é tocada). Editar uma
// linha existente é simplesmente chamar de novo com os novos parâmetros —
// a curva diária anterior é descartada e recriada.
export async function applyGoalLine(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  input: GoalLineCalcInput,
) {
  const campaign = await getCampaignOrThrow(companyId, goalCampaignId);
  await assertEntityBelongsToCompany(companyId, input.entityType, input.entityId);
  await assertNodeWithinEditableScope(companyId, requestingUser, input.entityType, input.entityId);

  const { periods, periodValues } = await computeGoalLinePeriods(companyId, campaign, input);

  // Base de Sazonalidade Combinada ("Meses do Ano e Dias..."): decisão do
  // usuário (PASSO 6) — aplica a distribuição mensal E a diária na mesma
  // ação, sem precisar de um 2º passo manual (applyDailySeasonality).
  let combinedDailyBase: SeasonalityBaseWithWeights | null = null;
  let dailySeasonalityBaseId: string | null = null;
  if (input.seasonalityBaseId) {
    const seasonalityBase = await prisma.seasonalityBase.findFirst({
      where: { id: input.seasonalityBaseId, companyId },
      include: { weights: true },
    });
    if (seasonalityBase && isCombinedAnalysisType(seasonalityBase.analysisType as SupportedAnalysisType)) {
      combinedDailyBase = { analysisType: seasonalityBase.analysisType as SupportedAnalysisType, weights: seasonalityBase.weights };
      dailySeasonalityBaseId = input.seasonalityBaseId;
    }
  }

  const dailyValues = combinedDailyBase
    ? computeDailySeasonalityMap(
        periods.reduce((totals, period) => {
          const value = periodValues.get(period.sequenceIndex) ?? new Prisma.Decimal(0);
          const monthKey = monthKeyOf(period.days[0]);
          totals.set(monthKey, (totals.get(monthKey) ?? new Prisma.Decimal(0)).plus(value));
          return totals;
        }, new Map<string, Prisma.Decimal>()),
        combinedDailyBase,
      )
    : periodValuesToDaily(periods, periodValues);
  const ancestorIds = await resolveAncestorIds(companyId, input.entityType, input.entityId);

  const line = await withTenant(
    async (tx) => {
      const existing = await tx.goalLine.findFirst({
        where: {
          companyId,
          goalCampaignId,
          entityType: input.entityType,
          entityId: input.entityId,
          inactivatedAt: null,
        },
      });

      const lineData = {
        ...ancestorIds,
        seasonalityBaseId: input.seasonalityBaseId,
        // Só toca dailySeasonalityBaseId quando a Base Mensal é Combinada
        // (aplica os 2 campos juntos) — fora desse caso, preserva o que já
        // estava lá (ex.: sazonalidade diária aplicada à parte, 2º passo),
        // mesmo comportamento de sempre.
        ...(combinedDailyBase ? { dailySeasonalityBaseId } : {}),
        engineType: input.engineType,
        initialValue: input.initialValue,
        growthRate: input.growthRate,
        groupDiscountPercentage: null,
        isManualOverride: false,
        appliedAt: new Date(),
      };

      const line = existing
        ? await tx.goalLine.update({ where: { id: existing.id }, data: lineData })
        : await tx.goalLine.create({
            data: {
              companyId,
              goalCampaignId,
              entityType: input.entityType,
              entityId: input.entityId,
              ...lineData,
            },
          });

      await tx.goalDailyValue.deleteMany({ where: { goalLineId: line.id } });
      await tx.goalDailyValue.createMany({
        data: [...dailyValues.entries()].map(([dateKey, value]) => ({
          companyId,
          goalLineId: line.id,
          date: toDate(dateKey),
          value,
        })),
      });

      return line;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recomputeDependentGroupedLines(companyId, goalCampaignId, input.entityType, input.entityId);
  return line;
}

interface ManualGoalLineInput {
  entityType: OrgScopeType;
  entityId: string;
  dailyValues: { date: string; value: number }[];
}

// Motor MANUAL: sem fórmula — o Gestor informa (ou edita) valores diários
// diretamente. Também é o caminho usado para ajustes pontuais em linhas já
// calculadas por um motor automático (isManualOverride=true a partir daqui).
export async function saveManualGoalLine(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  input: ManualGoalLineInput,
) {
  await getCampaignOrThrow(companyId, goalCampaignId);
  await assertEntityBelongsToCompany(companyId, input.entityType, input.entityId);
  await assertNodeWithinEditableScope(companyId, requestingUser, input.entityType, input.entityId);

  if (input.dailyValues.length === 0) {
    throw new ConflictError("Informe ao menos um valor diário.");
  }

  const ancestorIds = await resolveAncestorIds(companyId, input.entityType, input.entityId);

  const line = await withTenant(async (tx) => {
    const existing = await tx.goalLine.findFirst({
      where: {
        companyId,
        goalCampaignId,
        entityType: input.entityType,
        entityId: input.entityId,
        inactivatedAt: null,
      },
    });

    const lineData = {
      ...ancestorIds,
      engineType: "MANUAL" as const,
      isManualOverride: true,
      appliedAt: new Date(),
      seasonalityBaseId: null,
      initialValue: null,
      growthRate: null,
      groupDiscountPercentage: null,
    };

    const line = existing
      ? await tx.goalLine.update({ where: { id: existing.id }, data: lineData })
      : await tx.goalLine.create({
          data: {
            companyId,
            goalCampaignId,
            entityType: input.entityType,
            entityId: input.entityId,
            ...lineData,
          },
        });

    // Substitui em bloco (delete + createMany) em vez de upsert item a item:
    // uma linha manual cobrindo um ano inteiro tem ~365 valores diários, e
    // 365 upserts sequenciais (cada um um round-trip à rede, banco remoto)
    // estoura o timeout padrão da transaction interativa do Prisma (5s),
    // derrubando a transação no meio ("Transaction not found... old closed
    // transaction") — reproduzido com uma Linha Manual de ano inteiro. Só
    // as datas presentes em input.dailyValues são substituídas; datas fora
    // dessa lista (ex: meses deixados em branco no formulário) continuam
    // intactas, preservando o comportamento de "ajuste pontual" do motor
    // Manual.
    await tx.goalDailyValue.deleteMany({
      where: { goalLineId: line.id, date: { in: input.dailyValues.map((item) => toDate(item.date)) } },
    });
    await tx.goalDailyValue.createMany({
      data: input.dailyValues.map((item) => ({ companyId, goalLineId: line.id, date: toDate(item.date), value: item.value })),
    });

    return line;
  });

  await recomputeDependentGroupedLines(companyId, goalCampaignId, input.entityType, input.entityId);
  return line;
}

interface VisibilityIdSets {
  memberIds: Set<string>;
  teamIds: Set<string>;
  departmentIds: Set<string>;
  channelIds: Set<string>;
}

// Resolve o escopo visível do requisitante em Sets de ids por nível
// (Membro/Time/Departamento/Canal) — base compartilhada por
// buildGoalLineVisibilityFilter (filtra Linhas) e
// buildGoalCampaignVisibilityFilter (filtra Campanhas via "tem ao menos 1
// Linha visível"). "ALL" é o atalho de Admin/escopo irrestrito.
//
// PASSO 11.2: teamIds/departmentIds/channelIds vêm de resolveVisibleNodeIds
// (scope.util.ts, mesma infra líder-aware do PASSO 9.1) — que devolve só o(s)
// nó(s) atribuído(s) + DESCENDENTES. Antes, esses Sets eram montados subindo
// a ancestralidade dos Membros permitidos (member.team.departmentId/
// channelId), o que vazava Linhas de nível Departamento/Canal inteiras para
// quem só tinha atribuição em um Time abaixo deles — um Gestor de Time via
// Linhas de TODO o Departamento/Canal, agregando outros Times que ele nem
// deveria enxergar. resolveVisibleMemberFilter e resolveVisibleNodeIds usam
// exatamente a mesma condição para o atalho "ALL" (qualquer atribuição
// EMPRESA) — confirmado em scope.util.ts — então, tendo já descartado
// memberFilter === "ALL" acima, resolveVisibleNodeIds aqui nunca devolve o
// sentinel "ALL" nos 3 campos, sempre Sets concretos.
async function resolveVisibilityIdSets(companyId: string, requestingUser: RequestingUser): Promise<VisibilityIdSets | "ALL"> {
  if (requestingUser.role === "ADMINISTRADOR") return "ALL";

  const memberFilter = await resolveVisibleMemberFilter(companyId, requestingUser);
  if (memberFilter === "ALL") return "ALL";

  const [allowedMembers, nodeIds] = await Promise.all([
    prisma.member.findMany({ where: { companyId, ...memberFilter }, select: { id: true } }),
    resolveVisibleNodeIds(companyId, requestingUser),
  ]);

  return {
    memberIds: new Set(allowedMembers.map((member) => member.id)),
    teamIds: nodeIds.teamIds as Set<string>,
    departmentIds: nodeIds.departmentIds as Set<string>,
    channelIds: nodeIds.channelIds as Set<string>,
  };
}

function entityVisibilityOr(sets: VisibilityIdSets) {
  return [
    { entityType: "EMPRESA" as const },
    { entityType: "MEMBRO" as const, memberId: { in: [...sets.memberIds] } },
    { entityType: "TIME" as const, teamId: { in: [...sets.teamIds] } },
    { entityType: "DEPARTAMENTO" as const, departmentId: { in: [...sets.departmentIds] } },
    { entityType: "CANAL" as const, channelId: { in: [...sets.channelIds] } },
  ];
}

// Filtra as Linhas de Meta visíveis para o requisitante, comparando as
// colunas de ancestralidade denormalizadas de GoalLine (memberId/teamId/
// departmentId/channelId) contra o escopo resolvido em scope.util.ts. Uma
// Linha de nível Time/Departamento/Canal só é visível se a própria Linha for
// o nó atribuído ao requisitante OU um descendente dele (PASSO 11.2) — nunca
// um ANCESTRAL (ex.: atribuição só no Time não deixa ver a Linha do
// Departamento/Canal acima, mesmo que o Time esteja "dentro" deles). Linhas
// de Empresa ficam sempre visíveis (contexto, não vazam valor por Membro).
async function buildGoalLineVisibilityFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.GoalLineWhereInput> {
  const sets = await resolveVisibilityIdSets(companyId, requestingUser);
  if (sets === "ALL") return {};
  return { OR: entityVisibilityOr(sets) };
}

// Uma Campanha é visível se tem pelo menos 1 Linha (ativa ou inativa)
// dentro do escopo do requisitante — mesmo com outras Linhas de fora do
// escopo dele na mesma Campanha (essas ficam de fora quando ele lista as
// Linhas, ver buildGoalLineVisibilityFilter/listGoalLines) — OU se foi ele
// mesmo quem criou a Campanha (PASSO 11.8: uma Campanha recém-criada, ainda
// sem nenhuma Linha, nunca satisfaria "some" — ficaria invisível pro próprio
// criador, travando-o de adicionar a primeira Linha).
async function buildGoalCampaignVisibilityFilter(
  companyId: string,
  requestingUser: RequestingUser,
): Promise<Prisma.GoalCampaignWhereInput> {
  const sets = await resolveVisibilityIdSets(companyId, requestingUser);
  if (sets === "ALL") return {};
  return { OR: [{ createdByUserId: requestingUser.id }, { lines: { some: { OR: entityVisibilityOr(sets) } } }] };
}

// Lista TODAS as linhas da entidade (ativas e inativas) — histórico
// completo, inclusive cadeias de recálculo. A UI mostra o status de cada
// uma ("Ativa" / "Inativa desde X") em vez de esconder as antigas.
// PASSO 9.7: devolve { lines, totalCount } em vez de só o array — totalCount
// não passa pelo filtro de visibilidade (conta TODAS as Linhas da Campanha),
// pro client montar o aviso "vendo X de Y Linhas de Meta" quando há Linhas
// fora do escopo do usuário escondidas da lista.
export async function listGoalLines(companyId: string, requestingUser: RequestingUser, goalCampaignId: string) {
  await getCampaignOrThrow(companyId, goalCampaignId);
  const visibilityFilter = await buildGoalLineVisibilityFilter(companyId, requestingUser);

  const [lines, totalCount] = await Promise.all([
    prisma.goalLine.findMany({
      where: { companyId, goalCampaignId, ...visibilityFilter },
      include: {
        dailyValues: true,
        seasonalityBase: { select: { id: true, name: true } },
        dailySeasonalityBase: { select: { id: true, name: true } },
      },
      orderBy: [{ entityId: "asc" }, { createdAt: "asc" }],
    }),
    prisma.goalLine.count({ where: { companyId, goalCampaignId } }),
  ]);

  const rows = await Promise.all(
    lines.map(async (line) => {
      const daily: DailyMap = new Map();
      for (const dailyValue of line.dailyValues) {
        daily.set(isoKey(dailyValue.date), dailyValue.value);
      }

      const [row, canEdit] = await Promise.all([
        Promise.resolve(
          buildGoalLineRow({
            id: line.id,
            entityType: line.entityType,
            entityId: line.entityId,
            entityName: await resolveEntityName(companyId, line.entityType, line.entityId),
            engineType: line.engineType,
            seasonalityBaseId: line.seasonalityBaseId,
            seasonalityBaseName: line.seasonalityBase?.name ?? null,
            dailySeasonalityBaseId: line.dailySeasonalityBaseId,
            dailySeasonalityBaseName: line.dailySeasonalityBase?.name ?? null,
            initialAmount: await computeInitialAmount(companyId, line),
            growthRate: line.growthRate,
            isManualOverride: line.isManualOverride,
            groupDiscountPercentage: line.groupDiscountPercentage,
            grossTotal: null,
            appliedAt: line.appliedAt,
            inactivatedAt: line.inactivatedAt,
            isRecalculated: line.recalculatedFromLineId !== null,
            channelId: line.channelId,
            departmentId: line.departmentId,
            teamId: line.teamId,
            hierarchyPath: await buildHierarchyPath(companyId, line.entityType, line),
            daily,
          }),
        ),
        isNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId),
      ]);

      return { ...row, canEdit };
    }),
  );

  return { lines: rows, totalCount };
}

// Bloqueia a exclusão se a entidade desta linha é origem configurada de
// alguma Linha Agrupada nesta campanha — evita apagar uma fonte que uma
// Agrupada depende sem querer.
export async function deleteGoalLine(companyId: string, requestingUser: RequestingUser, id: string) {
  const line = await prisma.goalLine.findFirst({ where: { id, companyId } });

  if (!line) {
    throw new NotFoundError("Linha de Meta não encontrada");
  }

  await assertNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId);

  const usedAsSource = await prisma.goalLineGroupSource.findFirst({
    where: {
      companyId,
      sourceEntityType: line.entityType,
      sourceEntityId: line.entityId,
      goalLine: { goalCampaignId: line.goalCampaignId },
    },
  });

  if (usedAsSource) {
    throw new ConflictError("Não é possível excluir: esta entidade é origem de uma ou mais Linhas Agrupadas nesta campanha.");
  }

  await withTenant(async (tx) => {
    await tx.goalLineGroupSource.deleteMany({ where: { goalLineId: id } });
    await tx.goalDailyValue.deleteMany({ where: { goalLineId: id } });
    await tx.goalLine.delete({ where: { id } });
  });
}

// Ativar/Desativar uma Linha com data efetiva — mesma semântica da
// campanha: null reativa incondicionalmente; uma data marca "Inativa desde
// X" (some da composição de Recebíveis a partir dali). Dispara recálculo em
// cascata: uma Linha Agrupada que dependa desta entidade passa a somar 0
// para ela enquanto estiver inativa, e volta a contar ao reativar.
export async function setGoalLineActiveStatus(
  companyId: string,
  requestingUser: RequestingUser,
  id: string,
  effectiveDate: string | null,
) {
  const line = await prisma.goalLine.findFirst({ where: { id, companyId } });

  if (!line) {
    throw new NotFoundError("Linha de Meta não encontrada");
  }

  await assertNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId);

  const updated = await writeWithTenant((tx) =>
    tx.goalLine.update({
      where: { id },
      data: { inactivatedAt: effectiveDate ? toDate(effectiveDate) : null },
    }),
  );

  await recomputeDependentGroupedLines(companyId, updated.goalCampaignId, updated.entityType, updated.entityId);
  return updated;
}

// Soma o Resultado (Resultados regulares + Ajustes) desta entidade, no
// escopo da campanha (Tipo de Resultado + Nível Base), num período
// histórico livre — usado para sugerir o Valor Inicial de uma Linha de
// Meta nova a partir do que a entidade já vendeu antes.
export async function getHistoricalResultValue(
  companyId: string,
  goalCampaignId: string,
  entityType: OrgScopeType,
  entityId: string,
  startDateStr: string,
  endDateStr: string,
): Promise<Prisma.Decimal> {
  const campaign = await getCampaignOrThrow(companyId, goalCampaignId);
  await assertEntityBelongsToCompany(companyId, entityType, entityId);

  const startDate = toDate(startDateStr);
  const endDate = toDate(endDateStr);
  assertValidPeriod(startDate, endDate);

  const memberFilter = buildMemberScopeFilter(entityType, entityId);

  const [entriesAgg, adjustmentsAgg] = await Promise.all([
    prisma.resultEntry.aggregate({
      where: { companyId, typeId: campaign.resultTypeId, date: { gte: startDate, lte: endDate }, member: memberFilter },
      _sum: { value: true },
    }),
    prisma.operationalAdjustment.aggregate({
      where: {
        companyId,
        typeId: campaign.resultTypeId,
        dateReference: { gte: startDate, lte: endDate },
        member: memberFilter,
      },
      _sum: { value: true },
    }),
  ]);

  return (entriesAgg._sum.value ?? new Prisma.Decimal(0)).plus(adjustmentsAgg._sum.value ?? new Prisma.Decimal(0));
}

export interface PreviousPeriodMonthlyValue {
  period: number;
  key: string;
  value: Prisma.Decimal;
}

function shiftYearUtc(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

// Botão "Puxar Período Anterior" do motor Manual (Metas §4): para cada mês
// do período DA CAMPANHA ATUAL, soma o Realizado (Resultados + Ajustes) do
// mesmo mês exatamente um ano antes — ex. campanha 01/01/2026-31/12/2026
// puxa 01/01/2025-31/12/2025, mês a mês. Só sugere valores (a tela continua
// editável antes de Aplicar); não persiste nada sozinha.
export async function getPreviousPeriodMonthlyValues(
  companyId: string,
  goalCampaignId: string,
  entityType: OrgScopeType,
  entityId: string,
): Promise<PreviousPeriodMonthlyValue[]> {
  const campaign = await getCampaignOrThrow(companyId, goalCampaignId);
  await assertEntityBelongsToCompany(companyId, entityType, entityId);

  const periods = buildMonthlyPeriods(campaign.startDate, campaign.endDate);
  const memberFilter = buildMemberScopeFilter(entityType, entityId);

  return Promise.all(
    periods.map(async (period) => {
      const firstDay = period.days[0];
      const key = firstDay ? `${firstDay.getUTCFullYear()}-${String(firstDay.getUTCMonth() + 1).padStart(2, "0")}` : "";

      if (!firstDay) {
        return { period: period.sequenceIndex, key, value: new Prisma.Decimal(0) };
      }

      const shiftedStart = shiftYearUtc(firstDay, -1);
      const shiftedEnd = shiftYearUtc(period.days[period.days.length - 1], -1);

      const [entriesAgg, adjustmentsAgg] = await Promise.all([
        prisma.resultEntry.aggregate({
          where: { companyId, typeId: campaign.resultTypeId, date: { gte: shiftedStart, lte: shiftedEnd }, member: memberFilter },
          _sum: { value: true },
        }),
        prisma.operationalAdjustment.aggregate({
          where: {
            companyId,
            typeId: campaign.resultTypeId,
            dateReference: { gte: shiftedStart, lte: shiftedEnd },
            member: memberFilter,
          },
          _sum: { value: true },
        }),
      ]);

      const value = (entriesAgg._sum.value ?? new Prisma.Decimal(0)).plus(adjustmentsAgg._sum.value ?? new Prisma.Decimal(0));
      return { period: period.sequenceIndex, key, value };
    }),
  );
}

// Fallback de Valor Inicial para linhas sem um V.I.A. declarado (motor
// MANUAL, ou uma futura Linha Recalculada): usa o valor do primeiro mês da
// própria curva como referência de partida.
function firstMonthValueOf(daily: DailyMap): Prisma.Decimal {
  const monthly = groupDailyMapBy(daily, monthKeyOf);
  return monthly[0]?.value ?? new Prisma.Decimal(0);
}

export interface GoalLineSummary {
  total: Prisma.Decimal;
  monthly: PeriodTotal[];
  weekly: PeriodTotal[];
  quarterly: PeriodTotal[];
}

export function summarizeDailyMap(daily: DailyMap): GoalLineSummary {
  const monthly = groupDailyMapBy(daily, monthKeyOf);
  const weekly = groupDailyMapBy(daily, isoWeekKey);
  const quarterly = groupDailyMapBy(daily, quarterKeyOf);
  const total = monthly.reduce((acc, m) => acc.plus(m.value), new Prisma.Decimal(0));

  return { total, monthly, weekly, quarterly };
}

interface GoalLineRowInput {
  id: string;
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  engineType: GoalEngineType;
  seasonalityBaseId: string | null;
  seasonalityBaseName: string | null;
  dailySeasonalityBaseId: string | null;
  dailySeasonalityBaseName: string | null;
  // Valor Inicial: para os motores automáticos/Manual, o valor informado
  // (ou o 1º mês da curva). Para Agrupamento, é a soma dos Valores Iniciais
  // das origens, SEM deságio — calculado por computeInitialAmount.
  initialAmount: Prisma.Decimal;
  growthRate: Prisma.Decimal | null;
  isManualOverride: boolean;
  // Só preenchido quando engineType=AGRUPAMENTO (deságio sobre a soma das
  // Linhas de origem).
  groupDiscountPercentage: Prisma.Decimal | null;
  // Soma bruta das origens ANTES do Deságio — só computado para
  // engineType=AGRUPAMENTO (ver getGoalLineDetail); null nos demais.
  grossTotal: Prisma.Decimal | null;
  appliedAt: Date | null;
  inactivatedAt: Date | null;
  isRecalculated: boolean;
  // Ancestralidade denormalizada (ver GoalLine no schema) — usada pelo
  // client para filtrar Linhas por Canal/Departamento/Time.
  channelId: string | null;
  departmentId: string | null;
  teamId: string | null;
  // Caminho hierárquico legível, do nível imediatamente acima até o Canal
  // (ex: "Hospitalar>Atacado" para uma Linha de Time) — null para Canal/
  // Empresa, que não têm ancestral acima a mostrar.
  hierarchyPath: string | null;
  daily: DailyMap;
}

// Resumo de uma Linha a partir do seu mapa diário final e do seu Valor
// Inicial — usado tanto na listagem quanto na tela de detalhe. Valor Final
// = total do período (já reflete o crescimento aplicado pelo motor, ou a
// soma líquida das origens, no caso de Agrupamento). Crescimento no
// Período = Valor Final / Valor Inicial - 1. Média Mensal = Valor Final /
// número de meses do período.
export function buildGoalLineRow(input: GoalLineRowInput) {
  const { daily, initialAmount, ...rest } = input;
  const summary = summarizeDailyMap(daily);
  const finalAmount = summary.total;
  const monthCount = summary.monthly.length;
  const averageMonthly = monthCount > 0 ? finalAmount.dividedBy(monthCount) : new Prisma.Decimal(0);
  const growthInPeriod = initialAmount.isZero() ? null : finalAmount.dividedBy(initialAmount).minus(1);

  return { ...rest, ...summary, initialAmount, finalAmount, averageMonthly, growthInPeriod };
}

// resolveAncestorIds/AncestorIds vivem em scope.util.ts (para quebrar um
// ciclo de import: scope.util.ts também precisa desta função para resolver
// o teto de UserPermissionSettings.metasVisibilityScope) — reimportados
// acima e reexportados aqui para não obrigar fechamento.service.ts/
// bases-recebiveis.service.ts a mudar o import.
export type { AncestorIds };
export { resolveAncestorIds };

// Caminho hierárquico legível a partir das colunas de ancestralidade já
// resolvidas (não sobe a árvore de novo — reaproveita o que resolveAncestorIds
// já gravou na Linha): do nível imediatamente acima da entidade até o Canal,
// nomes separados por ">" (ex: "Hospitalar>Atacado" para uma Linha de Time).
// null para Canal/Empresa (nada acima a mostrar). Membro sem Time é
// posicionado pelo nó que lidera (ver resolveAncestorIds), gerando um
// caminho PARCIAL — só cai em "Time Gestão" quem não tem Time nem
// liderança nenhuma.
export async function buildHierarchyPath(
  companyId: string,
  entityType: OrgScopeType,
  ancestry: { channelId: string | null; departmentId: string | null; teamId: string | null },
): Promise<string | null> {
  const parts: string[] = [];

  // Membro sem Time não é "sem hierarquia": se ele lidera um nó,
  // resolveAncestorIds já preencheu a ancestralidade a partir do nó
  // liderado (caminho parcial — um Líder de Departamento tem
  // Canal>Departamento, sem Time). Só rotulamos "Time Gestão" quando não
  // há nível nenhum preenchido, ou seja, quando de fato não há como
  // posicionar o Membro na árvore.
  if (entityType === "MEMBRO") {
    if (ancestry.teamId) {
      parts.push(await resolveEntityName(companyId, "TIME", ancestry.teamId));
    } else if (!ancestry.departmentId && !ancestry.channelId) {
      parts.push("Time Gestão");
    }
  }
  if ((entityType === "MEMBRO" || entityType === "TIME") && ancestry.departmentId) {
    parts.push(await resolveEntityName(companyId, "DEPARTAMENTO", ancestry.departmentId));
  }
  if (entityType !== "CANAL" && entityType !== "EMPRESA" && ancestry.channelId) {
    parts.push(await resolveEntityName(companyId, "CANAL", ancestry.channelId));
  }

  return parts.length > 0 ? parts.join(">") : null;
}

// ============================================================
// Motor de Agrupamento — soma explícita de outras Linhas, de QUALQUER
// campanha (desde que o Tipo de Resultado seja o mesmo), com Deságio
// opcional. Diferente dos demais motores, a Linha Agrupada permanece
// "viva": toda vez que uma Linha de origem muda (Aplicar, Recalcular,
// Desativar/Reativar, Excluir), o sistema recalcula e regrava
// automaticamente todas as Linhas Agrupadas que dependem dela — inclusive
// em cascata, se a Agrupada for por sua vez origem de outra Agrupada (ver
// recomputeDependentGroupedLines).
//
// Cada origem referencia a CAMPANHA + ENTIDADE (não um goalLineId
// congelado): assim, se a origem for recalculada (o que troca qual
// GoalLine.id está ativo) ou simplesmente reeditada, a Agrupada continua
// resolvendo "a Linha ativa atual daquela entidade, naquela campanha" sem
// precisar reconfigurar nada.
// ============================================================

export interface GroupSourceInput {
  goalCampaignId: string;
  entityType: OrgScopeType;
  entityId: string;
}

export interface GroupSourceInfo {
  goalCampaignId: string;
  campaignName: string;
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  currentTotal: Prisma.Decimal;
  hasActiveLine: boolean;
}

async function findActiveGoalLine(companyId: string, goalCampaignId: string, entityType: OrgScopeType, entityId: string) {
  return prisma.goalLine.findFirst({
    where: { companyId, goalCampaignId, entityType, entityId, inactivatedAt: null },
    include: { dailyValues: true },
  });
}

export async function dailyMapOfActiveLine(
  companyId: string,
  goalCampaignId: string,
  entityType: OrgScopeType,
  entityId: string,
): Promise<DailyMap> {
  const line = await findActiveGoalLine(companyId, goalCampaignId, entityType, entityId);
  const daily: DailyMap = new Map();
  if (!line) return daily;
  for (const dv of line.dailyValues) daily.set(isoKey(dv.date), dv.value);
  return daily;
}

async function describeGroupSources(companyId: string, goalLineId: string): Promise<GroupSourceInfo[]> {
  const sources = await prisma.goalLineGroupSource.findMany({ where: { companyId, goalLineId } });
  if (sources.length === 0) return [];

  const campaignIds = [...new Set(sources.map((s) => s.sourceGoalCampaignId))];
  const campaigns = await prisma.goalCampaign.findMany({ where: { companyId, id: { in: campaignIds } }, select: { id: true, name: true } });
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));

  return Promise.all(
    sources.map(async (source) => {
      const daily = await dailyMapOfActiveLine(companyId, source.sourceGoalCampaignId, source.sourceEntityType, source.sourceEntityId);
      const currentTotal = [...daily.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));
      return {
        goalCampaignId: source.sourceGoalCampaignId,
        campaignName: campaignNames.get(source.sourceGoalCampaignId) ?? "—",
        entityType: source.sourceEntityType,
        entityId: source.sourceEntityId,
        entityName: await resolveEntityName(companyId, source.sourceEntityType, source.sourceEntityId),
        currentTotal,
        hasActiveLine: daily.size > 0,
      };
    }),
  );
}

// PASSO 9.8: isolamento multi-tenant (CLAUDE.md/rule-auth-multitenancy) —
// cada fonte de Agrupamento precisa pertencer à MESMA empresa do
// requisitante, independente de hierarquia (a regra de negócio aqui é
// propositalmente livre de escopo — um Gestor pode agrupar Linhas de fora
// do que ele lidera — mas nunca de fora da empresa). Sem essa checagem,
// `assertSourcesShareResultType` simplesmente ignorava em silêncio uma
// `goalCampaignId`/`entityId` de outra empresa (a query já vinha filtrada
// por `companyId` e o loop só itera sobre o que encontrou) — nenhuma
// LEITURA de dado de outra empresa chegava a vazar (todo lookup downstream
// já era `companyId`-scoped), mas um id inválido/de outra empresa era
// aceito sem erro nenhum, contribuindo silenciosamente como fonte "vazia".
async function assertSourcesBelongToCompany(companyId: string, sources: GroupSourceInput[]): Promise<void> {
  const campaignIds = [...new Set(sources.map((s) => s.goalCampaignId))];
  const campaigns = await prisma.goalCampaign.findMany({ where: { companyId, id: { in: campaignIds } }, select: { id: true } });
  const validCampaignIds = new Set(campaigns.map((c) => c.id));

  for (const source of sources) {
    if (!validCampaignIds.has(source.goalCampaignId)) {
      throw new NotFoundError("Uma das Campanhas de origem selecionadas não foi encontrada.");
    }
    await assertEntityBelongsToCompany(companyId, source.entityType, source.entityId);
  }
}

// Garante que todas as origens propostas pertencem a campanhas com o MESMO
// Tipo de Resultado da campanha da própria Linha Agrupada — só assim a soma
// faz sentido.
async function assertSourcesShareResultType(
  companyId: string,
  targetGoalCampaignId: string,
  sources: GroupSourceInput[],
): Promise<void> {
  const targetCampaign = await getCampaignOrThrow(companyId, targetGoalCampaignId);
  const sourceCampaignIds = [...new Set(sources.map((s) => s.goalCampaignId))];

  const sourceCampaigns = await prisma.goalCampaign.findMany({
    where: { companyId, id: { in: sourceCampaignIds } },
  });

  for (const campaign of sourceCampaigns) {
    if (campaign.resultTypeId !== targetCampaign.resultTypeId) {
      throw new ConflictError(
        `A campanha "${campaign.name}" tem um Tipo de Resultado diferente da campanha desta Linha — só é possível agrupar Linhas do mesmo Tipo de Resultado.`,
      );
    }
  }
}

// Protege contra ciclos: se alguma origem proposta (transitivamente, subindo
// pelas próprias origens dela quando também for Agrupamento, em qualquer
// campanha) for a própria entidade-alvo, rejeita. `visited` evita loop
// infinito em caso de dado já inconsistente.
async function assertNoGroupCycle(
  companyId: string,
  targetGoalCampaignId: string,
  targetEntityType: OrgScopeType,
  targetEntityId: string,
  sources: GroupSourceInput[],
  visited: Set<string> = new Set(),
): Promise<void> {
  for (const source of sources) {
    if (
      source.goalCampaignId === targetGoalCampaignId &&
      source.entityType === targetEntityType &&
      source.entityId === targetEntityId
    ) {
      throw new ConflictError("Uma Linha Agrupada não pode ter a si mesma como origem.");
    }

    const key = `${source.goalCampaignId}:${source.entityType}:${source.entityId}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const sourceLine = await findActiveGoalLine(companyId, source.goalCampaignId, source.entityType, source.entityId);
    if (!sourceLine || sourceLine.engineType !== "AGRUPAMENTO") continue;

    const nestedSources = await prisma.goalLineGroupSource.findMany({
      where: { companyId, goalLineId: sourceLine.id },
      select: { sourceGoalCampaignId: true, sourceEntityType: true, sourceEntityId: true },
    });

    await assertNoGroupCycle(
      companyId,
      targetGoalCampaignId,
      targetEntityType,
      targetEntityId,
      nestedSources.map((s) => ({ goalCampaignId: s.sourceGoalCampaignId, entityType: s.sourceEntityType, entityId: s.sourceEntityId })),
      visited,
    );
  }
}

async function computeGroupedDailyMap(
  companyId: string,
  sources: GroupSourceInput[],
  discountPercentage: number,
): Promise<DailyMap> {
  let combined: DailyMap = new Map();

  for (const source of sources) {
    const daily = await dailyMapOfActiveLine(companyId, source.goalCampaignId, source.entityType, source.entityId);
    combined = addDailyMaps(combined, daily);
  }

  const factor = new Prisma.Decimal(1).minus(new Prisma.Decimal(discountPercentage).dividedBy(100));
  const net: DailyMap = new Map();
  for (const [day, value] of combined) net.set(day, value.times(factor));
  return net;
}

export interface GroupedGoalLineInput {
  entityType: OrgScopeType;
  entityId: string;
  sources: GroupSourceInput[];
  discountPercentage: number;
}

function assertValidGroupInput(input: GroupedGoalLineInput) {
  if (input.sources.length === 0) {
    throw new ConflictError("Selecione ao menos uma Linha de Meta para agrupar.");
  }
  if (input.discountPercentage < 0 || input.discountPercentage > 100) {
    throw new ConflictError("O Deságio deve estar entre 0% e 100%.");
  }
}

// Só calcula, não persiste — usado pelo botão "Calcular" antes de "Aplicar".
export async function previewGroupedGoalLine(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  input: GroupedGoalLineInput,
) {
  await getCampaignOrThrow(companyId, goalCampaignId);
  await assertNodeWithinEditableScope(companyId, requestingUser, input.entityType, input.entityId);
  assertValidGroupInput(input);
  await assertSourcesBelongToCompany(companyId, input.sources);
  await assertSourcesShareResultType(companyId, goalCampaignId, input.sources);
  await assertNoGroupCycle(companyId, goalCampaignId, input.entityType, input.entityId, input.sources);

  const daily = await computeGroupedDailyMap(companyId, input.sources, input.discountPercentage);
  const summary = summarizeDailyMap(daily);

  return {
    total: summary.total,
    periods: summary.monthly.map((m, index) => ({ period: index + 1, key: m.key, value: m.value })),
  };
}

// Cria OU edita a Linha Agrupada ATIVA desta entidade — mesma semântica de
// applyGoalLine/saveManualGoalLine (edição = mesma linha, curva substituída).
export async function applyGroupedGoalLine(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  input: GroupedGoalLineInput,
) {
  await getCampaignOrThrow(companyId, goalCampaignId);
  await assertEntityBelongsToCompany(companyId, input.entityType, input.entityId);
  await assertNodeWithinEditableScope(companyId, requestingUser, input.entityType, input.entityId);
  assertValidGroupInput(input);
  await assertSourcesBelongToCompany(companyId, input.sources);
  await assertSourcesShareResultType(companyId, goalCampaignId, input.sources);

  const uniqueSources = [
    ...new Map(input.sources.map((s) => [`${s.goalCampaignId}:${s.entityType}:${s.entityId}`, s])).values(),
  ];
  await assertNoGroupCycle(companyId, goalCampaignId, input.entityType, input.entityId, uniqueSources);

  const daily = await computeGroupedDailyMap(companyId, uniqueSources, input.discountPercentage);
  const ancestorIds = await resolveAncestorIds(companyId, input.entityType, input.entityId);

  const line = await withTenant(
    async (tx) => {
      const existing = await tx.goalLine.findFirst({
        where: {
          companyId,
          goalCampaignId,
          entityType: input.entityType,
          entityId: input.entityId,
          inactivatedAt: null,
        },
      });

      const lineData = {
        ...ancestorIds,
        engineType: "AGRUPAMENTO" as const,
        seasonalityBaseId: null,
        dailySeasonalityBaseId: null,
        initialValue: null,
        growthRate: null,
        groupDiscountPercentage: input.discountPercentage,
        isManualOverride: false,
        appliedAt: new Date(),
      };

      const goalLine = existing
        ? await tx.goalLine.update({ where: { id: existing.id }, data: lineData })
        : await tx.goalLine.create({
            data: { companyId, goalCampaignId, entityType: input.entityType, entityId: input.entityId, ...lineData },
          });

      await tx.goalLineGroupSource.deleteMany({ where: { goalLineId: goalLine.id } });
      await tx.goalLineGroupSource.createMany({
        data: uniqueSources.map((s) => ({
          companyId,
          goalLineId: goalLine.id,
          sourceGoalCampaignId: s.goalCampaignId,
          sourceEntityType: s.entityType,
          sourceEntityId: s.entityId,
        })),
      });

      await tx.goalDailyValue.deleteMany({ where: { goalLineId: goalLine.id } });
      await tx.goalDailyValue.createMany({
        data: [...daily.entries()].map(([dateKey, value]) => ({
          companyId,
          goalLineId: goalLine.id,
          date: toDate(dateKey),
          value,
        })),
      });

      return goalLine;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recomputeDependentGroupedLines(companyId, goalCampaignId, input.entityType, input.entityId);
  return line;
}

// Recalcula em cascata toda Linha Agrupada que depende (direta ou
// transitivamente, em QUALQUER campanha) da entidade cuja Linha ativa
// acabou de mudar — chamado ao final de toda operação que altera a Linha
// ativa de uma entidade (Aplicar, Manual, Recalcular, Desativar/Reativar, o
// próprio Agrupamento). `goalCampaignId` aqui é a campanha DESSA entidade
// (a que acabou de mudar), usada para casar com `sourceGoalCampaignId`.
export async function recomputeDependentGroupedLines(
  companyId: string,
  goalCampaignId: string,
  entityType: OrgScopeType,
  entityId: string,
  visited: Set<string> = new Set(),
): Promise<void> {
  const key = `${goalCampaignId}:${entityType}:${entityId}`;
  if (visited.has(key)) return;
  visited.add(key);

  const dependents = await prisma.goalLineGroupSource.findMany({
    where: {
      companyId,
      sourceGoalCampaignId: goalCampaignId,
      sourceEntityType: entityType,
      sourceEntityId: entityId,
    },
    select: { goalLineId: true },
  });

  for (const dependent of dependents) {
    const groupLine = await prisma.goalLine.findFirst({ where: { id: dependent.goalLineId, companyId } });
    if (!groupLine || groupLine.inactivatedAt) continue;

    const sources = await prisma.goalLineGroupSource.findMany({
      where: { companyId, goalLineId: groupLine.id },
      select: { sourceGoalCampaignId: true, sourceEntityType: true, sourceEntityId: true },
    });

    const daily = await computeGroupedDailyMap(
      companyId,
      sources.map((s) => ({ goalCampaignId: s.sourceGoalCampaignId, entityType: s.sourceEntityType, entityId: s.sourceEntityId })),
      groupLine.groupDiscountPercentage ? Number(groupLine.groupDiscountPercentage) : 0,
    );

    await withTenant(async (tx) => {
      await tx.goalDailyValue.deleteMany({ where: { goalLineId: groupLine.id } });
      await tx.goalDailyValue.createMany({
        data: [...daily.entries()].map(([dateKey, value]) => ({
          companyId,
          goalLineId: groupLine.id,
          date: toDate(dateKey),
          value,
        })),
      });
    });

    await recomputeDependentGroupedLines(companyId, groupLine.goalCampaignId, groupLine.entityType, groupLine.entityId, visited);
  }
}

// Valor Inicial de uma Linha Agrupada = soma dos Valores Iniciais das
// origens ATIVAS, SEM aplicar o Deságio (o Deságio só reduz o Valor Final,
// nunca a referência de base) — recursivo para origens que também sejam
// Agrupadas. Para os demais motores, é simplesmente o Valor Inicial
// informado (ou o 1º mês da curva, no caso Manual).
async function computeInitialAmount(companyId: string, line: { goalCampaignId: string; engineType: GoalEngineType; initialValue: Prisma.Decimal | null; id: string }): Promise<Prisma.Decimal> {
  if (line.engineType !== "AGRUPAMENTO") {
    if (line.initialValue !== null) return line.initialValue;
    const daily = await dailyMapOfActiveLineByLineId(companyId, line.id);
    return firstMonthValueOf(daily);
  }

  const sources = await prisma.goalLineGroupSource.findMany({ where: { companyId, goalLineId: line.id } });
  let total = new Prisma.Decimal(0);

  for (const source of sources) {
    const sourceLine = await findActiveGoalLine(companyId, source.sourceGoalCampaignId, source.sourceEntityType, source.sourceEntityId);
    if (!sourceLine) continue;
    total = total.plus(await computeInitialAmount(companyId, sourceLine));
  }

  return total;
}

async function dailyMapOfActiveLineByLineId(companyId: string, goalLineId: string): Promise<DailyMap> {
  const dailyValues = await prisma.goalDailyValue.findMany({ where: { companyId, goalLineId } });
  const daily: DailyMap = new Map();
  for (const dv of dailyValues) daily.set(isoKey(dv.date), dv.value);
  return daily;
}

export interface GoalLineDailyPoint {
  date: string;
  value: Prisma.Decimal;
}

// Detalhe completo de UMA Linha, com a série diária inteira — usado pela
// tela dedicada de cada Linha de Meta (gráficos Diário/Mensal/Trimestral/
// Acumulado). `lineId` de entrada é opcional: sem ele, busca a linha ATIVA
// da entidade; com ele, busca essa linha exata (ativa ou não — é como a UI
// abre uma linha inativa/histórica a partir da lista, que mostra todas as
// versões). Quando engineType=AGRUPAMENTO, inclui também `groupSources`
// (as origens configuradas + o valor atual de cada uma) para exibição.
export async function getGoalLineDetail(
  companyId: string,
  requestingUser: RequestingUser,
  goalCampaignId: string,
  entityType: OrgScopeType,
  entityId: string,
  lineId?: string,
) {
  await getCampaignOrThrow(companyId, goalCampaignId);
  await assertVisibleScope(companyId, requestingUser, [{ entityType, entityId }]);

  const line = await prisma.goalLine.findFirst({
    where: lineId
      ? { id: lineId, companyId, goalCampaignId, entityType, entityId }
      : { companyId, goalCampaignId, entityType, entityId, inactivatedAt: null },
    include: {
      dailyValues: true,
      seasonalityBase: { select: { id: true, name: true } },
      dailySeasonalityBase: { select: { id: true, name: true } },
    },
  });

  if (!line) {
    throw new NotFoundError("Linha de Meta não encontrada");
  }

  const daily: DailyMap = new Map();
  for (const dv of line.dailyValues) daily.set(isoKey(dv.date), dv.value);

  const groupSources = line.engineType === "AGRUPAMENTO" ? await describeGroupSources(companyId, line.id) : [];
  const grossTotal =
    line.engineType === "AGRUPAMENTO"
      ? groupSources.reduce((acc, s) => acc.plus(s.currentTotal), new Prisma.Decimal(0))
      : null;

  const row = buildGoalLineRow({
    id: line.id,
    entityType: line.entityType,
    entityId: line.entityId,
    entityName: await resolveEntityName(companyId, line.entityType, line.entityId),
    engineType: line.engineType,
    seasonalityBaseId: line.seasonalityBaseId,
    seasonalityBaseName: line.seasonalityBase?.name ?? null,
    dailySeasonalityBaseId: line.dailySeasonalityBaseId,
    dailySeasonalityBaseName: line.dailySeasonalityBase?.name ?? null,
    initialAmount: await computeInitialAmount(companyId, line),
    growthRate: line.growthRate,
    isManualOverride: line.isManualOverride,
    groupDiscountPercentage: line.groupDiscountPercentage,
    grossTotal,
    appliedAt: line.appliedAt,
    inactivatedAt: line.inactivatedAt,
    isRecalculated: line.recalculatedFromLineId !== null,
    channelId: line.channelId,
    departmentId: line.departmentId,
    teamId: line.teamId,
    hierarchyPath: await buildHierarchyPath(companyId, line.entityType, line),
    daily,
  });

  const dailyPoints: GoalLineDailyPoint[] = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  return { ...row, lineId: line.id, daily: dailyPoints, groupSources };
}

// ============================================================
// Sazonalidade Diária (opcional, aplicada depois do cálculo mensal)
//
// Redistribui o valor JÁ CALCULADO de cada mês entre os seus dias de forma
// não-uniforme, usando uma Base "Dias da Semana" ou "Dias do Mês" —
// renormalizada aos dias reais daquele mês (mesmo princípio do §2: o peso
// de cada dia é recalculado pela soma dos pesos só dos dias que existem
// naquele mês específico, para que a soma feche exatamente no valor do
// mês). Não recalcula a meta em si — só reparte o que já foi calculado.
// Passar null volta para a divisão igual padrão (distributeEvenly).
// ============================================================

interface SeasonalityBaseWithWeights {
  analysisType: SupportedAnalysisType;
  weights: { referenceMonth: number | null; referenceKey: number; weight: Prisma.Decimal }[];
}

// Extractor do balde diário conforme o tipo de análise — usado tanto pelo
// motor diário explícito (applyDailySeasonality) quanto pelo atalho "aplica
// os 2 campos de uma vez" de Base Combinada (applyGoalLine).
function resolveDailyKeyExtractor(analysisType: SupportedAnalysisType): (date: Date) => number {
  switch (analysisType) {
    case "DIAS_SEMANA":
    case "MESES_DIAS_SEMANA":
      return isoWeekday;
    case "DIAS_MES":
    case "MESES_DIAS_MES":
      return (date: Date) => date.getUTCDate();
    case "DIAS_ANO":
      return dayOfYear365;
    default:
      throw new ConflictError(
        'A sazonalidade diária exige uma Base do tipo "Dias da Semana", "Dias do Mês", "Dias do Ano" ou uma Combinada ("Meses do Ano e Dias...").',
      );
  }
}

// Mapa de peso por balde diário a usar num mês específico — tipos simples
// usam o mesmo mapa em todo mês; tipos Combinados usam só as células
// daquele referenceMonth (o resto da Base pertence a outros meses).
function resolveMonthDailyWeightMap(base: SeasonalityBaseWithWeights, monthNumber: number): Map<number, Prisma.Decimal> {
  const relevant = isCombinedAnalysisType(base.analysisType)
    ? base.weights.filter((w) => w.referenceMonth === monthNumber)
    : base.weights;
  return new Map(relevant.map((w) => [w.referenceKey, w.weight]));
}

// Redistribui totais mensais já fixados (monthlyTotals) entre os dias de
// cada mês — sem Base (null), divide igualmente (distributeEvenly); com
// Base, usa o peso por balde diário daquele mês, renormalizado dentro dele.
// Compartilhado por applyDailySeasonality (2º passo explícito) e
// applyGoalLine (Base Combinada aplica sazonalidade mensal + diária numa
// ação só — ver decisão registrada no .planosistemametas/PASSO 6).
function computeDailySeasonalityMap(
  monthlyTotals: Map<string, Prisma.Decimal>,
  base: SeasonalityBaseWithWeights | null,
): DailyMap {
  const newDaily: DailyMap = new Map();

  if (!base) {
    for (const [monthKey, total] of monthlyTotals) {
      const [year, month] = monthKey.split("-").map(Number);
      for (const [key, value] of distributeEvenly(total, daysOfMonth(year, month))) {
        newDaily.set(key, value);
      }
    }
    return newDaily;
  }

  const keyExtractor = resolveDailyKeyExtractor(base.analysisType);

  for (const [monthKey, total] of monthlyTotals) {
    const [year, month] = monthKey.split("-").map(Number);
    const days = daysOfMonth(year, month);

    // Mês sem valor nenhum a distribuir (comum em Base Combinada quando o
    // mês não tinha histórico — já ficou com peso 0 lá no motor mensal) —
    // não há erro real aqui, cada dia simplesmente fica em 0, mesmo que a
    // Base não tenha nenhuma célula pra esse mês.
    if (total.isZero()) {
      for (const day of days) {
        newDaily.set(isoKey(day), new Prisma.Decimal(0));
      }
      continue;
    }

    const weightMap = resolveMonthDailyWeightMap(base, month);

    const dayWeights = days.map((day) => ({
      day,
      weight: weightMap.get(keyExtractor(day)) ?? new Prisma.Decimal(0),
    }));
    const totalWeight = dayWeights.reduce((acc, dw) => acc.plus(dw.weight), new Prisma.Decimal(0));

    if (totalWeight.isZero()) {
      throw new ConflictError(`A Base de Sazonalidade não cobre nenhum dia de ${monthKey}.`);
    }

    let running = new Prisma.Decimal(0);
    dayWeights.forEach((dw, index) => {
      const key = isoKey(dw.day);
      if (index === dayWeights.length - 1) {
        newDaily.set(key, total.minus(running));
      } else {
        const value = total.times(dw.weight).dividedBy(totalWeight).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
        newDaily.set(key, value);
        running = running.plus(value);
      }
    });
  }

  return newDaily;
}

export async function applyDailySeasonality(
  companyId: string,
  requestingUser: RequestingUser,
  goalLineId: string,
  dailySeasonalityBaseId: string | null,
) {
  const line = await prisma.goalLine.findFirst({
    where: { id: goalLineId, companyId },
    include: { dailyValues: true },
  });

  if (!line) {
    throw new NotFoundError("Linha de Meta não encontrada");
  }

  await assertNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId);

  if (line.engineType === "AGRUPAMENTO") {
    throw new ConflictError(
      "Uma Linha Agrupada não aceita Sazonalidade Diária própria — ela é recalculada por inteiro sempre que uma origem muda.",
    );
  }

  if (line.dailyValues.length === 0) {
    throw new ConflictError("Calcule a meta mensal antes de aplicar a sazonalidade diária.");
  }

  const monthlyTotals = new Map<string, Prisma.Decimal>();
  for (const dv of line.dailyValues) {
    const key = monthKeyOf(dv.date);
    monthlyTotals.set(key, (monthlyTotals.get(key) ?? new Prisma.Decimal(0)).plus(dv.value));
  }

  let dailyBase: SeasonalityBaseWithWeights | null = null;
  if (dailySeasonalityBaseId) {
    const found = await prisma.seasonalityBase.findFirst({
      where: { id: dailySeasonalityBaseId, companyId },
      include: { weights: true },
    });
    if (!found) {
      throw new NotFoundError("Base de Sazonalidade não encontrada");
    }
    dailyBase = { analysisType: found.analysisType as SupportedAnalysisType, weights: found.weights };
  }

  const newDaily = computeDailySeasonalityMap(monthlyTotals, dailyBase);

  await withTenant(async (tx) => {
    await tx.goalDailyValue.deleteMany({ where: { goalLineId: line.id } });
    await tx.goalDailyValue.createMany({
      data: [...newDaily.entries()].map(([dateKey, value]) => ({
        companyId,
        goalLineId: line.id,
        date: toDate(dateKey),
        value,
      })),
    });
    await tx.goalLine.update({ where: { id: line.id }, data: { dailySeasonalityBaseId } });
  });

  await recomputeDependentGroupedLines(companyId, line.goalCampaignId, line.entityType, line.entityId);
  return getGoalLineDetail(companyId, requestingUser, line.goalCampaignId, line.entityType, line.entityId, line.id);
}

// ============================================================
// Reforecast (skill doc §4) — somente cálculo/preview.
//
// Nota de escopo: o schema hoje guarda um único `value` por dia em
// GoalDailyValue (não existe uma coluna separada para "curva original" vs
// "curva recalculada"). Persistir o reforecast sobrescrevendo os dias
// futuros apagaria a curva original que o Painel de Reforecast (módulo de
// Acompanhamento, ainda não construído) precisa exibir lado a lado. Até essa
// necessidade ser resolvida no schema, este motor fica somente-leitura:
// devolve Saldo, Fator de Pressão e a nova curva, sem gravar nada. Sempre
// mensal, como todo o resto do motor.
// ============================================================

export interface ReforecastPeriod {
  period: number;
  value: Prisma.Decimal;
}

export interface ReforecastResult {
  annualTarget: Prisma.Decimal;
  realizedAccumulated: Prisma.Decimal;
  balance: Prisma.Decimal;
  remainingPeriods: number;
  pressureFactor: Prisma.Decimal;
  recalculatedPeriods: ReforecastPeriod[];
}

// Núcleo matemático do Reforecast (skill doc §4), isolado de qualquer acesso
// a banco para poder ser testado com casos numéricos diretos: Saldo = Meta
// do Período - Realizado; Sazonalidade Ajustada = Saz_t / Soma(Saz do bloco
// restante); Meta Recalculada_t = Saldo * Saz_adj_t; Fator de Pressão =
// (Saldo / N_restantes) / (Meta do Período / Total de Meses).
export function calculateReforecast(
  annualTarget: Prisma.Decimal,
  realizedAccumulated: Prisma.Decimal,
  weights: Map<number, Prisma.Decimal>,
  currentPeriod: number,
  totalPeriods: number,
): Omit<ReforecastResult, "annualTarget" | "realizedAccumulated"> {
  const balance = annualTarget.minus(realizedAccumulated);

  let remainingWeightSum = new Prisma.Decimal(0);
  for (let t = currentPeriod; t <= totalPeriods; t++) {
    remainingWeightSum = remainingWeightSum.plus(weights.get(t) ?? new Prisma.Decimal(0));
  }

  if (remainingWeightSum.isZero()) {
    throw new ConflictError("Não há período restante no ano para recalcular.");
  }

  const recalculatedPeriods: ReforecastPeriod[] = [];

  for (let t = currentPeriod; t <= totalPeriods; t++) {
    const sazAdjusted = (weights.get(t) ?? new Prisma.Decimal(0)).dividedBy(remainingWeightSum);
    recalculatedPeriods.push({ period: t, value: balance.times(sazAdjusted) });
  }

  const remainingPeriods = totalPeriods - currentPeriod + 1;
  const averageRemaining = balance.dividedBy(remainingPeriods);
  const averageOriginal = annualTarget.dividedBy(totalPeriods);
  const pressureFactor = averageOriginal.isZero()
    ? new Prisma.Decimal(0)
    : averageRemaining.dividedBy(averageOriginal);

  return { balance, remainingPeriods, pressureFactor, recalculatedPeriods };
}

export async function previewReforecast(
  companyId: string,
  requestingUser: RequestingUser,
  goalLineId: string,
  referenceDateStr: string,
): Promise<ReforecastResult> {
  const line = await prisma.goalLine.findFirst({
    where: { id: goalLineId, companyId },
    include: { goalCampaign: true, dailyValues: true },
  });

  if (!line) {
    throw new NotFoundError("Linha de Meta não encontrada");
  }

  await assertNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId);

  const referenceDate = toDate(referenceDateStr);

  if (referenceDate < line.goalCampaign.startDate) {
    throw new ConflictError("A Data de Referência não pode ser anterior ao início do período da meta.");
  }

  const periods = buildMonthlyPeriods(line.goalCampaign.startDate, line.goalCampaign.endDate);
  const seasonalityWeights = line.seasonalityBaseId
    ? await getSeasonalityWeights(companyId, line.seasonalityBaseId)
    : null;
  const periodWeights = resolvePeriodWeights(periods, seasonalityWeights);
  const weightMap = new Map(periodWeights.map((p) => [p.sequenceIndex, p.weight]));
  const totalPeriods = periods.length;

  const annualTarget = line.dailyValues.reduce((acc, dv) => acc.plus(dv.value), new Prisma.Decimal(0));

  const currentPeriod =
    periods.find((period) => period.days.length > 0 && period.days[period.days.length - 1] >= referenceDate)
      ?.sequenceIndex ?? totalPeriods + 1;

  const memberFilter = buildMemberScopeFilter(line.entityType, line.entityId);

  const [entriesAgg, adjustmentsAgg] = await Promise.all([
    prisma.resultEntry.aggregate({
      where: {
        companyId,
        typeId: line.goalCampaign.resultTypeId,
        date: { gte: line.goalCampaign.startDate, lt: referenceDate },
        member: memberFilter,
      },
      _sum: { value: true },
    }),
    prisma.operationalAdjustment.aggregate({
      where: {
        companyId,
        typeId: line.goalCampaign.resultTypeId,
        dateReference: { gte: line.goalCampaign.startDate, lt: referenceDate },
        member: memberFilter,
      },
      _sum: { value: true },
    }),
  ]);

  const realizedAccumulated = (entriesAgg._sum.value ?? new Prisma.Decimal(0)).plus(
    adjustmentsAgg._sum.value ?? new Prisma.Decimal(0),
  );

  const reforecast = calculateReforecast(annualTarget, realizedAccumulated, weightMap, currentPeriod, totalPeriods);

  return {
    annualTarget,
    realizedAccumulated,
    ...reforecast,
  };
}

// ============================================================
// Criar Meta Recalculada — aplica o Reforecast de verdade, como uma NOVA
// Linha (nunca sobrescreve a antiga):
//
// 1. A linha atual é desativada a partir da Data de Recálculo Inicial
//    (inactivatedAt = referenceDate) — sua curva original permanece
//    intacta no banco para sempre, como histórico.
// 2. Uma nova linha nasce cobrindo o período COMPLETO da campanha:
//    - Dias ANTES da Data de Recálculo: iguais ao REALIZADO de verdade
//      (Resultados + Ajustes) daqueles dias — ou seja, até essa data o
//      Atingimento fica 100% por definição, pois a meta retroativa "vira"
//      o que já foi vendido.
//    - Dias A PARTIR da Data de Recálculo: o Saldo restante redistribuído
//      pela sazonalidade ajustada (mesma matemática de calculateReforecast).
// ============================================================

function addDaysUtc(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount));
}

// Soma Resultados + Ajustes por dia (mapa denso: todo dia do intervalo tem
// uma entrada, mesmo que zero) — é o "passado 100% realizado" da nova linha.
async function getDenseDailyRealizedMap(
  companyId: string,
  typeId: string,
  memberFilter: Prisma.MemberWhereInput,
  startDate: Date,
  endDateExclusive: Date,
): Promise<DailyMap> {
  const [entries, adjustments] = await Promise.all([
    prisma.resultEntry.findMany({
      where: { companyId, typeId, date: { gte: startDate, lt: endDateExclusive }, member: memberFilter },
      select: { date: true, value: true },
    }),
    prisma.operationalAdjustment.findMany({
      where: { companyId, typeId, dateReference: { gte: startDate, lt: endDateExclusive }, member: memberFilter },
      select: { dateReference: true, value: true },
    }),
  ]);

  const sparse: DailyMap = new Map();
  for (const entry of entries) {
    const key = isoKey(entry.date);
    sparse.set(key, (sparse.get(key) ?? new Prisma.Decimal(0)).plus(entry.value));
  }
  for (const adjustment of adjustments) {
    const key = isoKey(adjustment.dateReference);
    sparse.set(key, (sparse.get(key) ?? new Prisma.Decimal(0)).plus(adjustment.value));
  }

  const dense: DailyMap = new Map();
  for (let day = startDate; day < endDateExclusive; day = addDaysUtc(day, 1)) {
    const key = isoKey(day);
    dense.set(key, sparse.get(key) ?? new Prisma.Decimal(0));
  }

  return dense;
}

export async function applyRecalculatedGoalLine(
  companyId: string,
  requestingUser: RequestingUser,
  goalLineId: string,
  referenceDateStr: string,
) {
  const line = await prisma.goalLine.findFirst({
    where: { id: goalLineId, companyId },
    include: { goalCampaign: true, dailyValues: true },
  });

  if (!line) {
    throw new NotFoundError("Linha de Meta não encontrada");
  }

  await assertNodeWithinEditableScope(companyId, requestingUser, line.entityType, line.entityId);

  if (line.inactivatedAt) {
    throw new ConflictError("Esta linha já está inativa — abra a linha recalculada que a substituiu.");
  }

  if (line.engineType === "AGRUPAMENTO") {
    throw new ConflictError("Uma Linha Agrupada não pode ser recalculada diretamente — ela já se atualiza sozinha a partir das origens.");
  }

  const referenceDate = toDate(referenceDateStr);

  if (referenceDate < line.goalCampaign.startDate) {
    throw new ConflictError("A Data de Recálculo não pode ser anterior ao início do período da meta.");
  }

  if (referenceDate > line.goalCampaign.endDate) {
    throw new ConflictError("A Data de Recálculo não pode ser posterior ao fim do período da meta.");
  }

  const periods = buildMonthlyPeriods(line.goalCampaign.startDate, line.goalCampaign.endDate);
  const seasonalityWeights = line.seasonalityBaseId
    ? await getSeasonalityWeights(companyId, line.seasonalityBaseId)
    : null;
  const periodWeights = resolvePeriodWeights(periods, seasonalityWeights);
  const weightMap = new Map(periodWeights.map((p) => [p.sequenceIndex, p.weight]));
  const totalPeriods = periods.length;

  const annualTarget = line.dailyValues.reduce((acc, dv) => acc.plus(dv.value), new Prisma.Decimal(0));

  const currentPeriod =
    periods.find((period) => period.days.length > 0 && period.days[period.days.length - 1] >= referenceDate)
      ?.sequenceIndex ?? totalPeriods + 1;

  const memberFilter = buildMemberScopeFilter(line.entityType, line.entityId);

  const [entriesAgg, adjustmentsAgg, realizedDaily] = await Promise.all([
    prisma.resultEntry.aggregate({
      where: {
        companyId,
        typeId: line.goalCampaign.resultTypeId,
        date: { gte: line.goalCampaign.startDate, lt: referenceDate },
        member: memberFilter,
      },
      _sum: { value: true },
    }),
    prisma.operationalAdjustment.aggregate({
      where: {
        companyId,
        typeId: line.goalCampaign.resultTypeId,
        dateReference: { gte: line.goalCampaign.startDate, lt: referenceDate },
        member: memberFilter,
      },
      _sum: { value: true },
    }),
    getDenseDailyRealizedMap(
      companyId,
      line.goalCampaign.resultTypeId,
      memberFilter,
      line.goalCampaign.startDate,
      referenceDate,
    ),
  ]);

  const realizedAccumulated = (entriesAgg._sum.value ?? new Prisma.Decimal(0)).plus(
    adjustmentsAgg._sum.value ?? new Prisma.Decimal(0),
  );

  const reforecast = calculateReforecast(annualTarget, realizedAccumulated, weightMap, currentPeriod, totalPeriods);

  const futurePeriods = periods.filter((period) => period.sequenceIndex >= currentPeriod);
  const futureValues = new Map(reforecast.recalculatedPeriods.map((p) => [p.period, p.value]));
  const futureDaily = periodValuesToDaily(futurePeriods, futureValues);

  const newDaily = addDailyMaps(realizedDaily, futureDaily);

  const newLine = await withTenant(async (tx) => {
    await tx.goalLine.update({ where: { id: line.id }, data: { inactivatedAt: referenceDate } });

    const created = await tx.goalLine.create({
      data: {
        companyId,
        goalCampaignId: line.goalCampaignId,
        entityType: line.entityType,
        entityId: line.entityId,
        // Mesma entidade da linha original — ancestralidade não muda,
        // reaproveita em vez de reconsultar.
        memberId: line.memberId,
        teamId: line.teamId,
        departmentId: line.departmentId,
        channelId: line.channelId,
        seasonalityBaseId: line.seasonalityBaseId,
        engineType: line.engineType,
        initialValue: null,
        growthRate: line.growthRate,
        isManualOverride: false,
        appliedAt: new Date(),
        recalculatedFromLineId: line.id,
      },
    });

    await tx.goalDailyValue.createMany({
      data: [...newDaily.entries()].map(([dateKey, value]) => ({
        companyId,
        goalLineId: created.id,
        date: toDate(dateKey),
        value,
      })),
    });

    return created;
  });

  await recomputeDependentGroupedLines(companyId, line.goalCampaignId, line.entityType, line.entityId);
  return getGoalLineDetail(companyId, requestingUser, line.goalCampaignId, line.entityType, line.entityId, newLine.id);
}

// ============================================================
// Minhas Metas — autoatendimento (qualquer papel), mesmo espírito de
// listMyReceivablesBases (bases-recebiveis.service.ts): as Linhas de Meta
// em nível MEMBRO do próprio usuário logado, em campanhas vigentes, com
// barras de progresso por período.
// ============================================================

const DAILY_RATIONALE_ANALYSIS_TYPES: SeasonalityAnalysisType[] = ["DIAS_ANO", "MESES_DIAS_SEMANA", "MESES_DIAS_MES"];

// Diário/Semanal só fazem sentido quando a Linha tem distribuição real por
// dia: overlay diário explícito (dailySeasonalityBaseId), OU a base
// principal já é por dia. Bases só Mensal/Trimestral (MESES_ANO/TRIMESTRES)
// e motores sem seasonalityBase (Manual/Agrupamento, seasonalityAnalysisType
// null) distribuem uniformemente dentro do mês — uma leitura diária/semanal
// aí não teria sentido, então a Linha começa direto do Mensal.
export function hasDailyRationale(
  dailySeasonalityBaseId: string | null,
  seasonalityAnalysisType: SeasonalityAnalysisType | null,
): boolean {
  if (dailySeasonalityBaseId !== null) return true;
  if (seasonalityAnalysisType === null) return false;
  return DAILY_RATIONALE_ANALYSIS_TYPES.includes(seasonalityAnalysisType);
}

export interface PeriodProgress {
  metaValue: string;
  realizadoValue: string;
  percentage: string | null;
}

// percentage = Realizado/Meta (fração, ex. 0.62 = 62%) — mesma convenção já
// usada em acompanhamento.service.ts (formatPercent no client multiplica
// por 100). null quando a Meta do período é zero (sem meta, não divisão por
// zero) — client mostra "sem meta neste período" em vez de uma barra.
export function buildPeriodProgress(metaValue: Prisma.Decimal, realizadoValue: Prisma.Decimal): PeriodProgress {
  const percentage = metaValue.isZero() ? null : realizadoValue.dividedBy(metaValue);
  return {
    metaValue: metaValue.toString(),
    realizadoValue: realizadoValue.toString(),
    percentage: percentage === null ? null : percentage.toString(),
  };
}

function findBucketValue(totals: PeriodTotal[], key: string): Prisma.Decimal {
  return totals.find((t) => t.key === key)?.value ?? new Prisma.Decimal(0);
}

function todayUtcDateOnly(referenceDate: Date): Date {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
}

export interface MyGoalLineSummary {
  goalLineId: string;
  goalCampaignId: string;
  campaignName: string;
  resultTypeName: string;
  resultTypeUnit: ResultUnit;
  hasDailyRationale: boolean;
  diario: PeriodProgress | null;
  semanal: PeriodProgress | null;
  mensal: PeriodProgress;
  trimestral: PeriodProgress;
  acumulado: PeriodProgress;
}

// "Vigente" = hoje dentro de [startDate, endDate] da campanha (literalmente
// em andamento agora), independente de status/inactivatedAt. "Participar" =
// mesma regra literal de listMyReceivablesBases: vínculo direto, sem
// hierarquia — GoalLine em nível MEMBRO cujo memberId (ancestralidade
// denormalizada) é o do próprio usuário, ativa (inactivatedAt null).
// Acumulado Total = Meta da campanha inteira vs Realizado do início da
// campanha até hoje.
export async function listMyGoalLines(
  companyId: string,
  requestingUser: RequestingUser,
  referenceDate: Date = new Date(),
): Promise<MyGoalLineSummary[]> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) return [];

  const today = todayUtcDateOnly(referenceDate);

  const campaigns = await prisma.goalCampaign.findMany({
    where: { companyId, startDate: { lte: today }, endDate: { gte: today } },
    include: { resultType: { select: { name: true, unit: true } } },
  });
  if (campaigns.length === 0) return [];

  const lines = await prisma.goalLine.findMany({
    where: {
      companyId,
      goalCampaignId: { in: campaigns.map((c) => c.id) },
      entityType: "MEMBRO",
      memberId,
      inactivatedAt: null,
    },
    include: {
      dailyValues: true,
      seasonalityBase: { select: { analysisType: true } },
    },
  });
  if (lines.length === 0) return [];

  const campaignsById = new Map(campaigns.map((c) => [c.id, c]));
  const todayKey = isoKey(today);
  const monthKey = monthKeyOf(today);
  const weekKey = isoWeekKey(today);
  const quarterKey = quarterKeyOf(today);
  const endExclusive = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));

  return Promise.all(
    lines.map(async (line) => {
      const campaign = campaignsById.get(line.goalCampaignId)!;

      const metaDaily: DailyMap = new Map();
      for (const dv of line.dailyValues) metaDaily.set(isoKey(dv.date), dv.value);

      const realizadoDaily = await getRealizadoDailyMap(
        companyId,
        campaign.resultTypeId,
        "MEMBRO",
        memberId,
        campaign.startDate,
        endExclusive,
      );

      const dailyRationale = hasDailyRationale(line.dailySeasonalityBaseId, line.seasonalityBase?.analysisType ?? null);

      const metaMonthly = groupDailyMapBy(metaDaily, monthKeyOf);
      const metaWeekly = groupDailyMapBy(metaDaily, isoWeekKey);
      const metaQuarterly = groupDailyMapBy(metaDaily, quarterKeyOf);
      const realizadoMonthly = groupDailyMapBy(realizadoDaily, monthKeyOf);
      const realizadoWeekly = groupDailyMapBy(realizadoDaily, isoWeekKey);
      const realizadoQuarterly = groupDailyMapBy(realizadoDaily, quarterKeyOf);

      const metaTotal = [...metaDaily.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));
      const realizadoTotal = [...realizadoDaily.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));

      return {
        goalLineId: line.id,
        goalCampaignId: campaign.id,
        campaignName: campaign.name,
        resultTypeName: campaign.resultType.name,
        resultTypeUnit: campaign.resultType.unit,
        hasDailyRationale: dailyRationale,
        diario: dailyRationale
          ? buildPeriodProgress(metaDaily.get(todayKey) ?? new Prisma.Decimal(0), realizadoDaily.get(todayKey) ?? new Prisma.Decimal(0))
          : null,
        semanal: dailyRationale
          ? buildPeriodProgress(findBucketValue(metaWeekly, weekKey), findBucketValue(realizadoWeekly, weekKey))
          : null,
        mensal: buildPeriodProgress(findBucketValue(metaMonthly, monthKey), findBucketValue(realizadoMonthly, monthKey)),
        trimestral: buildPeriodProgress(findBucketValue(metaQuarterly, quarterKey), findBucketValue(realizadoQuarterly, quarterKey)),
        acumulado: buildPeriodProgress(metaTotal, realizadoTotal),
      };
    }),
  );
}
