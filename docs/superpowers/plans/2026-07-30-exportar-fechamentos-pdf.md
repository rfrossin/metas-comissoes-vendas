# Exportar Fechamentos em PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportar os Fechamentos Fechados selecionados em `FechamentoPage.tsx` num único PDF com Resumo Geral + detalhamento completo de cada um, cada um em página nova.

**Architecture:** HTML gerado server-side (função pura, testável sem Puppeteer/banco) → Puppeteer (Chromium headless) → PDF via `page.pdf()`, CSS (`page-break-before`) cuida da paginação. 1 endpoint novo, reaproveitando a mesma seleção "Fechado" já construída na Parte E (`selectedFechadoItems`) e o mesmo padrão de item `{memberId, referenceMonth}` já usado em `/bulk-save`/`/bulk-reopen`.

**Tech Stack:** TypeScript, Express, Prisma, Puppeteer (nova dependência), Vitest (server); React + TypeScript, TanStack Query (client).

## Global Constraints

- Nenhuma mudança de schema.
- Este projeto **não é um repositório git no momento** — nenhum passo deste plano inclui `git commit`.
- Nova dependência: `puppeteer` (baixa um Chromium próprio, ~300MB, download único). Só instalar na task que realmente precisa dela (Task 2) — a função de montagem de HTML (Task 1) é pura e não depende de Puppeteer. Se o `npm install puppeteer` falhar (rede/firewall bloqueando o download do Chromium), **parar e avisar o usuário** — não tentar contornar.
- Validação de cada task: `npm run tsc`; tasks que tocam `fechamento-pdf.service.test.ts` também rodam `npm run test`.

---

### Task 1: `buildFechamentoPdfHtml` — função pura, com testes (TDD)

**Files:**
- Create: `src/server/services/fechamento-pdf.service.ts`
- Create: `src/server/services/fechamento-pdf.service.test.ts`

**Interfaces:**
- Consumes: `ClosingDetail`, `ClosingCampaignRow`, `BenefitsByType`, `ResultByType` (todos já existentes, exportados de `./fechamento.service`), `TierPayoutBreakdown`, `RewardType` (de `./bases-recebiveis.service`/`@prisma/client`).
- Produces: `buildFechamentoPdfHtml(details: ClosingDetail[]): string` — consumido pelo Task 2.

- [ ] **Step 1: Escrever os testes**

Criar `src/server/services/fechamento-pdf.service.test.ts`:

```ts
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

  it("inclui 1 bloco de detalhamento por Fechamento, cada um começando em página nova", () => {
    const html = buildFechamentoPdfHtml([baseDetail({ memberName: "Ana" }), baseDetail({ memberName: "Beto" })]);
    const pageBreaks = html.match(/page-break-before/g) ?? [];
    expect(pageBreaks.length).toBeGreaterThanOrEqual(2);
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- fechamento-pdf.service.test.ts`
Expected: FAIL — `buildFechamentoPdfHtml is not a function` (arquivo `fechamento-pdf.service.ts` ainda não existe).

- [ ] **Step 3: Implementar `buildFechamentoPdfHtml`**

Criar `src/server/services/fechamento-pdf.service.ts`:

```ts
import type { Prisma, RewardType } from "@prisma/client";
import type { ClosingDetail, ClosingCampaignRow } from "./fechamento.service";
import type { TierPayoutBreakdown } from "./bases-recebiveis.service";

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
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- fechamento-pdf.service.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 2: `exportClosingsPdf` — instalar Puppeteer + orquestração

**Files:**
- Modify: `src/server/services/fechamento-pdf.service.ts`
- Modify: `package.json` (via `npm install`)

**Interfaces:**
- Consumes: `buildFechamentoPdfHtml` (Task 1), `getClosingDetail` (já existente, `./fechamento.service`), `ConflictError` (`../utils/http-errors`), `RequestingUser` (`./scope.util`).
- Produces: `exportClosingsPdf(companyId: string, requestingUser: RequestingUser, items: {memberId: string, referenceMonth: string}[]): Promise<Buffer>` — consumido pelo Task 3.

- [ ] **Step 1: Instalar Puppeteer**

Run: `npm install puppeteer`
Expected: instala com sucesso (baixa um Chromium próprio, ~300MB — pode demorar alguns minutos). **Se falhar por rede/firewall bloqueando o download do Chromium, parar aqui e avisar o usuário — não tentar contornar com flags de skip-download ou similar sem confirmar antes.**

- [ ] **Step 2: Adicionar `exportClosingsPdf` ao arquivo**

No topo de `fechamento-pdf.service.ts`, adicionar os imports novos:

```ts
import puppeteer from "puppeteer";
import { ConflictError } from "../utils/http-errors";
import { getClosingDetail } from "./fechamento.service";
import type { RequestingUser } from "./scope.util";
```

(Ficam junto dos imports de tipo já existentes de `./fechamento.service`/`./bases-recebiveis.service` do Task 1 — o import de `ClosingDetail`/`ClosingCampaignRow` vira `import { getClosingDetail } from "./fechamento.service"; import type { ClosingDetail, ClosingCampaignRow } from "./fechamento.service";` ou combinado num só `import` com `type` misto, como preferir — mantendo os dois tipos já usados no Task 1.)

No fim do arquivo, adicionar:

```ts
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
    await page.setContent(html, { waitUntil: "networkidle0" });
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
```

- [ ] **Step 3: Rodar `tsc` e os testes**

Run: `npm run tsc && npm run test -- fechamento-pdf.service.test.ts`
Expected: sem erros; os 5 testes do Task 1 continuam passando (não usam `exportClosingsPdf`, só `buildFechamentoPdfHtml`).

---

### Task 3: Controller e rota

**Files:**
- Modify: `src/server/controllers/fechamento.controller.ts`
- Modify: `src/server/routes/fechamento.routes.ts`

**Interfaces:**
- Consumes: `exportClosingsPdf` (Task 2), `bulkSaveSchema`/`badRequest`/`respondToError` (já existentes no controller).
- Produces: rota `POST /fechamento/export-pdf` — consumida pelo Task 4.

- [ ] **Step 1: Adicionar o handler**

Em `fechamento.controller.ts`, trocar o import de serviços:

```ts
import {
  getClosingDetail,
  listClosings,
  listCommercialPeriods,
  reopenClosing,
  reopenClosingBulk,
  saveClosing,
  saveClosingBulk,
  setCommercialPeriodStatus,
} from "../services/fechamento.service";
```

Para:

```ts
import {
  getClosingDetail,
  listClosings,
  listCommercialPeriods,
  reopenClosing,
  reopenClosingBulk,
  saveClosing,
  saveClosingBulk,
  setCommercialPeriodStatus,
} from "../services/fechamento.service";
import { exportClosingsPdf } from "../services/fechamento-pdf.service";
```

Logo depois de `reopenClosingBulkHandler` (adicionado na Parte E), adicionar:

```ts
export async function exportClosingsPdfHandler(req: Request, res: Response) {
  const parsed = bulkSaveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const pdfBuffer = await exportClosingsPdf(req.user!.companyId, req.user!, parsed.data.items);
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="fechamentos-${today}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    respondToError(error, res);
  }
}
```

- [ ] **Step 2: Registrar a rota**

Em `fechamento.routes.ts`, trocar o import:

```ts
import {
  getClosingDetailHandler,
  listClosingsHandler,
  listCommercialPeriodsHandler,
  reopenClosingBulkHandler,
  reopenClosingHandler,
  saveClosingBulkHandler,
  saveClosingHandler,
  setCommercialPeriodStatusHandler,
} from "../controllers/fechamento.controller";
```

Para:

```ts
import {
  exportClosingsPdfHandler,
  getClosingDetailHandler,
  listClosingsHandler,
  listCommercialPeriodsHandler,
  reopenClosingBulkHandler,
  reopenClosingHandler,
  saveClosingBulkHandler,
  saveClosingHandler,
  setCommercialPeriodStatusHandler,
} from "../controllers/fechamento.controller";
```

E, logo abaixo de `fechamentoRoutes.post("/bulk-reopen", asyncHandler(reopenClosingBulkHandler));`, adicionar:

```ts
fechamentoRoutes.post("/export-pdf", asyncHandler(exportClosingsPdfHandler));
```

- [ ] **Step 3: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 4: Client — hook, botão e tratamento de erro de Blob

**Files:**
- Modify: `src/client/pages/fechamento/useFechamentoQueries.ts`
- Modify: `src/client/pages/fechamento/FechamentoPage.tsx`

**Interfaces:**
- Consumes: `CloseBulkItem` (já existente), rota `POST /fechamento/export-pdf` (Task 3).
- Produces: `useExportClosingsPdf()` — consumido pelo próprio Task 4 (`FechamentoPage.tsx`).

- [ ] **Step 1: Adicionar o hook**

Em `useFechamentoQueries.ts`, logo abaixo de `useReopenClosingBulk`, adicionar:

```ts
export function useExportClosingsPdf() {
  return useMutation({
    mutationFn: async (items: CloseBulkItem[]) => {
      const { data } = await api.post<Blob>("/fechamento/export-pdf", { items }, { responseType: "blob" });
      return data;
    },
  });
}
```

- [ ] **Step 2: Importar o hook e `axios` em `FechamentoPage.tsx`**

Local atual:

```ts
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { EntityMultiPicker } from "@/pages/acompanhamento/EntityMultiPicker";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { useClosingsList, useCommercialPeriods, useReopenClosingBulk, useSaveClosingBulk, useSetCommercialPeriodStatus } from "./useFechamentoQueries";
import type { ClosingListFilters, ClosingListRow, ClosingStatus } from "./types";
```

Trocar para:

```ts
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { EntityMultiPicker } from "@/pages/acompanhamento/EntityMultiPicker";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import {
  useClosingsList,
  useCommercialPeriods,
  useExportClosingsPdf,
  useReopenClosingBulk,
  useSaveClosingBulk,
  useSetCommercialPeriodStatus,
} from "./useFechamentoQueries";
import type { ClosingListFilters, ClosingListRow, ClosingStatus } from "./types";
```

- [ ] **Step 3: Adicionar o helper de erro, o state e a função de exportar**

Logo abaixo de `firstDayOfCurrentMonthIso`/`lastDayOfCurrentMonthIso` (funções auxiliares já existentes no topo do arquivo), adicionar:

```ts
// api.post com responseType:"blob" faz o axios devolver o corpo do erro
// também como Blob (não parseado) — sem isso, um 409 do backend (ex.:
// Fechamento reaberto entre a seleção e o clique) apareceria como um erro
// genérico, escondendo a mensagem real que o backend já manda certinha.
async function extractPdfErrorMessage(error: unknown): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const text = await error.response.data.text();
      const parsed = JSON.parse(text) as { message?: string };
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // corpo do erro não era JSON — usa o fallback abaixo.
    }
  }
  return "Não foi possível exportar o PDF.";
}
```

Dentro do componente `FechamentoPage`, logo abaixo de `const bulkReopen = useReopenClosingBulk();` (adicionado na Parte E), adicionar:

```ts
  const exportPdf = useExportClosingsPdf();
  const [exportError, setExportError] = useState<string | null>(null);

  function exportSelected() {
    setExportError(null);
    exportPdf.mutate(selectedFechadoItems, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `fechamentos-${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      },
      onError: async (mutationError) => setExportError(await extractPdfErrorMessage(mutationError)),
    });
  }
```

- [ ] **Step 4: Adicionar o botão e a mensagem de erro no JSX**

Local atual (bloco de ações em massa, da Parte E):

```tsx
              {selectedFechadoItems.length > 0 && (
                <button
                  type="button"
                  disabled={bulkReopen.isPending}
                  onClick={reopenSelected}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
                >
                  {bulkReopen.isPending ? "Reabrindo..." : `Reabrir Selecionados (${selectedFechadoItems.length})`}
                </button>
              )}
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">
                Limpar seleção
              </button>
            </div>
          )}
        </div>
      )}
```

Trocar para:

```tsx
              {selectedFechadoItems.length > 0 && (
                <button
                  type="button"
                  disabled={bulkReopen.isPending}
                  onClick={reopenSelected}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
                >
                  {bulkReopen.isPending ? "Reabrindo..." : `Reabrir Selecionados (${selectedFechadoItems.length})`}
                </button>
              )}
              {selectedFechadoItems.length > 0 && (
                <button
                  type="button"
                  disabled={exportPdf.isPending}
                  onClick={exportSelected}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
                >
                  {exportPdf.isPending ? "Exportando..." : `Exportar Selecionados em PDF (${selectedFechadoItems.length})`}
                </button>
              )}
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">
                Limpar seleção
              </button>
            </div>
          )}
        </div>
      )}

      {exportError && <p className="text-sm text-destructive">{exportError}</p>}
```

- [ ] **Step 5: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 5: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 25`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Smoke test no navegador — exportação com sucesso**

Numa sessão isolada do `agent-browser`, logado como Admin, em "Fechamento", filtrar Maio/2026 (Empresa Inteira) e selecionar Alana Fonseca e Alberto Fonseca (ambos Fechados ao final do smoke da Parte E). Clicar em "Exportar Selecionados em PDF (2)" — confirmar que o download é disparado (o `agent-browser` deve reportar o arquivo baixado; se não houver um comando dedicado, verificar a pasta de downloads padrão da sessão/perfil usada pela ferramenta).

- [ ] **Step 2: Validar o arquivo baixado**

Confirmar que o arquivo baixado começa com a assinatura `%PDF` (primeiros 4 bytes) e tem tamanho maior que 0 — o suficiente para confirmar que é um PDF válido sem precisar renderizá-lo visualmente. Exemplo de checagem via linha de comando (ajustar o caminho pro arquivo baixado de fato):

```bash
head -c 4 "<caminho-do-arquivo-baixado>"
```

Expected: `%PDF`.

- [ ] **Step 3: Smoke test — mensagem de erro decodificada corretamente**

Reabrir 1 dos 2 Fechamentos recém-exportados (ex.: Alberto Fonseca) via `DELETE /fechamento/:memberId/:referenceMonth`, sem atualizar a tela (simulando o cenário de corrida "foi reaberto entre a seleção e o clique"). Clicar em "Exportar Selecionados em PDF" de novo com a mesma seleção antiga — confirmar que aparece a mensagem de erro específica ("O Fechamento de Alberto Fonseca não está mais salvo..."), não um erro genérico. Refechar o Fechamento de teste em seguida (`PUT /fechamento/:memberId/:referenceMonth` com approvals vazio) para devolver ao estado original.

- [ ] **Step 4: Limpeza**

Excluir o arquivo PDF de teste baixado (é só um artefato local do smoke, não precisa ser preservado). Fechar a sessão isolada do `agent-browser`. Confirmar que Alana e Alberto continuam com `status: FECHADO` (estado restaurado pelo Step 3).

- [ ] **Step 5: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 24`, um novo registro:

```markdown
### PASSO 25 (FEITO <data>) — Exportar Fechamentos em PDF

Pedido do usuário: parte G de um pedido de 4 partes (D, E, F já entregues — PASSOs 22-24) — última parte, fechando o pedido completo do dia. Exportar os Fechamentos Fechados selecionados na tela de Fechamento num único arquivo PDF: um Resumo Geral (1 linha por Fechamento) seguido do detalhamento completo de cada um, para o Gestor mandar pro RH.

**Abordagem técnica** (decidida em conversa com o usuário antes da spec): HTML renderizado no servidor → Puppeteer (Chromium headless) → PDF, em vez de uma lib de desenho manual (`pdfkit`) — CSS (`page-break-before`) cuida da paginação sozinho, muito menos código que posicionar texto/tabelas na mão, dado que o relatório replica basicamente as mesmas seções já existentes em `MemberClosingDetailPage.tsx`.

**Implementado**: `fechamento-pdf.service.ts` (novo) — `buildFechamentoPdfHtml` (função pura, TDD, 5 testes novos em `fechamento-pdf.service.test.ts`, escritos e confirmados falhando antes da implementação) monta o HTML completo sem nenhum I/O; `exportClosingsPdf` busca cada Fechamento via `getClosingDetail` já existente (permissão por Membro já validada ali), garante que todos estão `isSaved` (bloqueia com mensagem clara se algum foi reaberto entre a seleção e o clique), e renderiza via Puppeteer (`page.pdf()`, A4, margens). Rota nova `POST /fechamento/export-pdf`, reaproveitando o mesmo formato de item `{memberId, referenceMonth}` já usado em `/bulk-save`/`/bulk-reopen`. No client, novo botão "Exportar Selecionados em PDF (N)" reaproveita exatamente a mesma seleção `selectedFechadoItems` da Parte E — nenhuma lógica de seleção nova; o download é disparado via Blob + link temporário; erros do backend (que viajam como Blob por causa do `responseType: "blob"`) são decodificados de volta pra mensagem real via `extractPdfErrorMessage`.

**Nova dependência**: `puppeteer` (`npm install puppeteer`, Chromium próprio baixado com sucesso).

**Validação**: `tsc` (server+client) e `vitest` (117/117, +5 testes novos de `buildFechamentoPdfHtml`) limpos em cada task. Smoke real: exportação de 2 Fechamentos reais (Alana Fonseca e Alberto Fonseca, Maio/2026) gerou um PDF válido (assinatura `%PDF` confirmada); cenário de corrida (Fechamento reaberto entre seleção e clique) mostrou a mensagem de erro específica corretamente decodificada, não um erro genérico de Blob; estado original dos Membros de teste restaurado ao final.

**Fecha o pedido completo do usuário** (Partes D, E, F e G — PASSOs 22, 23, 24 e 25).

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
