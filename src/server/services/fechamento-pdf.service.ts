import type { Prisma, RewardType } from "@prisma/client";
import puppeteer from "puppeteer";
import { ConflictError } from "../utils/http-errors";
import { getClosingDetail } from "./fechamento.service";
import type { ClosingDetail, ClosingCampaignRow } from "./fechamento.service";
import type { TierPayoutBreakdown } from "./bases-recebiveis.service";
import type { RequestingUser } from "./scope.util";

function fmt(value: Prisma.Decimal | string | number): string {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const REWARD_LABELS: Record<RewardType, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

function tierBreakdownHtml(tiers: TierPayoutBreakdown[]): string {
  if (tiers.length === 0) return "";
  const items = tiers
    .map((tier) => {
      const label = REWARD_LABELS[tier.rewardType];
      const base = tier.baseValueUsed ? ` sobre ${fmt(tier.baseValueUsed)}` : "";
      const tail = tier.physicalPrizeDescription ? ` — ${escapeHtml(tier.physicalPrizeDescription)}` : ` = ${fmt(tier.computedAmount)}`;
      return `<li>Degrau #${tier.order} — ${label}${base}${tail}</li>`;
    })
    .join("");
  return `<ul class="tiers">${items}</ul>`;
}

function campaignHtml(campaign: ClosingCampaignRow): string {
  const periodEndInclusive = new Date(campaign.periodEndExclusive.getTime() - 86400000);
  return `
    <div class="campaign">
      <p class="campaign-title"><strong>${escapeHtml(campaign.baseName)}</strong> — ${escapeHtml(campaign.indicatorLabel)} — ${campaign.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"} — ${formatDate(campaign.periodStart)} a ${formatDate(periodEndInclusive)}</p>
      <p class="campaign-meta">
        Resultado apurado: ${fmt(campaign.realizedValue)}
        &nbsp;·&nbsp; % Atingido: ${campaign.attainmentPercentage != null ? `${fmt(campaign.attainmentPercentage)}%` : "—"}
        &nbsp;·&nbsp; Elegível: ${campaign.eligible ? "Sim" : `Não (${escapeHtml(campaign.blockedReason ?? "—")})`}
        &nbsp;·&nbsp; Valor do benefício: ${fmt(campaign.payoutValue)}
      </p>
      ${tierBreakdownHtml(campaign.tierBreakdown)}
    </div>
  `;
}

function summaryRowHtml(detail: ClosingDetail): string {
  const benefitsValue = detail.totalValue.minus(detail.fixedValue).minus(detail.manualAdjustmentValue ?? 0);
  return `
    <tr>
      <td>${escapeHtml(detail.memberName)}</td>
      <td>${formatMonth(detail.referenceMonth)}</td>
      <td>${escapeHtml(detail.cargoName)}</td>
      <td>${fmt(detail.fixedValue)}</td>
      <td>${fmt(benefitsValue)}</td>
      <td>${fmt(detail.totalValue)}</td>
    </tr>
  `;
}

function detailBlockHtml(detail: ClosingDetail): string {
  return `
    <div class="detail-page">
      <h2>${escapeHtml(detail.memberName)} — ${formatMonth(detail.referenceMonth)}</h2>
      <p class="muted">${escapeHtml(detail.cargoName)}${detail.hierarchyPath ? ` — ${escapeHtml(detail.hierarchyPath.replace(/>/g, " > "))}` : ""}</p>

      <div class="totals">
        <div><p class="label">Fixo</p><p class="value">${fmt(detail.fixedValue)}</p></div>
        <div><p class="label">% sobre o Fixo</p><p class="value">${fmt(detail.benefitsByType.PERCENT_FIXO)}</p></div>
        <div><p class="label">% sobre o Resultado</p><p class="value">${fmt(detail.benefitsByType.PERCENT_RESULTADO)}</p></div>
        <div><p class="label">Valor Específico</p><p class="value">${fmt(detail.benefitsByType.VALOR_FIXO)}</p></div>
        <div><p class="label">Total</p><p class="value">${fmt(detail.totalValue)}</p></div>
      </div>

      ${detail.benefitsByType.PREMIO_FISICO.length > 0 ? `<p><strong>Premiações Físicas:</strong> ${detail.benefitsByType.PREMIO_FISICO.map(escapeHtml).join("; ")}</p>` : ""}

      ${
        detail.resultsByType.length > 0
          ? `<h3>Resultados do Período</h3><p>${detail.resultsByType.map((r) => `${escapeHtml(r.resultTypeName)}: ${fmt(r.totalValue)}`).join(" &nbsp;·&nbsp; ")}</p>`
          : ""
      }

      <h3>Campanhas de Recebível</h3>
      ${detail.campaigns.length === 0 ? '<p class="muted">Nenhuma Campanha de Recebível ativa.</p>' : detail.campaigns.map(campaignHtml).join("")}

      ${
        detail.comments || detail.manualAdjustmentValue
          ? `<h3>Comentários e Ajuste</h3>
             ${detail.comments ? `<p>${escapeHtml(detail.comments)}</p>` : ""}
             ${detail.manualAdjustmentValue ? `<p>Valor Adicional: ${fmt(detail.manualAdjustmentValue)}${detail.manualAdjustmentReason ? ` — ${escapeHtml(detail.manualAdjustmentReason)}` : ""}</p>` : ""}`
          : ""
      }

      ${detail.closedAt ? `<p class="muted">Fechado em ${formatDate(detail.closedAt)}.</p>` : ""}
    </div>
  `;
}

// Função PURA — sem I/O, sem Puppeteer. Monta o HTML completo do relatório:
// Resumo Geral (1 linha por Fechamento) + 1 bloco de detalhamento por
// Fechamento, cada um começando em página nova (page-break-before, CSS
// cuida da paginação — nenhuma posição x/y calculada na mão).
export function buildFechamentoPdfHtml(details: ClosingDetail[]): string {
  const summaryRows = details.map(summaryRowHtml).join("");
  const detailBlocks = details.map(detailBlockHtml).join("");
  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "UTC" });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1a1a1a; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
  th { background: #f3f3f3; }
  .totals { display: flex; gap: 24px; margin: 12px 0; }
  .totals div { flex: 1; }
  .label { color: #666; font-size: 10px; margin: 0; }
  .value { font-size: 14px; font-weight: 600; margin: 0; }
  .campaign { border-left: 3px solid #999; padding: 6px 10px; margin-bottom: 8px; background: #fafafa; }
  .campaign-title { margin: 0 0 2px; }
  .campaign-meta { margin: 0; font-size: 10px; color: #444; }
  .tiers { margin: 4px 0 0; padding-left: 18px; font-size: 10px; color: #444; }
  .detail-page { page-break-before: always; padding-top: 16px; }
  .muted { color: #666; font-size: 10px; }
</style>
</head>
<body>
  <h1>Resumo de Fechamentos</h1>
  <p class="muted">Gerado em ${geradoEm}</p>

  <h2>Resumo Geral</h2>
  <table>
    <thead><tr><th>Membro</th><th>Mês</th><th>Cargo</th><th>Fixo (R$)</th><th>Benefícios (R$)</th><th>Total (R$)</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>

  ${detailBlocks}
</body>
</html>`;
}

export interface ExportClosingItem {
  memberId: string;
  referenceMonth: string;
}

// Busca cada Fechamento (getClosingDetail já valida permissão por Membro –
// assertCanViewFechamento+assertNativeVisibleMembers), garante que todos
// estão de fato SALVOS (isSaved) — evita gerar um PDF com dado incompleto
// se algum foi reaberto entre a seleção na tela e o clique em exportar —,
// monta o HTML e renderiza via Puppeteer.
export async function exportClosingsPdf(
  companyId: string,
  requestingUser: RequestingUser,
  items: ExportClosingItem[],
): Promise<Buffer> {
  const details: ClosingDetail[] = [];
  for (const item of items) {
    const detail = await getClosingDetail(companyId, requestingUser, item.memberId, item.referenceMonth);
    if (!detail.isSaved) {
      throw new ConflictError(`O Fechamento de ${detail.memberName} não está mais salvo (foi reaberto) — atualize a lista e tente novamente.`);
    }
    details.push(detail);
  }

  const html = buildFechamentoPdfHtml(details);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
