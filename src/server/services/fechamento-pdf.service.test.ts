import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildFechamentoPdfHtml } from "./fechamento-pdf.service";
import type { ClosingDetail } from "./fechamento.service";

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function baseDetail(overrides: Partial<ClosingDetail> = {}): ClosingDetail {
  return {
    memberId: "m1",
    memberName: "Fulano de Tal",
    cargoName: "Vendedor",
    hierarchyPath: "Atacado>Hospitalar",
    referenceMonth: new Date("2026-06-01T00:00:00.000Z"),
    isSaved: true,
    status: "FECHADO",
    fixedValue: d(3000),
    campaigns: [],
    resultsByType: [],
    benefitsByType: { PERCENT_FIXO: "0", PERCENT_RESULTADO: "0", VALOR_FIXO: "0", PREMIO_FISICO: [] },
    totalValue: d(3000),
    manualAdjustmentValue: null,
    manualAdjustmentReason: null,
    comments: null,
    closedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildFechamentoPdfHtml", () => {
  it("inclui 1 linha no Resumo Geral por Fechamento, citando o nome de cada Membro", () => {
    const html = buildFechamentoPdfHtml([baseDetail({ memberName: "Ana" }), baseDetail({ memberName: "Beto" })]);
    expect(html).toContain("Ana");
    expect(html).toContain("Beto");
  });

  it("inclui 1 bloco de detalhamento por Fechamento, cada um marcado com a classe que dispara page-break-before no CSS", () => {
    const html = buildFechamentoPdfHtml([baseDetail({ memberName: "Ana" }), baseDetail({ memberName: "Beto" })]);
    expect(html).toContain("page-break-before");
    const detailBlocks = html.match(/class="detail-page"/g) ?? [];
    expect(detailBlocks.length).toBe(2);
  });

  it("escapa HTML em campos de texto livre (Comentários), pra não quebrar o documento", () => {
    const html = buildFechamentoPdfHtml([baseDetail({ comments: "<script>alert(1)</script>" })]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("mostra Premiações Físicas quando existem", () => {
    const html = buildFechamentoPdfHtml([
      baseDetail({ benefitsByType: { PERCENT_FIXO: "0", PERCENT_RESULTADO: "0", VALOR_FIXO: "0", PREMIO_FISICO: ["Viagem"] } }),
    ]);
    expect(html).toContain("Viagem");
  });

  it("mostra as Campanhas de Recebível com o detalhamento de Degraus batidos", () => {
    const campaign: ClosingDetail["campaigns"][number] = {
      receivablesBaseId: "b1",
      baseName: "Venda Individuais",
      indicatorType: "META",
      indicatorLabel: "Venda ($)",
      triggerMode: "FAIXA",
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEndExclusive: new Date("2026-07-01T00:00:00.000Z"),
      attainmentPercentage: d(120),
      realizedValue: d(50000),
      eligible: true,
      blockedReason: null,
      payoutValue: d(1000),
      physicalPrizeDescription: null,
      tierBreakdown: [
        { order: 2, rewardType: "PERCENT_RESULTADO", baseValueUsed: d(50000), computedAmount: d(1000), physicalPrizeDescription: null },
      ],
      approvalStatus: "APROVADO",
    };
    const html = buildFechamentoPdfHtml([baseDetail({ campaigns: [campaign] })]);
    expect(html).toContain("Venda Individuais");
    expect(html).toContain("Degrau #2");
  });
});
