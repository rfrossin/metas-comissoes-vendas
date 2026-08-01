import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  addDailyMaps,
  buildGoalLineRow,
  buildMonthlyPeriods,
  buildPeriodProgress,
  calculateMcds,
  calculateMcdsQuarterlyByMonth,
  calculateReforecast,
  calculateTopDown,
  distributeEvenly,
  groupMonthsIntoQuarters,
  hasDailyRationale,
  periodValuesToDaily,
  resolvePeriodWeights,
  type DailyMap,
  type PeriodWeight,
} from "./metas.service";

function uniformSeasonalityWeights(periods: number): Map<number, Prisma.Decimal> {
  const weights = new Map<number, Prisma.Decimal>();
  const each = new Prisma.Decimal(1).dividedBy(periods);
  for (let t = 1; t <= periods; t++) weights.set(t, each);
  return weights;
}

function uniformPeriodWeights(periods: number): PeriodWeight[] {
  const each = new Prisma.Decimal(1).dividedBy(periods);
  return Array.from({ length: periods }, (_, i) => ({ sequenceIndex: i + 1, weight: each }));
}

function sum(values: Iterable<Prisma.Decimal>): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const v of values) total = total.plus(v);
  return total;
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("Motor Top-Down (Meta_t = M_alvo * Saz_t)", () => {
  it("distribui o valor alvo proporcionalmente à sazonalidade", () => {
    const via = new Prisma.Decimal(1200);
    const growthRate = new Prisma.Decimal(0.1);
    const periodWeights = uniformPeriodWeights(12);

    const { targetTotal, periodValues } = calculateTopDown(via, growthRate, periodWeights);

    expect(targetTotal.toNumber()).toBeCloseTo(1320, 6);
    for (let t = 1; t <= 12; t++) {
      expect(periodValues.get(t)!.toNumber()).toBeCloseTo(110, 6);
    }
    expect(sum(periodValues.values()).toNumber()).toBeCloseTo(1320, 6);
  });
});

describe("Motor MCDS Mensal (skill doc §3)", () => {
  it("com taxa de crescimento 0, se reduz a uma distribuição puramente sazonal do V.I.A.", () => {
    const via = new Prisma.Decimal(1200);
    const periodWeights = uniformPeriodWeights(12);

    const { poolTotal, periodValues } = calculateMcds(via, new Prisma.Decimal(0), periodWeights);

    expect(poolTotal.toNumber()).toBeCloseTo(1200, 6);
    for (let t = 1; t <= 12; t++) {
      expect(periodValues.get(t)!.toNumber()).toBeCloseTo(100, 6);
    }
  });

  it("acelera a curva com juros compostos preservando o total do pool", () => {
    const via = new Prisma.Decimal(1200);
    const periodWeights = uniformPeriodWeights(12);

    const { poolTotal, periodValues } = calculateMcds(via, new Prisma.Decimal(0.05), periodWeights);

    expect(periodValues.get(12)!.greaterThan(periodValues.get(1)!)).toBe(true);
    expect(sum(periodValues.values()).toNumber()).toBeCloseTo(poolTotal.toNumber(), 6);
  });
});

describe("Períodos mensais da campanha (Data Inicial/Final arbitrárias) — motor sempre mensal", () => {
  it("gera um balde por mês tocado, cortando os meses de borda pelo período", () => {
    const periods = buildMonthlyPeriods(utcDate("2026-01-15"), utcDate("2026-03-10"));

    expect(periods).toHaveLength(3);
    expect(periods[0].sequenceIndex).toBe(1);
    expect(periods[0].calendarKey).toBe(1); // janeiro
    expect(periods[0].days).toHaveLength(17); // 15 a 31/jan
    expect(periods[1].days).toHaveLength(28); // fevereiro inteiro
    expect(periods[2].calendarKey).toBe(3); // março
    expect(periods[2].days).toHaveLength(10); // 1 a 10/mar
  });

  it("ciclam a calendarKey corretamente para período fora do ano-calendário (abr/26 a mar/27)", () => {
    const periods = buildMonthlyPeriods(utcDate("2026-04-01"), utcDate("2027-03-31"));

    expect(periods).toHaveLength(12);
    expect(periods.map((p) => p.calendarKey)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]);
    expect(periods.map((p) => p.sequenceIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("Renormalização de sazonalidade para período parcial (< 1 ano)", () => {
  it("Julho (10% do ano cheio) vira 20% quando a campanha cobre só Julho-Dezembro (que somam 50% do ano)", () => {
    const fullYearWeights = new Map<number, Prisma.Decimal>();
    fullYearWeights.set(7, new Prisma.Decimal(0.1));
    for (const m of [8, 9, 10, 11, 12]) fullYearWeights.set(m, new Prisma.Decimal(0.08));
    for (const m of [1, 2, 3, 4, 5, 6]) fullYearWeights.set(m, new Prisma.Decimal(0.5).dividedBy(6));

    const periods = buildMonthlyPeriods(utcDate("2026-07-01"), utcDate("2026-12-31"));
    const weights = resolvePeriodWeights(periods, fullYearWeights);

    const julyWeight = weights.find((w) => w.sequenceIndex === 1)!.weight; // 1º mês do período = Julho
    expect(julyWeight.toNumber()).toBeCloseTo(0.2, 8);

    const total = weights.reduce((acc, w) => acc.plus(w.weight), new Prisma.Decimal(0));
    expect(total.toNumber()).toBeCloseTo(1, 8);
  });

  it("para um período de ano completo, a renormalização é a identidade (a soma já é 100%)", () => {
    const periods = buildMonthlyPeriods(utcDate("2026-01-01"), utcDate("2026-12-31"));
    const weights = resolvePeriodWeights(periods, uniformSeasonalityWeights(12));

    for (const w of weights) {
      expect(w.weight.toNumber()).toBeCloseTo(1 / 12, 8);
    }
  });

  it('modo "Sem Sazonalidade" dá peso igual a todos os meses do período, qualquer que seja a duração', () => {
    const periods = buildMonthlyPeriods(utcDate("2026-01-01"), utcDate("2026-04-30"));
    const weights = resolvePeriodWeights(periods, null);

    expect(weights).toHaveLength(4);
    for (const w of weights) {
      expect(w.weight.toNumber()).toBeCloseTo(0.25, 10);
    }
  });
});

describe("Motor Trimestral subdivide o resultado do trimestre pelos meses (motor sempre mensal)", () => {
  it("cresce por trimestre mas devolve valores por mês, sem perder nada na subdivisão", () => {
    const periods = buildMonthlyPeriods(utcDate("2026-01-01"), utcDate("2026-12-31"));
    const monthlyWeights = resolvePeriodWeights(periods, uniformSeasonalityWeights(12));
    const quarterGroups = groupMonthsIntoQuarters(periods);

    expect(quarterGroups).toHaveLength(4);
    expect(quarterGroups[0].monthSequenceIndexes).toEqual([1, 2, 3]);
    expect(quarterGroups[3].monthSequenceIndexes).toEqual([10, 11, 12]);

    const { poolTotal, periodValues } = calculateMcdsQuarterlyByMonth(
      new Prisma.Decimal(1200),
      new Prisma.Decimal(0.1),
      monthlyWeights,
      quarterGroups,
    );

    // com peso mensal uniforme, cada mês recebe exatamente 1/3 do seu trimestre.
    const q1Total = periodValues.get(1)!.plus(periodValues.get(2)!).plus(periodValues.get(3)!);
    expect(periodValues.get(1)!.toNumber()).toBeCloseTo(q1Total.dividedBy(3).toNumber(), 6);

    // juros compostos por trimestre: T4 vale mais que T1.
    const q4Total = periodValues.get(10)!.plus(periodValues.get(11)!).plus(periodValues.get(12)!);
    expect(q4Total.greaterThan(q1Total)).toBe(true);

    // nada se perde: soma de todos os meses = pool total do motor trimestral.
    const grandTotal = sum(periodValues.values());
    expect(grandTotal.toNumber()).toBeCloseTo(poolTotal.toNumber(), 6);
  });

  it("dentro do trimestre, o mês com maior sazonalidade recebe fatia maior do total do trimestre", () => {
    const periods = buildMonthlyPeriods(utcDate("2026-01-01"), utcDate("2026-03-31"));
    const seasonality = new Map<number, Prisma.Decimal>([
      [1, new Prisma.Decimal(0.5)],
      [2, new Prisma.Decimal(0.3)],
      [3, new Prisma.Decimal(0.2)],
    ]);

    const monthlyWeights = resolvePeriodWeights(periods, seasonality);
    const quarterGroups = groupMonthsIntoQuarters(periods);

    const { periodValues } = calculateMcdsQuarterlyByMonth(
      new Prisma.Decimal(300),
      new Prisma.Decimal(0),
      monthlyWeights,
      quarterGroups,
    );

    expect(periodValues.get(1)!.greaterThan(periodValues.get(2)!)).toBe(true);
    expect(periodValues.get(2)!.greaterThan(periodValues.get(3)!)).toBe(true);
    expect(sum(periodValues.values()).toNumber()).toBeCloseTo(300, 6);
  });
});

describe("Distribuição diária (Metas §7 — GoalDailyValue) — sempre dentro do mês", () => {
  it("distribui o valor do mês pelos dias sem sobra nem falta de centavos", () => {
    const periods = buildMonthlyPeriods(utcDate("2026-02-01"), utcDate("2026-02-28"));
    const distributed = distributeEvenly(new Prisma.Decimal(100), periods[0].days);
    const total = sum(distributed.values());

    expect(total.toNumber()).toBeCloseTo(100, 10);
    expect(distributed.get("2026-02-01")!.toNumber()).toBeCloseTo(100 / 28, 2);
  });

  it("a soma dos valores diários do período bate exatamente com o valor alvo (Top-Down)", () => {
    const startDate = utcDate("2026-01-01");
    const endDate = utcDate("2026-12-31");
    const periods = buildMonthlyPeriods(startDate, endDate);
    const periodWeights = resolvePeriodWeights(periods, uniformSeasonalityWeights(12));

    const { targetTotal, periodValues } = calculateTopDown(new Prisma.Decimal(1200), new Prisma.Decimal(0.1), periodWeights);
    const daily = periodValuesToDaily(periods, periodValues);
    const total = sum(daily.values());

    expect(total.toNumber()).toBeCloseTo(targetTotal.toNumber(), 6);
  });
});

describe("Reforecast (skill doc §4)", () => {
  it("mantém o ritmo original quando o realizado bate exatamente o plano (Fator de Pressão = 1.0)", () => {
    const weights = uniformSeasonalityWeights(12); // 100/mês num total de 1200
    const annualTarget = new Prisma.Decimal(1200);
    const realizedAccumulated = new Prisma.Decimal(300); // 3 meses no ritmo (jan-mar)

    const result = calculateReforecast(annualTarget, realizedAccumulated, weights, 4, 12);

    expect(result.balance.toNumber()).toBeCloseTo(900, 6);
    expect(result.remainingPeriods).toBe(9);
    expect(result.pressureFactor.toNumber()).toBeCloseTo(1, 6);
    for (const period of result.recalculatedPeriods) {
      expect(period.value.toNumber()).toBeCloseTo(100, 6);
    }
  });

  it("Fator de Pressão > 1 quando o time está atrasado em relação ao plano", () => {
    const weights = uniformSeasonalityWeights(12);
    const result = calculateReforecast(new Prisma.Decimal(1200), new Prisma.Decimal(200), weights, 4, 12);
    expect(result.pressureFactor.greaterThan(1)).toBe(true);
  });

  it("Fator de Pressão < 1 quando o time está adiantado em relação ao plano", () => {
    const weights = uniformSeasonalityWeights(12);
    const result = calculateReforecast(new Prisma.Decimal(1200), new Prisma.Decimal(400), weights, 4, 12);
    expect(result.pressureFactor.lessThan(1)).toBe(true);
  });

  it("preserva a sazonalidade relativa do bloco restante mesmo com pesos não uniformes", () => {
    const weights = new Map<number, Prisma.Decimal>();
    for (let t = 1; t <= 9; t++) weights.set(t, new Prisma.Decimal(0.06));
    weights.set(10, new Prisma.Decimal(0.14));
    weights.set(11, new Prisma.Decimal(0.14));
    weights.set(12, new Prisma.Decimal(0.14));

    const result = calculateReforecast(new Prisma.Decimal(10000), new Prisma.Decimal(4000), weights, 10, 12);

    const oct = result.recalculatedPeriods.find((p) => p.period === 10)!.value;
    const dec = result.recalculatedPeriods.find((p) => p.period === 12)!.value;
    expect(oct.toNumber()).toBeCloseTo(dec.toNumber(), 6);
    expect(sum(result.recalculatedPeriods.map((p) => p.value)).toNumber()).toBeCloseTo(
      result.balance.toNumber(),
      6,
    );
  });
});

function dailyMap(entries: Record<string, number>): DailyMap {
  return new Map(Object.entries(entries).map(([key, value]) => [key, new Prisma.Decimal(value)]));
}

describe("addDailyMaps", () => {
  it("soma os dois mapas dia a dia", () => {
    const a = dailyMap({ "2026-01-01": 3, "2026-01-02": 7 });
    const b = dailyMap({ "2026-01-01": 13, "2026-01-02": 7 });

    const result = addDailyMaps(a, b);

    expect(result.get("2026-01-01")!.toNumber()).toBe(16);
    expect(result.get("2026-01-02")!.toNumber()).toBe(14);
  });
});

function baseRowInput(daily: DailyMap, initialAmount: number) {
  return {
    id: "line-1",
    entityType: "MEMBRO" as const,
    entityId: "e1",
    entityName: "Teste",
    engineType: "VALOR_ALVO_ANUAL" as const,
    seasonalityBaseId: null,
    seasonalityBaseName: null,
    dailySeasonalityBaseId: null,
    dailySeasonalityBaseName: null,
    initialAmount: new Prisma.Decimal(initialAmount),
    growthRate: new Prisma.Decimal(0.1),
    isManualOverride: false,
    groupDiscountPercentage: null,
    grossTotal: null,
    appliedAt: null,
    inactivatedAt: null,
    isRecalculated: false,
    channelId: null,
    departmentId: null,
    teamId: null,
    hierarchyPath: null,
    daily,
  };
}

describe("Resumo da Linha (Valor Inicial, Valor Final, Crescimento, Média Mensal)", () => {
  it('Valor Final = total do período; "Crescimento no Período" = Valor Final / Valor Inicial - 1', () => {
    // Top-Down clássico: via=1000, growthRate=10% -> targetTotal=1100 (= soma dos meses = Valor Final).
    const daily = dailyMap({ "2026-01-15": 550, "2026-02-15": 550 });

    const row = buildGoalLineRow(baseRowInput(daily, 1000));

    expect(row.finalAmount.toNumber()).toBe(1100);
    expect(row.initialAmount.toNumber()).toBe(1000);
    expect(row.growthInPeriod!.toNumber()).toBeCloseTo(0.1, 6); // bate com o growthRate informado
  });

  it("Média Mensal = Valor Final / número de meses do período", () => {
    const daily = dailyMap({ "2026-01-15": 100, "2026-02-15": 150, "2026-03-15": 200 });

    const row = buildGoalLineRow(baseRowInput(daily, 100));

    expect(row.finalAmount.toNumber()).toBe(450);
    expect(row.monthly).toHaveLength(3);
    expect(row.averageMonthly.toNumber()).toBeCloseTo(150, 6);
  });

  it("Crescimento no Período é null quando o Valor Inicial é zero (evita divisão por zero)", () => {
    const daily = dailyMap({ "2026-01-15": 100 });
    const row = buildGoalLineRow(baseRowInput(daily, 0));
    expect(row.growthInPeriod).toBeNull();
  });
});

describe("hasDailyRationale (elegibilidade das barras Diária/Semanal de Minhas Metas)", () => {
  it("é true quando há overlay diário (dailySeasonalityBaseId), independente do tipo da base mensal", () => {
    expect(hasDailyRationale("overlay-id", "MESES_ANO")).toBe(true);
  });

  it("é true quando a base principal já é por dia (DIAS_ANO/MESES_DIAS_SEMANA/MESES_DIAS_MES)", () => {
    expect(hasDailyRationale(null, "DIAS_ANO")).toBe(true);
    expect(hasDailyRationale(null, "MESES_DIAS_SEMANA")).toBe(true);
    expect(hasDailyRationale(null, "MESES_DIAS_MES")).toBe(true);
  });

  it("é false para bases só Mensal/Trimestral sem overlay", () => {
    expect(hasDailyRationale(null, "MESES_ANO")).toBe(false);
    expect(hasDailyRationale(null, "TRIMESTRES")).toBe(false);
  });

  it("é false sem nenhuma base de sazonalidade (motor Manual/Agrupamento)", () => {
    expect(hasDailyRationale(null, null)).toBe(false);
  });
});

describe("buildPeriodProgress (barra de progresso de um período de Minhas Metas)", () => {
  it("calcula o percentual como Realizado/Meta", () => {
    const progress = buildPeriodProgress(new Prisma.Decimal(200), new Prisma.Decimal(124));
    expect(progress.metaValue).toBe("200");
    expect(progress.realizadoValue).toBe("124");
    expect(Number(progress.percentage)).toBeCloseTo(0.62, 6);
  });

  it("percentual pode passar de 1 (meta superada) sem ser capado no service", () => {
    const progress = buildPeriodProgress(new Prisma.Decimal(100), new Prisma.Decimal(150));
    expect(Number(progress.percentage)).toBeCloseTo(1.5, 6);
  });

  it("devolve percentage null quando a meta do período é zero (sem meta, não divisão por zero)", () => {
    const progress = buildPeriodProgress(new Prisma.Decimal(0), new Prisma.Decimal(50));
    expect(progress.percentage).toBeNull();
    expect(progress.metaValue).toBe("0");
    expect(progress.realizadoValue).toBe("50");
  });
});
