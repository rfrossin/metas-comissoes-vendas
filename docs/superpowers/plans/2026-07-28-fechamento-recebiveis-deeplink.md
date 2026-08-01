# Deep-link Fechamento → Recebíveis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicar numa "caixa de Recebível" (Campanha) dentro do Fechamento de um Membro navega para a tela de Recebíveis já com o filtro de Período/Entidade preenchido para aquela caixa e a linha correspondente destacada + com scroll automático na tabela "Ganho por Meta".

**Architecture:** Só frontend — `RecebiveisPage.tsx` já filtra 100% via parâmetros de URL, então o deep-link é só montar essa URL a partir dos dados que `CampaignCard` (`MemberClosingDetailPage.tsx`) já tem. Dois parâmetros novos de URL (`highlightBaseId`/`highlightPeriodStart`) fluem até `GanhoPorMetaTable.tsx`, que aplica um destaque visual condicional na linha certa.

**Tech Stack:** React + TypeScript + Vite, React Router (`useSearchParams`/`useNavigate`), Tailwind CSS.

## Global Constraints

- Nenhuma mudança de backend — só navegação, leitura de URL e destaque visual condicional.
- A tela de Recebíveis é sempre ao vivo (recalculada para o período pedido) — o deep-link não tenta reproduzir o valor exato congelado no Fechamento, só preenche o filtro. Isso já é o comportamento de hoje para qualquer período passado filtrado manualmente.
- `tsc` (client) precisa ficar limpo ao final de cada task.

---

## Task 1: `GanhoPorMetaTable.tsx` — destaque visual condicional + scroll automático

**Files:**
- Modify: `src/client/pages/recebiveis/GanhoPorMetaTable.tsx` (reescrita completa — arquivo pequeno, ~80 linhas)

**Interfaces:**
- Produces: `GanhoPorMetaTable({ rows, highlightBaseId, highlightPeriodStart }: { rows: GanhoPorMetaRow[]; highlightBaseId?: string | null; highlightPeriodStart?: string | null })` — os 2 props novos são opcionais; sem eles, comportamento idêntico ao de hoje (nenhuma linha destacada, sem scroll). Consumida pela Task 2.

- [ ] **Step 1: Reescrever o arquivo com os 2 props novos e o destaque condicional**

Substituir todo o conteúdo de `src/client/pages/recebiveis/GanhoPorMetaTable.tsx` por:

```tsx
import { useEffect, useRef } from "react";
import type { GanhoPorMetaRow, WindowStatus } from "./types";

const STATUS_LABELS: Record<WindowStatus, string> = { FECHADO: "Fechado", LIBERADO: "Liberado", PREVISTO: "Previsto" };
const STATUS_CLASSES: Record<WindowStatus, string> = {
  FECHADO: "bg-primary/10 text-primary",
  LIBERADO: "bg-success/10 text-success",
  PREVISTO: "border border-dashed border-muted-foreground/40 text-muted-foreground",
};

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPercentOrValue(value: string, indicatorType: "META" | "RESULTADO"): string {
  const n = Number(value);
  return indicatorType === "META" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatWindow(periodStart: string, periodEndExclusive: string): string {
  const start = new Date(`${periodStart}T00:00:00.000Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const endInclusive = new Date(new Date(`${periodEndExclusive}T00:00:00.000Z`).getTime() - 86400000).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return `${start} – ${endInclusive}`;
}

// Ganho por Meta (Visão Vendedor, spec § Recebíveis/2) — 1 linha por (Base,
// janela) dentro do Período filtrado. Previsto é exibido (transparência
// total, spec §4) mas não conta nos totais oficiais da tela.
//
// highlightBaseId/highlightPeriodStart (opcionais): vêm do deep-link de
// Fechamento → Recebíveis (CampaignCard, MemberClosingDetailPage.tsx) — a
// linha que bate ganha destaque visual e a tabela rola até ela ao montar.
export function GanhoPorMetaTable({
  rows,
  highlightBaseId,
  highlightPeriodStart,
}: {
  rows: GanhoPorMetaRow[];
  highlightBaseId?: string | null;
  highlightPeriodStart?: string | null;
}) {
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightBaseId, highlightPeriodStart]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma Base de Recebível aplicável neste período.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="px-3 py-1.5">Meta / Indicador</th>
            <th className="px-3 py-1.5">Período</th>
            <th className="px-3 py-1.5">Status</th>
            <th className="px-3 py-1.5">Atingimento</th>
            <th className="px-3 py-1.5">Gatilho Atual</th>
            <th className="px-3 py-1.5">Ganho (R$)</th>
            <th className="px-3 py-1.5">Próximo Degrau</th>
            <th className="px-3 py-1.5">Ganho Potencial (R$)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isHighlighted =
              !!highlightBaseId &&
              !!highlightPeriodStart &&
              row.receivablesBaseId === highlightBaseId &&
              row.periodStart.slice(0, 10) === highlightPeriodStart;
            return (
              <tr
                key={`${row.receivablesBaseId}-${row.periodStart}-${index}`}
                ref={isHighlighted ? highlightedRowRef : undefined}
                className={`border-t border-border ${isHighlighted ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
              >
                <td className="px-3 py-1.5">
                  <div className="font-medium text-foreground">{row.baseName}</div>
                  <div className="text-xs text-muted-foreground">{row.indicatorLabel}</div>
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{formatWindow(row.periodStart, row.periodEndExclusive)}</td>
                <td className="px-3 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}>{STATUS_LABELS[row.status]}</span>
                </td>
                <td className="px-3 py-1.5">{fmtPercentOrValue(row.attainmentValue, row.indicatorType)}</td>
                <td className="px-3 py-1.5">
                  {row.currentTierLabel ?? "—"}
                  {!row.eligible && <p className="text-xs text-destructive">{row.blockedReason}</p>}
                </td>
                <td className="px-3 py-1.5 font-medium text-foreground">
                  {row.eligible ? fmtCurrency(row.payoutValue) : "R$ 0,00"}
                  {row.physicalPrizeDescription && <p className="text-xs text-muted-foreground">{row.physicalPrizeDescription}</p>}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {row.nextTierGap && Number(row.nextTierGap) > 0 ? `Faltam ${fmtPercentOrValue(row.nextTierGap, row.indicatorType)}` : "No topo"}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.nextTierPotentialPayout ? fmtCurrency(row.nextTierPotentialPayout) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Checar tipos**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: erro esperado nesta task isolada — `RecebiveisPage.tsx` ainda chama `<GanhoPorMetaTable rows={...} />` sem os 2 props novos, mas como eles são opcionais (`?:`), NÃO deve dar erro de tipo. Se não der erro nenhum, ok seguir; se dermos erro em outro arquivo não relacionado, investigar antes de continuar.

---

## Task 2: `RecebiveisPage.tsx` lê os parâmetros de destaque e repassa

**Files:**
- Modify: `src/client/pages/recebiveis/RecebiveisPage.tsx:65-71` (declaração de `periodStart`/`periodEnd`/`filters`) e `:161-165` (renderização de `GanhoPorMetaTable`)

**Interfaces:**
- Consumes: `GanhoPorMetaTable` com os props novos (Task 1).

- [ ] **Step 1: Ler os 2 parâmetros novos da URL**

Em `src/client/pages/recebiveis/RecebiveisPage.tsx`, logo após a linha `const periodEnd = searchParams.get("periodEnd") || lastDayOfCurrentMonthIso();`, adicionar:

```tsx
  const highlightBaseId = searchParams.get("highlightBaseId");
  const highlightPeriodStart = searchParams.get("highlightPeriodStart");
```

- [ ] **Step 2: Repassar para `GanhoPorMetaTable`**

Old:
```tsx
            {overview.table.kind === "GANHO_POR_META" ? (
              <GanhoPorMetaTable rows={overview.table.rows} />
            ) : (
```

New:
```tsx
            {overview.table.kind === "GANHO_POR_META" ? (
              <GanhoPorMetaTable
                rows={overview.table.rows}
                highlightBaseId={highlightBaseId}
                highlightPeriodStart={highlightPeriodStart}
              />
            ) : (
```

- [ ] **Step 3: Checar tipos**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 3: `CampaignCard` (Fechamento) vira clicável e monta o deep-link

**Files:**
- Modify: `src/client/pages/fechamento/MemberClosingDetailPage.tsx:51-124` (função `CampaignCard`) e `:276-287` (chamada dentro de `MemberClosingDetailPage`)

**Interfaces:**
- Consumes: rota `/recebiveis` já aceita os parâmetros `entityType`/`entityIds`/`periodStart`/`periodEnd`/`highlightBaseId`/`highlightPeriodStart` (Task 2).
- Produces: `CampaignCard` ganha o prop `onOpenRecebiveis: () => void`.

- [ ] **Step 1: `CampaignCard` ganha o prop `onOpenRecebiveis` e o bloco de título vira clicável**

Old:
```tsx
function CampaignCard({
  campaign,
  approvalStatus,
  disabled,
  onToggleApproval,
}: {
  campaign: ClosingCampaignRow;
  approvalStatus: BenefitApprovalStatus;
  disabled: boolean;
  onToggleApproval: (status: BenefitApprovalStatus) => void;
}) {
  return (
    <div className={`space-y-2 rounded-md border border-border p-3 ${campaignColorClass(approvalStatus, campaign.payoutValue)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{campaign.baseName}</p>
          <p className="text-xs text-muted-foreground">
            {campaign.indicatorLabel} — {campaign.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"} — {formatDate(campaign.periodStart)} a{" "}
            {formatDate(new Date(new Date(campaign.periodEndExclusive).getTime() - 86400000).toISOString())}
          </p>
        </div>
```

New:
```tsx
function CampaignCard({
  campaign,
  approvalStatus,
  disabled,
  onToggleApproval,
  onOpenRecebiveis,
}: {
  campaign: ClosingCampaignRow;
  approvalStatus: BenefitApprovalStatus;
  disabled: boolean;
  onToggleApproval: (status: BenefitApprovalStatus) => void;
  onOpenRecebiveis: () => void;
}) {
  return (
    <div className={`space-y-2 rounded-md border border-border p-3 ${campaignColorClass(approvalStatus, campaign.payoutValue)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div onClick={onOpenRecebiveis} className="cursor-pointer hover:underline" title="Ver em Recebíveis">
          <p className="text-sm font-medium text-foreground">{campaign.baseName}</p>
          <p className="text-xs text-muted-foreground">
            {campaign.indicatorLabel} — {campaign.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"} — {formatDate(campaign.periodStart)} a{" "}
            {formatDate(new Date(new Date(campaign.periodEndExclusive).getTime() - 86400000).toISOString())}
          </p>
        </div>
```

Note: só o bloco de título (nome da Base + linha de indicador/período) vira clicável — não o card inteiro. Isso evita qualquer conflito com os botões "Aprovar"/"Reprovar" (mais abaixo no mesmo card, sem mudança) e com seleção de texto nos detalhes.

- [ ] **Step 2: Montar a URL do deep-link no ponto de chamada**

Old:
```tsx
        {detail.campaigns.map((campaign) => {
          const key = campaignRowKey(campaign.receivablesBaseId, campaign.periodStart);
          return (
            <CampaignCard
              key={key}
              campaign={campaign}
              approvalStatus={approvals[key] ?? "APROVADO"}
              disabled={isLocked || isReadOnly}
              onToggleApproval={(status) => setApprovals((prev) => ({ ...prev, [key]: status }))}
            />
          );
        })}
```

New:
```tsx
        {detail.campaigns.map((campaign) => {
          const key = campaignRowKey(campaign.receivablesBaseId, campaign.periodStart);
          return (
            <CampaignCard
              key={key}
              campaign={campaign}
              approvalStatus={approvals[key] ?? "APROVADO"}
              disabled={isLocked || isReadOnly}
              onToggleApproval={(status) => setApprovals((prev) => ({ ...prev, [key]: status }))}
              onOpenRecebiveis={() => {
                const periodStart = campaign.periodStart.slice(0, 10);
                const periodEnd = new Date(new Date(campaign.periodEndExclusive).getTime() - 86400000).toISOString().slice(0, 10);
                const params = new URLSearchParams({
                  entityType: "MEMBRO",
                  entityIds: memberId ?? "",
                  periodStart,
                  periodEnd,
                  highlightBaseId: campaign.receivablesBaseId,
                  highlightPeriodStart: periodStart,
                });
                navigate(`/recebiveis?${params.toString()}`);
              }}
            />
          );
        })}
```

`memberId` (de `useParams`) e `navigate` (de `useNavigate`) já existem no topo de `MemberClosingDetailPage()` — não precisa de nenhum import novo.

- [ ] **Step 3: Checar tipos**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 4: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas`

- [ ] **Step 1: `tsc` completo do client**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

- [ ] **Step 2: Smoke test no navegador**

Com `npm run server` (3333) e `npm run dev` (5173) rodando (reiniciar se não estiverem): usar um Membro real com Fechamento existente e pelo menos 1 Campanha de Recebível vinculada (dado real do seed, já usado nas partes anteriores — ex. Membro "Renan Rossin"/`R.rossin@demo.com`, ou via usuário descartável vinculado temporariamente ao Membro se a senha da conta real não estiver disponível, mesmo procedimento já usado nos PASSOs 14/16).

1. Login como o próprio Usuário (ou vinculado ao Membro do fechamento) → ir em Fechamento → abrir o próprio mês → clicar no título de uma caixa de Recebível. Confirmar: navega para `/recebiveis?entityType=MEMBRO&entityIds=...&periodStart=...&periodEnd=...&highlightBaseId=...&highlightPeriodStart=...`; a tela carrega já com aquele período; a linha correspondente na tabela "Ganho por Meta" aparece destacada (fundo/borda) e a página rola até ela.
2. Login como Admin → Fechamento → abrir o mês de OUTRO Membro → clicar numa caixa. Confirmar que o deep-link usa o `memberId` daquele Membro (não o do Admin) e o filtro de Recebíveis reflete isso corretamente.
3. Confirmar que os botões "Aprovar"/"Reprovar" continuam funcionando normalmente (não disparam a navegação por engano).

- [ ] **Step 3: Registrar no `.planosistemametas`**

Adicionar uma nova entrada `### PASSO 17 (FEITO 2026-07-28) — Deep-link Fechamento → Recebíveis` na seção "PRÓXIMOS PASSOS", resumindo: pedido do usuário (parte 2 de 3, parte 1 já no PASSO 16, parte 3 ainda pendente), a mecânica do deep-link (URL de `RecebiveisPage.tsx` já era 100% parametrizada), o destaque visual novo em `GanhoPorMetaTable.tsx`, e o resultado da validação (tsc + navegador, papel próprio e papel Admin vendo outro Membro).
