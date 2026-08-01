import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { computeBenefitsByType, firstDayOfMonthUtc, monthBucketOf, monthKeyOf, monthsInRange } from "./fechamento.service";
import type { ClosingCampaignRow } from "./fechamento.service";

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function campaignRow(overrides: Partial<ClosingCampaignRow> = {}): ClosingCampaignRow {
  return {
    receivablesBaseId: "base-1",
    baseName: "Base",
    indicatorType: "META",
    indicatorLabel: "Meta",
    triggerMode: "CUMULATIVO",
    periodStart: utc("2026-01-01"),
    periodEndExclusive: utc("2026-02-01"),
    attainmentPercentage: new Prisma.Decimal(100),
    realizedValue: new Prisma.Decimal(1000),
    eligible: true,
    blockedReason: null,
    payoutValue: new Prisma.Decimal(0),
    physicalPrizeDescription: null,
    tierBreakdown: [],
    approvalStatus: "APROVADO",
    ...overrides,
  };
}

describe("monthsInRange — meses cobertos pelo filtro de período do Fechamento", () => {
  it("intervalo dentro do mesmo mês retorna 1 mês", () => {
    const months = monthsInRange(utc("2026-02-05"), utc("2026-02-20"));
    expect(months.map((m) => monthKeyOf(m))).toEqual(["2026-02"]);
  });

  it("intervalo cruzando a virada do ano retorna todos os meses, em ordem", () => {
    const months = monthsInRange(utc("2025-11-10"), utc("2026-01-15"));
    expect(months.map((m) => monthKeyOf(m))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("cada mês retornado é o 1º dia (para bater com o formato de MemberClosing.referenceMonth)", () => {
    const months = monthsInRange(utc("2026-03-15"), utc("2026-03-20"));
    expect(months[0].getTime()).toBe(firstDayOfMonthUtc(utc("2026-03-01")).getTime());
  });
});

describe("monthBucketOf — Base Trimestral/Semanal pertence ao mês em que a janela TERMINA", () => {
  it("janela mensal comum pertence ao seu próprio mês", () => {
    const bucket = monthBucketOf(utc("2026-03-01")); // Fev/2026, endExclusive = 1º Mar
    expect(monthKeyOf(bucket)).toBe("2026-02");
  });

  it("janela Trimestral (Jan-Mar) pertence a Março, não a Janeiro", () => {
    const bucket = monthBucketOf(utc("2026-04-01")); // Jan-Mar/2026, endExclusive = 1º Abr
    expect(monthKeyOf(bucket)).toBe("2026-03");
  });

  it("janela Semanal virando o mês pertence ao mês em que ela termina", () => {
    const bucket = monthBucketOf(utc("2026-02-01")); // último dia real = 31/Jan (endExclusive = 1º Fev)
    expect(monthKeyOf(bucket)).toBe("2026-01");
  });
});

describe("computeBenefitsByType — soma por tipo de recompensa, só das Campanhas Aprovadas", () => {
  it("soma degraus de tipos diferentes dentro da MESMA Campanha (Cumulativo)", () => {
    const result = computeBenefitsByType([
      campaignRow({
        tierBreakdown: [
          { order: 1, rewardType: "PERCENT_FIXO", baseValueUsed: new Prisma.Decimal(5000), computedAmount: new Prisma.Decimal(250), physicalPrizeDescription: null },
          { order: 2, rewardType: "VALOR_FIXO", baseValueUsed: null, computedAmount: new Prisma.Decimal(100), physicalPrizeDescription: null },
        ],
      }),
    ]);
    expect(result.percentFixo.toString()).toBe("250");
    expect(result.valorFixo.toString()).toBe("100");
  });

  it("Campanha REPROVADA não entra na soma", () => {
    const result = computeBenefitsByType([
      campaignRow({
        approvalStatus: "REPROVADO",
        tierBreakdown: [{ order: 1, rewardType: "VALOR_FIXO", baseValueUsed: null, computedAmount: new Prisma.Decimal(500), physicalPrizeDescription: null }],
      }),
    ]);
    expect(result.valorFixo.toString()).toBe("0");
  });

  it("soma entre Campanhas diferentes, mesmo tipo de recompensa", () => {
    const result = computeBenefitsByType([
      campaignRow({ receivablesBaseId: "base-1", tierBreakdown: [{ order: 1, rewardType: "PERCENT_RESULTADO", baseValueUsed: new Prisma.Decimal(1000), computedAmount: new Prisma.Decimal(30), physicalPrizeDescription: null }] }),
      campaignRow({ receivablesBaseId: "base-2", tierBreakdown: [{ order: 1, rewardType: "PERCENT_RESULTADO", baseValueUsed: new Prisma.Decimal(2000), computedAmount: new Prisma.Decimal(60), physicalPrizeDescription: null }] }),
    ]);
    expect(result.percentResultado.toString()).toBe("90");
  });

  it("Prêmio Físico entra como descrição na lista, não soma valor monetário", () => {
    const result = computeBenefitsByType([
      campaignRow({ tierBreakdown: [{ order: 1, rewardType: "PREMIO_FISICO", baseValueUsed: null, computedAmount: new Prisma.Decimal(0), physicalPrizeDescription: "Vale Presente" }] }),
    ]);
    expect(result.premios).toEqual(["Vale Presente"]);
    expect(result.percentFixo.toString()).toBe("0");
  });
});
