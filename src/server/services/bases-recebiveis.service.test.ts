import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  buildFullLadder,
  computeAttainmentValue,
  computePayout,
  computeRequiredValue,
  computeTierPayout,
  enumeratePeriodWindows,
  pickAchievedTiers,
  resolvePeriodWindow,
  resolveReceivablesBasePage,
  sumDailyMapInWindow,
  triggerAppliesToMember,
  type TierRewardConfig,
  type TierThreshold,
} from "./bases-recebiveis.service";
import { resolveFixedSalary } from "./cargos.service";
import type { DailyMap } from "./metas.service";

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function threshold(order: number, value: number, id = `t${order}`): TierThreshold {
  return { id, order, threshold: d(value) };
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function dailyMap(entries: [string, number][]): DailyMap {
  return new Map(entries.map(([key, value]) => [key, d(value)]));
}

describe("computeAttainmentValue", () => {
  it("META: divide Realizado pela Meta e multiplica por 100", () => {
    const result = computeAttainmentValue("META", d(950), d(1000));
    expect(result.toNumber()).toBe(95);
  });

  it("META: retorna 0 quando a Meta total é zero (evita divisão por zero)", () => {
    const result = computeAttainmentValue("META", d(500), d(0));
    expect(result.toNumber()).toBe(0);
  });

  it("RESULTADO: retorna o próprio Realizado, ignorando a Meta", () => {
    const result = computeAttainmentValue("RESULTADO", d(52000), d(0));
    expect(result.toNumber()).toBe(52000);
  });
});

describe("pickAchievedTiers — Degrau Rígido (spec §3) e Faixa vs Cumulativo (§5)", () => {
  const tiers = [threshold(1, 80, "G1"), threshold(2, 100, "G2"), threshold(3, 120, "G3")];

  it("FAIXA: retido no maior degrau conquistado (exemplo da spec: 95% com G1=80/G2=100 fica em G1)", () => {
    const achieved = pickAchievedTiers(d(95), tiers, "FAIXA");
    expect(achieved.map((t) => t.id)).toEqual(["G1"]);
  });

  it("FAIXA: ao bater exatamente 100% do próximo, sobe para o degrau seguinte", () => {
    const achieved = pickAchievedTiers(d(100), tiers, "FAIXA");
    expect(achieved.map((t) => t.id)).toEqual(["G2"]);
  });

  it("CUMULATIVO: retorna todos os degraus já conquistados, em ordem", () => {
    const achieved = pickAchievedTiers(d(125), tiers, "CUMULATIVO");
    expect(achieved.map((t) => t.id)).toEqual(["G1", "G2", "G3"]);
  });

  it("Nenhum degrau conquistado (abaixo do primeiro limiar) retorna lista vazia nos dois modos", () => {
    expect(pickAchievedTiers(d(50), tiers, "FAIXA")).toEqual([]);
    expect(pickAchievedTiers(d(50), tiers, "CUMULATIVO")).toEqual([]);
  });

  it("Funciona igual para limiares em valor absoluto (trilha Resultado)", () => {
    const valueTiers = [threshold(1, 50000, "V1"), threshold(2, 100000, "V2")];
    const achieved = pickAchievedTiers(d(75000), valueTiers, "FAIXA");
    expect(achieved.map((t) => t.id)).toEqual(["V1"]);
  });
});

describe("buildFullLadder — status de cada Degrau é comparação PURA de limiar (não reaproveita pickAchievedTiers)", () => {
  const tiers = [threshold(1, 80, "G1"), threshold(2, 100, "G2"), threshold(3, 120, "G3"), threshold(4, 140, "G4"), threshold(5, 160, "G5")];

  it("marca como batidos TODOS os degraus já ultrapassados, mesmo em modo Faixa (onde pickAchievedTiers devolveria só o mais alto)", () => {
    // Achado do bug: um Beneficiário no Degrau 2 (100<=x<120) tinha o Degrau 1
    // marcado como "não batido" (porque pickAchievedTiers em Faixa só retorna
    // G2), fazendo "Próximo Degrau" achar G1 primeiro e mostrar gap<=0 → "No Topo".
    const ladder = buildFullLadder(d(105), tiers);
    expect(ladder.map((r) => r.achieved)).toEqual([true, true, false, false, false]);
  });

  it("nenhum degrau batido quando o atingimento é menor que o primeiro limiar", () => {
    const ladder = buildFullLadder(d(50), tiers);
    expect(ladder.every((r) => !r.achieved)).toBe(true);
  });

  it("todos os degraus batidos quando o atingimento supera o último limiar", () => {
    const ladder = buildFullLadder(d(200), tiers);
    expect(ladder.every((r) => r.achieved)).toBe(true);
  });

  it("devolve em ordem crescente de order, independente da ordem de entrada", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    const ladder = buildFullLadder(d(90), shuffled);
    expect(ladder.map((r) => r.order)).toEqual([1, 2, 3]);
  });
});

describe("resolveFixedSalary (spec § Cargos/3)", () => {
  it("usa o Salário Customizado do Membro quando preenchido e maior que zero", () => {
    const result = resolveFixedSalary({ customFixedSalary: d(6000) }, { defaultFixedSalary: d(4000) });
    expect(result.toNumber()).toBe(6000);
  });

  it("cai para o Salário Padrão do Cargo quando o customizado é null", () => {
    const result = resolveFixedSalary({ customFixedSalary: null }, { defaultFixedSalary: d(4000) });
    expect(result.toNumber()).toBe(4000);
  });

  it("cai para o Salário Padrão do Cargo quando o customizado é zero", () => {
    const result = resolveFixedSalary({ customFixedSalary: d(0) }, { defaultFixedSalary: d(4000) });
    expect(result.toNumber()).toBe(4000);
  });
});

describe("computeTierPayout — Base de Cálculo Dinâmica (spec §4)", () => {
  const ctx = {
    member: { customFixedSalary: null },
    cargo: { defaultFixedSalary: d(5000) },
    rewardResultRealized: d(200000),
  };

  it("PERCENT_FIXO: aplica o percentual sobre o salário (com fallback do Cargo)", () => {
    const tier: TierRewardConfig = {
      rewardType: "PERCENT_FIXO",
      rewardResultTypeId: null,
      rewardPercentage: d(10),
      rewardFixedValue: null,
      rewardDescription: null,
    };
    const result = computeTierPayout(tier, ctx);
    expect(result.payoutValue.toNumber()).toBe(500);
    expect(result.physicalPrizeDescription).toBeNull();
  });

  it("PERCENT_RESULTADO: aplica o percentual sobre o Realizado do Tipo de Resultado escolhido", () => {
    const tier: TierRewardConfig = {
      rewardType: "PERCENT_RESULTADO",
      rewardResultTypeId: "rt-1",
      rewardPercentage: d(1.5),
      rewardFixedValue: null,
      rewardDescription: null,
    };
    const result = computeTierPayout(tier, ctx);
    expect(result.payoutValue.toNumber()).toBe(3000);
  });

  it("VALOR_FIXO: retorna o valor nominal direto", () => {
    const tier: TierRewardConfig = {
      rewardType: "VALOR_FIXO",
      rewardResultTypeId: null,
      rewardPercentage: null,
      rewardFixedValue: d(800),
      rewardDescription: null,
    };
    const result = computeTierPayout(tier, ctx);
    expect(result.payoutValue.toNumber()).toBe(800);
  });

  it("PREMIO_FISICO: payout zero, retorna a descrição do prêmio", () => {
    const tier: TierRewardConfig = {
      rewardType: "PREMIO_FISICO",
      rewardResultTypeId: null,
      rewardPercentage: null,
      rewardFixedValue: null,
      rewardDescription: "Vale Presente",
    };
    const result = computeTierPayout(tier, ctx);
    expect(result.payoutValue.toNumber()).toBe(0);
    expect(result.physicalPrizeDescription).toBe("Vale Presente");
  });
});

describe("computePayout — soma no modo Cumulativo (spec §5)", () => {
  const ctx = {
    member: { customFixedSalary: null },
    cargo: { defaultFixedSalary: d(5000) },
    rewardResultRealized: null,
  };

  it("Faixa (1 degrau): retorna o payout isolado daquele degrau", () => {
    const tiers: TierRewardConfig[] = [
      { rewardType: "VALOR_FIXO", rewardResultTypeId: null, rewardPercentage: null, rewardFixedValue: d(300), rewardDescription: null },
    ];
    const result = computePayout(tiers, () => ctx);
    expect(result.payoutValue.toNumber()).toBe(300);
  });

  it("Cumulativo (N degraus): soma o payout de todos os degraus conquistados", () => {
    const tiers: TierRewardConfig[] = [
      { rewardType: "VALOR_FIXO", rewardResultTypeId: null, rewardPercentage: null, rewardFixedValue: d(300), rewardDescription: null },
      { rewardType: "PERCENT_FIXO", rewardResultTypeId: null, rewardPercentage: d(2), rewardFixedValue: null, rewardDescription: null },
    ];
    const result = computePayout(tiers, () => ctx);
    // 300 (valor fixo) + 5000*2% = 100 (percent fixo) = 400
    expect(result.payoutValue.toNumber()).toBe(400);
  });

  it("Concatena descrições de Prêmio Físico quando mais de um degrau premia com prêmio", () => {
    const tiers: TierRewardConfig[] = [
      { rewardType: "PREMIO_FISICO", rewardResultTypeId: null, rewardPercentage: null, rewardFixedValue: null, rewardDescription: "Vale Presente" },
      { rewardType: "PREMIO_FISICO", rewardResultTypeId: null, rewardPercentage: null, rewardFixedValue: null, rewardDescription: "Viagem" },
    ];
    const result = computePayout(tiers, () => ctx);
    expect(result.physicalPrizeDescription).toBe("Vale Presente; Viagem");
    expect(result.payoutValue.toNumber()).toBe(0);
  });
});

describe("resolvePeriodWindow — janela do Período de Fechamento", () => {
  it("DIARIO: só o próprio dia", () => {
    const window = resolvePeriodWindow("DIARIO", utcDate("2026-03-15"));
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(window.endExclusive.toISOString().slice(0, 10)).toBe("2026-03-16");
  });

  it("SEMANAL: semana ISO (Segunda a Domingo) contendo a data de referência", () => {
    // 2026-03-18 é uma quarta-feira; a semana ISO vai de 16 (seg) a 23 (seg seguinte, exclusivo).
    const window = resolvePeriodWindow("SEMANAL", utcDate("2026-03-18"));
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-03-16");
    expect(window.endExclusive.toISOString().slice(0, 10)).toBe("2026-03-23");
  });

  it("SEMANAL: referência caindo num domingo pega a semana que termina nele", () => {
    // 2026-03-22 é domingo; semana começa na segunda 2026-03-16.
    const window = resolvePeriodWindow("SEMANAL", utcDate("2026-03-22"));
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-03-16");
    expect(window.endExclusive.toISOString().slice(0, 10)).toBe("2026-03-23");
  });

  it("MENSAL: 1º dia do mês até o 1º dia do mês seguinte (exclusivo) — cobre mês de 28/29/30/31 dias", () => {
    const window = resolvePeriodWindow("MENSAL", utcDate("2026-02-10"));
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(window.endExclusive.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("TRIMESTRAL: 1º dia do trimestre até o 1º dia do trimestre seguinte", () => {
    const window = resolvePeriodWindow("TRIMESTRAL", utcDate("2026-08-05"));
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(window.endExclusive.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("ANUAL: 1º de janeiro até o 1º de janeiro do ano seguinte", () => {
    const window = resolvePeriodWindow("ANUAL", utcDate("2026-08-05"));
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(window.endExclusive.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});

describe("sumDailyMapInWindow", () => {
  it("soma só os dias dentro da janela, ignorando dias de fora", () => {
    const daily = dailyMap([
      ["2026-02-28", 100],
      ["2026-03-01", 200],
      ["2026-03-15", 300],
      ["2026-03-31", 50],
      ["2026-04-01", 999],
    ]);
    const window = resolvePeriodWindow("MENSAL", utcDate("2026-03-10"));
    expect(sumDailyMapInWindow(daily, window).toNumber()).toBe(550);
  });

  it("retorna 0 quando não há nenhum dia dentro da janela", () => {
    const daily = dailyMap([["2026-01-01", 1000]]);
    const window = resolvePeriodWindow("MENSAL", utcDate("2026-03-10"));
    expect(sumDailyMapInWindow(daily, window).toNumber()).toBe(0);
  });
});

describe("enumeratePeriodWindows — janelas de fechamento dentro de um intervalo (tela de Recebíveis)", () => {
  it("MENSAL: 3 meses filtrados geram 3 janelas", () => {
    const windows = enumeratePeriodWindows("MENSAL", utcDate("2026-01-01"), utcDate("2026-04-01"));
    expect(windows.map((w) => w.start.toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(windows.map((w) => w.endExclusive.toISOString().slice(0, 10))).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("MENSAL: intervalo começando no meio do mês ainda inclui a janela inteira daquele mês", () => {
    const windows = enumeratePeriodWindows("MENSAL", utcDate("2026-03-15"), utcDate("2026-04-01"));
    expect(windows).toHaveLength(1);
    expect(windows[0].start.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(windows[0].endExclusive.toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("TRIMESTRAL: intervalo de 2 trimestres gera 2 janelas de 3 meses cada", () => {
    const windows = enumeratePeriodWindows("TRIMESTRAL", utcDate("2026-01-01"), utcDate("2026-07-01"));
    expect(windows).toHaveLength(2);
    expect(windows[0].start.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(windows[0].endExclusive.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(windows[1].start.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(windows[1].endExclusive.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("SEMANAL: avança semana ISO a semana ISO até cobrir o intervalo", () => {
    // 2026-03-16 (seg) a 2026-03-30 (seg) cobre exatamente 2 semanas ISO completas.
    const windows = enumeratePeriodWindows("SEMANAL", utcDate("2026-03-16"), utcDate("2026-03-30"));
    expect(windows).toHaveLength(2);
    expect(windows[0].start.toISOString().slice(0, 10)).toBe("2026-03-16");
    expect(windows[1].start.toISOString().slice(0, 10)).toBe("2026-03-23");
  });

  it("intervalo vazio (start >= end) devolve lista vazia", () => {
    expect(enumeratePeriodWindows("MENSAL", utcDate("2026-03-01"), utcDate("2026-03-01"))).toEqual([]);
    expect(enumeratePeriodWindows("MENSAL", utcDate("2026-04-01"), utcDate("2026-03-01"))).toEqual([]);
  });
});

describe("triggerAppliesToMember — Gatilhos Condicionais por Beneficiário", () => {
  it("lista vazia = a Condição vale para todos os Beneficiários", () => {
    expect(triggerAppliesToMember([], "m1")).toBe(true);
    expect(triggerAppliesToMember([], "qualquer-outro")).toBe(true);
  });

  it("lista não vazia = só vale para os Beneficiários listados", () => {
    expect(triggerAppliesToMember(["m1", "m2"], "m1")).toBe(true);
    expect(triggerAppliesToMember(["m1", "m2"], "m3")).toBe(false);
  });
});

describe("computeRequiredValue (valor-alvo por período — ambiente simulado, nunca usa Realizado)", () => {
  it("trilha META: converte o percentual do limiar para valor absoluto usando a Meta daquele período", () => {
    const required = computeRequiredValue("META", d(80), d(10000));
    expect(required.toNumber()).toBe(8000);
  });

  it("trilha META: o mesmo limiar dá valores diferentes conforme a Meta do período (sazonalidade)", () => {
    const janeiro = computeRequiredValue("META", d(80), d(10000));
    const fevereiro = computeRequiredValue("META", d(80), d(15000));
    expect(janeiro.toNumber()).toBe(8000);
    expect(fevereiro.toNumber()).toBe(12000);
  });

  it("trilha RESULTADO: devolve o valor absoluto do limiar direto, ignorando o total de referência (constante entre períodos)", () => {
    const required = computeRequiredValue("RESULTADO", d(6000), d(999999));
    expect(required.toNumber()).toBe(6000);
  });
});

describe("resolveReceivablesBasePage (paginação de período — mesmo padrão de monthWindow em Acompanhamento)", () => {
  it("Mensal com vigência de 6 meses: sem paginação, devolve as 6 janelas de uma vez", () => {
    const result = resolveReceivablesBasePage("MENSAL", utcDate("2026-01-01"), utcDate("2026-07-01"), 0);
    expect(result.pagination).toBeNull();
    expect(result.periodWindows).toHaveLength(6);
  });

  it("Mensal com vigência de 18 meses: pagina em blocos de 12", () => {
    const page0 = resolveReceivablesBasePage("MENSAL", utcDate("2026-01-01"), utcDate("2027-07-01"), 0);
    expect(page0.pagination).toEqual({ offset: 0, hasPrev: false, hasNext: true });
    expect(page0.periodWindows).toHaveLength(12);

    const page1 = resolveReceivablesBasePage("MENSAL", utcDate("2026-01-01"), utcDate("2027-07-01"), 1);
    expect(page1.pagination).toEqual({ offset: 1, hasPrev: true, hasNext: false });
    expect(page1.periodWindows).toHaveLength(6);
  });

  it("Diário: sempre pagina por mês civil, mesmo dentro de uma vigência curta", () => {
    const page0 = resolveReceivablesBasePage("DIARIO", utcDate("2026-01-15"), utcDate("2026-03-01"), 0);
    expect(page0.pagination).toEqual({ offset: 0, hasPrev: false, hasNext: true });
    // Página 0 clipada: 15 a 31 de Janeiro = 17 dias.
    expect(page0.periodWindows).toHaveLength(17);

    const page1 = resolveReceivablesBasePage("DIARIO", utcDate("2026-01-15"), utcDate("2026-03-01"), 1);
    expect(page1.pagination).toEqual({ offset: 1, hasPrev: true, hasNext: false });
    // Página 1 = Fevereiro inteiro (2026 não é bissexto) = 28 dias.
    expect(page1.periodWindows).toHaveLength(28);
  });

  it("página pedida além do fim é grampeada na última página válida", () => {
    const result = resolveReceivablesBasePage("MENSAL", utcDate("2026-01-01"), utcDate("2026-07-01"), 99);
    expect(result.pagination).toBeNull();
    expect(result.periodWindows).toHaveLength(6);
  });

  it("intervalo vazio (rangeStart >= rangeEndExclusive) devolve lista vazia sem paginação", () => {
    const result = resolveReceivablesBasePage("MENSAL", utcDate("2026-07-01"), utcDate("2026-07-01"), 0);
    expect(result.periodWindows).toHaveLength(0);
    expect(result.pagination).toBeNull();
  });
});
