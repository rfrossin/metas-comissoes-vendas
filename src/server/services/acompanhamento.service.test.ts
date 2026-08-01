import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  buildBucketRows,
  buildComparativoPoints,
  buildCumulativeSeries,
  buildRecalculatedSeries,
  computeValorCobertura,
  cumulativeSum,
  monthWindow,
  safeDivide,
  sumDailyMapUpTo,
  totalMonthsInPeriod,
} from "./acompanhamento.service";
import type { DailyMap, PeriodTotal } from "./metas.service";

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function periods(pairs: [string, number][]): PeriodTotal[] {
  return pairs.map(([key, value]) => ({ key, value: d(value) }));
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("safeDivide", () => {
  it("divide normalmente quando o denominador não é zero", () => {
    expect(safeDivide(d(50), d(200))!.toNumber()).toBeCloseTo(0.25, 6);
  });

  it("retorna null em vez de dividir por zero", () => {
    expect(safeDivide(d(50), d(0))).toBeNull();
  });

  it("aceita numerador negativo (deságio superando a venda)", () => {
    expect(safeDivide(d(-50), d(200))!.toNumber()).toBeCloseTo(-0.25, 6);
  });
});

describe("computeValorCobertura", () => {
  it("positivo quando o Realizado Corrido está à frente da Meta Acumulada", () => {
    expect(computeValorCobertura(d(1200), d(1000)).toNumber()).toBeCloseTo(200, 6);
  });

  it("negativo quando está devendo meta", () => {
    expect(computeValorCobertura(d(800), d(1000)).toNumber()).toBeCloseTo(-200, 6);
  });
});

describe("cumulativeSum", () => {
  it("acumula em ordem, cada ponto é a soma corrida até ali", () => {
    const result = cumulativeSum(periods([["2026-01", 100], ["2026-02", 150], ["2026-03", 50]]));
    expect(result.map((p) => p.value.toNumber())).toEqual([100, 250, 300]);
  });
});

describe("buildBucketRows (linhas 4/7/8 da tabela de granularidade)", () => {
  it("calcula % da Meta do Período, % Realizado do Esperado e % Realizado da Meta Total mês a mês", () => {
    const realizado = periods([["2026-01", 100], ["2026-02", 300], ["2026-03", 200]]);
    const meta = periods([["2026-01", 200], ["2026-02", 200], ["2026-03", 200]]);

    const rows = buildBucketRows(realizado, meta);

    expect(rows).toHaveLength(3);

    // linha 4: % da Meta do Período = realizado do balde / meta do balde
    expect(rows[0].percentMetaPeriodo!.toNumber()).toBeCloseTo(0.5, 6); // 100/200
    expect(rows[1].percentMetaPeriodo!.toNumber()).toBeCloseTo(1.5, 6); // 300/200

    // linhas 5/6: acumulado corrido
    expect(rows[2].realizadoAcumulado.toNumber()).toBeCloseTo(600, 6); // 100+300+200
    expect(rows[2].metaAcumulada.toNumber()).toBeCloseTo(600, 6);

    // linha 7: % Realizado do Esperado (ritmo) = realizado acumulado / meta acumulada
    expect(rows[0].percentRealizadoEsperado!.toNumber()).toBeCloseTo(0.5, 6); // 100/200
    expect(rows[1].percentRealizadoEsperado!.toNumber()).toBeCloseTo(400 / 400, 6); // 400/400

    // linha 8: % Realizado da Meta Total = realizado acumulado / meta TOTAL do período (600)
    expect(rows[0].percentRealizadoMetaTotal!.toNumber()).toBeCloseTo(100 / 600, 6);
    expect(rows[2].percentRealizadoMetaTotal!.toNumber()).toBeCloseTo(1, 6);
  });

  it("uma chave presente só na Meta (mês sem nenhum resultado lançado) entra com Realizado zero, sem quebrar", () => {
    const realizado = periods([["2026-01", 100]]);
    const meta = periods([["2026-01", 100], ["2026-02", 100]]);

    const rows = buildBucketRows(realizado, meta);

    expect(rows).toHaveLength(2);
    expect(rows[1].realizado.toNumber()).toBe(0);
    expect(rows[1].percentMetaPeriodo!.toNumber()).toBe(0); // meta existe (100): 0/100 = 0, não null
  });

  it("denominador zero (meta do balde = 0) vira null, não Infinity/NaN", () => {
    const realizado = periods([["2026-01", 100]]);
    const meta = periods([["2026-01", 0]]);

    const rows = buildBucketRows(realizado, meta);

    expect(rows[0].percentMetaPeriodo).toBeNull();
    expect(rows[0].percentRealizadoEsperado).toBeNull();
    expect(rows[0].percentRealizadoMetaTotal).toBeNull();
  });
});

describe("% Esperado — curva monotônica 0%->100% (fórmula validada em rodada anterior)", () => {
  it("a soma da Meta acumulada até cada balde, dividida pelo total, nunca decresce e fecha em 100% no último balde", () => {
    const meta = periods([["2026-01", 100], ["2026-02", 300], ["2026-03", 100], ["2026-04", 500]]);
    const total = meta.reduce((acc, p) => acc.plus(p.value), new Prisma.Decimal(0));

    const acumulada = cumulativeSum(meta);
    const pctEsperado = acumulada.map((p) => safeDivide(p.value, total)!.toNumber());

    for (let i = 1; i < pctEsperado.length; i++) {
      expect(pctEsperado[i]).toBeGreaterThanOrEqual(pctEsperado[i - 1]);
    }
    expect(pctEsperado[pctEsperado.length - 1]).toBeCloseTo(1, 6);
  });
});

describe("sumDailyMapUpTo (KPI Corrido, sempre precisão diária)", () => {
  it("soma só os dias <= cutoff (inclusive), ignora os posteriores", () => {
    const daily: DailyMap = new Map([
      ["2026-03-01", d(10)],
      ["2026-03-15", d(20)],
      ["2026-03-16", d(999)], // depois do cutoff, não deve entrar
    ]);

    expect(sumDailyMapUpTo(daily, "2026-03-15").toNumber()).toBeCloseTo(30, 6);
  });

  it("mapa vazio soma zero", () => {
    expect(sumDailyMapUpTo(new Map(), "2026-03-15").toNumber()).toBe(0);
  });
});

describe("buildCumulativeSeries (Gráfico Acumulado)", () => {
  it("preenche para frente (flat) quando um mês só existe em uma das duas séries", () => {
    const realizado = periods([["2026-01", 100]]); // só janeiro tem realizado lançado
    const meta = periods([["2026-01", 100], ["2026-02", 100], ["2026-03", 100]]);

    const points = buildCumulativeSeries(realizado, meta);

    expect(points.map((p) => p.monthKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
    // realizado acumulado fica travado em 100 nos meses sem lançamento (não cai pra 0, não some da série)
    expect(points.map((p) => p.realizadoAcumulada.toNumber())).toEqual([100, 100, 100]);
    expect(points.map((p) => p.metaAcumulada.toNumber())).toEqual([100, 200, 300]);
  });
});

describe("buildComparativoPoints (Gráfico Comparativo — reindexação por mês-do-ano)", () => {
  it("sempre retorna os 12 meses, mesmo sem dados em algum deles", () => {
    const points = buildComparativoPoints([], [], []);
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.realizadoAtual.toNumber() === 0)).toBe(true);
    expect(points.every((p) => p.realizadoAnoSelecionado.toNumber() === 0)).toBe(true);
  });

  it("soma meses repetidos entre anos diferentes na mesma chave MM (campanha cruzando virada de ano)", () => {
    // groupDailyMapBy(daily, monthOnlyKey) já soma "2025-12"+"2026-12" na
    // mesma chave "12" antes de chegar aqui — simulamos esse resultado já
    // agregado, já que buildComparativoPoints só remonta o eixo 1-12.
    const metaByMonth: PeriodTotal[] = [{ key: "12", value: d(700) }]; // 300 (2025) + 400 (2026), já somado
    const points = buildComparativoPoints([], [], metaByMonth);

    const dezembro = points.find((p) => p.monthNumber === 12)!;
    expect(dezembro.metaReindexada.toNumber()).toBeCloseTo(700, 6);
  });

  it("Realizado Atual e Realizado do ano comparado são séries independentes, cada uma no seu mês", () => {
    const realizadoAtual = periods([["03", 100]]);
    const realizadoAno = periods([["03", 250]]);
    const points = buildComparativoPoints(realizadoAtual, realizadoAno, []);

    const marco = points.find((p) => p.monthNumber === 3)!;
    expect(marco.realizadoAtual.toNumber()).toBeCloseTo(100, 6);
    expect(marco.realizadoAnoSelecionado.toNumber()).toBeCloseTo(250, 6);
  });
});

describe("buildRecalculatedSeries (Gráfico Meta Recalculada)", () => {
  it("preserva a proporção original entre os meses restantes e fecha exatamente no Total original da Meta", () => {
    // Período: Jan..Dez, Realizado até Junho. Meta Total do período = soma de todos os 12 meses.
    const monthlyMeta = periods([
      ["2026-01", 100], ["2026-02", 100], ["2026-03", 100], ["2026-04", 100], ["2026-05", 100], ["2026-06", 100],
      ["2026-07", 150], ["2026-08", 100], // Julho era 50% maior que Agosto
      ["2026-09", 100], ["2026-10", 100], ["2026-11", 100], ["2026-12", 100],
    ]);
    const metaTotalPeriodo = 600 + 150 + 100 * 5; // 1350
    const realizadoCorrido = new Prisma.Decimal(1000); // Realizado até Junho
    // "correto" seria ter feito a Meta Acumulada até Junho (600) — está à FRENTE do ritmo aqui,
    // então o saldo restante cai (sobra menos pros meses futuros que os 750 originais).

    const result = buildRecalculatedSeries(monthlyMeta, realizadoCorrido, "2026-06");

    expect(result).toHaveLength(6); // Jul..Dez
    expect(result[0].monthKey).toBe("2026-07");

    const saldoRestante = metaTotalPeriodo - realizadoCorrido.toNumber(); // 1350 - 1000 = 350
    const somaRecalculada = result.reduce((acc, p) => acc + p.metaRecalculada.toNumber(), 0);
    expect(somaRecalculada).toBeCloseTo(saldoRestante, 6);

    // Fecha exatamente no Total original: Realizado até agora + soma recalculada dos meses restantes = Meta Total.
    expect(realizadoCorrido.toNumber() + somaRecalculada).toBeCloseTo(metaTotalPeriodo, 6);

    // Proporção original preservada: Julho (150) era 50% maior que Agosto (100) — continua sendo.
    const julho = result.find((p) => p.monthKey === "2026-07")!;
    const agosto = result.find((p) => p.monthKey === "2026-08")!;
    expect(julho.metaRecalculada.dividedBy(agosto.metaRecalculada).toNumber()).toBeCloseTo(1.5, 6);
  });

  it("meses passados (<= cutoff) não entram na lista — só os estritamente posteriores", () => {
    const monthlyMeta = periods([["2026-01", 100], ["2026-02", 100], ["2026-03", 100]]);
    const result = buildRecalculatedSeries(monthlyMeta, new Prisma.Decimal(50), "2026-02");
    expect(result.map((p) => p.monthKey)).toEqual(["2026-03"]);
  });

  it("lista vazia quando o cutoff está no último mês do período (nada restante)", () => {
    const monthlyMeta = periods([["2026-01", 100], ["2026-02", 100]]);
    const result = buildRecalculatedSeries(monthlyMeta, new Prisma.Decimal(50), "2026-02");
    expect(result).toEqual([]);
  });

  it("lista vazia quando os meses restantes não têm nenhuma Meta original (nada para redistribuir)", () => {
    const monthlyMeta = periods([["2026-01", 100], ["2026-02", 0]]);
    const result = buildRecalculatedSeries(monthlyMeta, new Prisma.Decimal(50), "2026-01");
    expect(result).toEqual([]);
  });

  it("déficit (atrás do ritmo) aumenta a Meta Recalculada acima da original nos meses restantes", () => {
    const monthlyMeta = periods([["2026-01", 100], ["2026-02", 100], ["2026-03", 100]]);
    // Realizado até Jan bem abaixo do esperado (esperado seria 100, fez só 20) — sobra mais pra Fev/Mar.
    const result = buildRecalculatedSeries(monthlyMeta, new Prisma.Decimal(20), "2026-01");
    expect(result[0].metaRecalculada.toNumber()).toBeGreaterThan(result[0].metaAtual.toNumber());
  });
});

describe("totalMonthsInPeriod / monthWindow (paginação mensal Dia/Semana)", () => {
  it("conta os meses inclusive nas duas pontas", () => {
    expect(totalMonthsInPeriod(utcDate("2026-01-01"), utcDate("2026-12-31"))).toBe(12);
    expect(totalMonthsInPeriod(utcDate("2026-03-15"), utcDate("2026-03-20"))).toBe(1);
    expect(totalMonthsInPeriod(utcDate("2026-11-01"), utcDate("2027-02-28"))).toBe(4);
  });

  it("monthWindow(offset=0) começa no mês calendário do período, não necessariamente no dia 1", () => {
    const { start, endExclusive } = monthWindow(utcDate("2026-03-15"), 0);
    expect(start.getTime()).toBe(utcDate("2026-03-01").getTime());
    expect(endExclusive.getTime()).toBe(utcDate("2026-04-01").getTime());
  });

  it("monthWindow avança meses corretamente cruzando virada de ano", () => {
    const { start, endExclusive } = monthWindow(utcDate("2026-11-01"), 2);
    expect(start.getTime()).toBe(utcDate("2027-01-01").getTime());
    expect(endExclusive.getTime()).toBe(utcDate("2027-02-01").getTime());
  });
});
