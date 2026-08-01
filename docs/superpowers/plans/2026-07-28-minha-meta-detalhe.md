# Detalhe de Meta em "Minhas Metas" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao clicar num card em "Minhas Metas", abrir uma tela de detalhe somente-leitura com as mesmas informações que a tela de edição do Gestor mostra (período, Tipo de Resultado, entidade+hierarquia, motor, sazonalidades, status, valores, gráficos Mensal/Trimestral/Diário), sem nenhum controle de edição.

**Architecture:** Só frontend — os dois endpoints necessários (`GET /metas` e `GET /metas/:campaignId/linha/:entityType/:entityId`) já funcionam corretamente para autoatendimento (permissão já resolvida no backend). Nova página isolada `MyGoalLineDetailPage.tsx` (não reaproveita `GoalLineDetailPage.tsx` diretamente — evita misturar autoatendimento com os controles de edição do Gestor), nova rota, cards de `MinhasMetasTab.tsx` viram clicáveis, e `MetasPage.tsx` passa a guardar a aba ativa na URL para "Voltar" funcionar direito.

**Tech Stack:** React + TypeScript + Vite, React Router, TanStack Query, Recharts (via `GoalLinePeriodChart` já existente), Tailwind CSS.

## Global Constraints

- Nenhuma lógica de negócio nova — a tela só lê dados já calculados pelo backend (`getGoalLineDetail`/`listGoalCampaigns`), sem nenhuma mutation.
- Seguir o padrão já estabelecido no módulo: formatadores (`fmt`/`formatDate`/`monthLabel`/etc.) ficam locais ao arquivo, não em módulo compartilhado.
- `tsc` (client) precisa ficar limpo ao final de cada task que toca em `.tsx`.

---

## Task 1: `MetasPage.tsx` guarda a aba ativa na URL

**Files:**
- Modify: `src/client/pages/metas/MetasPage.tsx:42-47` (declaração de `activeTab`) e o bloco das abas (`onClick={() => setActiveTab(tab)}`, já existente, não muda de assinatura).

**Interfaces:**
- Produces: `setActiveTab(tab: "campanhas" | "minhas")` — mesma assinatura de hoje, mas agora também escreve `?tab=` na URL. Consumida pela Task 3 indiretamente (a nova página de detalhe navega para `/metas?tab=minhas`, que este Task faz `MetasPage` interpretar corretamente ao montar).

- [ ] **Step 1: Trocar a declaração de `activeTab` para ler o parâmetro `tab` da URL na inicialização, e escrever nele a cada troca**

Em `src/client/pages/metas/MetasPage.tsx`, dentro de `export function MetasPage() {`, substituir:

```tsx
  const tabs = (["campanhas", "minhas"] as const).filter((tab) => tab !== "campanhas" || canManage);
  const [activeTab, setActiveTab] = useState<"campanhas" | "minhas">(canManage ? "campanhas" : "minhas");
```

por:

```tsx
  const tabs = (["campanhas", "minhas"] as const).filter((tab) => tab !== "campanhas" || canManage);
  const [activeTab, setActiveTabState] = useState<"campanhas" | "minhas">(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "minhas") return "minhas";
    if (tabParam === "campanhas" && canManage) return "campanhas";
    return canManage ? "campanhas" : "minhas";
  });
```

Note que este novo bloco lê `searchParams`, que hoje só é declarado mais abaixo no componente (`const [searchParams, setSearchParams] = useSearchParams();`). Mova a linha `const [searchParams, setSearchParams] = useSearchParams();` (hoje logo antes de `const selectedId = searchParams.get("campaignId");`) para ANTES do bloco de `activeTab` acima — ou seja, a ordem das declarações dentro de `MetasPage()` passa a ser: `queryClient`, `role`, `canManage`, `tabs`, `searchParams`/`setSearchParams`, `activeTab` (com o inicializador acima), `selectedId`, o resto igual.

Logo depois da declaração de `activeTab`, adicionar a função wrapper (mesmo nome que o JSX das abas já chama, `setActiveTab` — não precisa mudar o JSX das abas):

```tsx
  function setActiveTab(tab: "campanhas" | "minhas") {
    setActiveTabState(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }
```

- [ ] **Step 2: Checar tipos**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

- [ ] **Step 3: Smoke manual rápido**

Com `npm run dev` rodando, abrir `/metas` como Admin, clicar na aba "Minhas Metas", conferir que a URL vira `/metas?tab=minhas`; recarregar a página (F5) e confirmar que a aba "Minhas Metas" continua selecionada (prova que a leitura do parâmetro na inicialização funciona).

---

## Task 2: `MyGoalLineDetailPage.tsx` — tela de detalhe somente-leitura

**Files:**
- Create: `src/client/pages/metas/MyGoalLineDetailPage.tsx`

**Interfaces:**
- Consumes: `GET /metas` (retorna `GoalCampaign[]`, tipo já exportado por `src/client/pages/metas/MetasPage.tsx`); `GET /metas/:campaignId/linha/:entityType/:entityId?lineId=` (mesmo endpoint que `GoalLineDetailPage.tsx` usa); `GoalLinePeriodChart` (`src/client/pages/metas/GoalLinePeriodChart.tsx`, props `{ title: string; data: ChartPoint[] }`, sem alteração); `type PeriodTotal` de `src/client/pages/metas/GoalLinesSection.tsx`; `type ScopeType` de `src/client/pages/bases-metas/ScopeSelector.tsx`.
- Produces: `export function MyGoalLineDetailPage()` — consumida pela Task 3 (rota nova em `routes/index.tsx`).

- [ ] **Step 1: Criar o arquivo**

Criar `src/client/pages/metas/MyGoalLineDetailPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { GoalCampaign } from "./MetasPage";
import type { PeriodTotal } from "./GoalLinesSection";
import { GoalLinePeriodChart, type ChartPoint } from "./GoalLinePeriodChart";

interface GroupSourceDetail {
  goalCampaignId: string;
  campaignName: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  currentTotal: string;
  hasActiveLine: boolean;
}

interface GoalLineDetail {
  lineId: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  engineType: "VALOR_ALVO_ANUAL" | "CRESCIMENTO_MENSAL" | "CRESCIMENTO_TRIMESTRAL" | "MANUAL" | "AGRUPAMENTO";
  seasonalityBaseId: string | null;
  seasonalityBaseName: string | null;
  dailySeasonalityBaseId: string | null;
  dailySeasonalityBaseName: string | null;
  growthRate: string | null;
  groupDiscountPercentage: string | null;
  grossTotal: string | null;
  inactivatedAt: string | null;
  isRecalculated: boolean;
  total: string;
  initialAmount: string;
  finalAmount: string;
  averageMonthly: string;
  growthInPeriod: string | null;
  monthly: PeriodTotal[];
  weekly: PeriodTotal[];
  quarterly: PeriodTotal[];
  daily: { date: string; value: string }[];
  groupSources: GroupSourceDetail[];
  // Não declarado na interface irmã de GoalLineDetailPage.tsx (nunca usado
  // lá), mas o backend já devolve (buildGoalLineRow inclui no spread) —
  // aqui é exibido como campo próprio.
  hierarchyPath: string | null;
}

const ENGINE_LABELS: Record<string, string> = {
  VALOR_ALVO_ANUAL: "Top-Down",
  CRESCIMENTO_MENSAL: "MCDS — Crescimento Mensal",
  CRESCIMENTO_TRIMESTRAL: "MCDS — Crescimento Trimestral",
  MANUAL: "Manual",
  AGRUPAMENTO: "Agrupamento de Metas",
};

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmt(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTH_LABELS[month - 1]}/${year}`;
}

function quarterLabel(key: string): string {
  const [year, quarter] = key.split("-T");
  return `T${quarter}/${year}`;
}

function dayLabel(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

// Versão somente-leitura de GoalLineDetailPage.tsx, para "Minhas Metas"
// (autoatendimento) — mesmos dados (mesmos 2 endpoints), sem nenhum
// controle de edição (sem Reativar/Desativar, sem grade mensal editável,
// sem formulário de Sazonalidade Diária, sem Reforecast). Arquivo isolado
// de propósito: reduz o risco de um usuário comum acabar vendo — ou
// acionando — um controle de edição por causa de uma condição esquecida.
export function MyGoalLineDetailPage() {
  const { campaignId, entityType, entityId } = useParams<{ campaignId: string; entityType: ScopeType; entityId: string }>();
  const [searchParams] = useSearchParams();
  const queryLineId = searchParams.get("lineId");
  const navigate = useNavigate();

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const { data: campaigns } = useQuery({
    queryKey: ["goal-campaigns"],
    queryFn: async () => {
      const { data } = await api.get<GoalCampaign[]>("/metas");
      return data;
    },
  });

  const campaign = campaigns?.find((c) => c.id === campaignId) ?? null;

  const { data: detail, isLoading } = useQuery({
    queryKey: ["my-goal-line-detail", campaignId, entityType, entityId, queryLineId],
    queryFn: async () => {
      const { data } = await api.get<GoalLineDetail>(`/metas/${campaignId}/linha/${entityType}/${entityId}`, {
        params: queryLineId ? { lineId: queryLineId } : undefined,
      });
      return data;
    },
    enabled: Boolean(campaignId && entityType && entityId),
  });

  const monthlyChartData: ChartPoint[] = useMemo(
    () => detail?.monthly.map((m) => ({ label: monthLabel(m.key), value: Number(m.value) })) ?? [],
    [detail],
  );

  const quarterlyChartData: ChartPoint[] = useMemo(
    () => detail?.quarterly.map((q) => ({ label: quarterLabel(q.key), value: Number(q.value) })) ?? [],
    [detail],
  );

  const monthOptions = detail?.monthly.map((m) => m.key) ?? [];
  const activeMonth = selectedMonth ?? monthOptions[0] ?? null;

  const dailyChartData: ChartPoint[] = useMemo(() => {
    if (!detail || !activeMonth) return [];
    return detail.daily
      .filter((d) => d.date.startsWith(activeMonth))
      .map((d) => ({ label: dayLabel(d.date), value: Number(d.value) }));
  }, [detail, activeMonth]);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const isAgrupamento = detail.engineType === "AGRUPAMENTO";

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate("/metas?tab=minhas")}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Voltar
      </button>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{detail.entityName}</h1>
          {detail.isRecalculated && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">Meta Recalculada</span>
          )}
          {detail.inactivatedAt ? (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
              Inativa desde {formatDate(detail.inactivatedAt)}
            </span>
          ) : (
            <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">Ativa</span>
          )}
        </div>
        {campaign && (
          <p className="text-sm text-muted-foreground">
            {campaign.name} · {LEVEL_LABELS[detail.entityType]}
            {detail.hierarchyPath ? ` (${detail.hierarchyPath})` : ""}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Tipo de Resultado</p>
          <p className="text-sm font-medium text-foreground">{campaign?.resultType.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Período de Vigência</p>
          <p className="text-sm font-medium text-foreground">
            {campaign ? `${formatDate(campaign.startDate)} – ${formatDate(campaign.endDate)}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sazonalidade Mensal</p>
          <p className="text-sm font-medium text-foreground">{detail.seasonalityBaseName ?? "Divisão igual (padrão)"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sazonalidade Diária</p>
          <p className="text-sm font-medium text-foreground">{detail.dailySeasonalityBaseName ?? "Divisão igual (padrão)"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <p className="text-xs text-muted-foreground">Motor de Cálculo</p>
          <p className="text-sm font-medium text-foreground">
            {ENGINE_LABELS[detail.engineType]}
            {isAgrupamento && Number(detail.groupDiscountPercentage) > 0
              ? ` (Deságio ${Number(detail.groupDiscountPercentage).toFixed(1)}%)`
              : ""}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Crescimento no Período</p>
          <p className="text-sm font-medium text-foreground">
            {detail.growthInPeriod !== null ? `${(Number(detail.growthInPeriod) * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Inicial</p>
          <p className="text-sm font-medium text-foreground">{fmt(detail.initialAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Final</p>
          <p className="text-sm font-medium text-foreground">{fmt(detail.finalAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Média Mensal</p>
          <p className="text-sm font-semibold text-foreground">{fmt(detail.averageMonthly)}</p>
        </div>
      </div>

      {isAgrupamento && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Origens do Agrupamento</h3>
          <p className="text-xs text-muted-foreground">
            Meta líquida = soma das Linhas abaixo (valor atual de cada uma) × (1 − Deságio). Bruto antes do Deságio:{" "}
            {fmt(detail.grossTotal)}.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="whitespace-nowrap px-3 py-1.5">Nível</th>
                  <th className="whitespace-nowrap px-3 py-1.5">Entidade</th>
                  <th className="whitespace-nowrap px-3 py-1.5">Campanha</th>
                  <th className="whitespace-nowrap px-3 py-1.5">Valor Atual</th>
                </tr>
              </thead>
              <tbody>
                {detail.groupSources.map((source) => (
                  <tr key={`${source.goalCampaignId}:${source.entityType}:${source.entityId}`} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{LEVEL_LABELS[source.entityType]}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {source.entityName}
                      {!source.hasActiveLine && (
                        <span className="ml-1.5 text-xs text-destructive">(sem Linha ativa — contando 0)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {source.campaignName}
                      {source.goalCampaignId === campaignId ? "" : " (outra campanha)"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">{fmt(source.currentTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GoalLinePeriodChart title="Mensal" data={monthlyChartData} />
        <GoalLinePeriodChart title="Trimestral" data={quarterlyChartData} />
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold text-foreground">Diário</h5>
          {monthOptions.length > 0 && (
            <select
              value={activeMonth ?? ""}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              {monthOptions.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                </option>
              ))}
            </select>
          )}
        </div>
        <GoalLinePeriodChart title={activeMonth ? monthLabel(activeMonth) : "Diário"} data={dailyChartData} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Checar tipos**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros. Se der erro em `bg-success`/`text-success`, o token `success` já existe no tema (confirmado nesta sessão em `tailwind.config.ts`/`globals.css`) — o erro seria de outra natureza, investigar antes de trocar a cor.

---

## Task 3: Rota nova + cards clicáveis em "Minhas Metas"

**Files:**
- Modify: `src/client/routes/index.tsx`
- Modify: `src/client/pages/metas/MinhasMetasTab.tsx`

**Interfaces:**
- Consumes: `MyGoalLineDetailPage` (Task 2, `src/client/pages/metas/MyGoalLineDetailPage.tsx`).

- [ ] **Step 1: Registrar a rota**

Em `src/client/routes/index.tsx`, adicionar o import (junto aos demais imports de `@/pages/metas`):

```tsx
import { MyGoalLineDetailPage } from "@/pages/metas/MyGoalLineDetailPage";
```

Adicionar a rota logo depois da rota irmã de edição (`/metas/:campaignId/linha/:entityType/:entityId`):

```tsx
      <Route
        path="/metas/minhas/:campaignId/linha/:entityType/:entityId"
        element={
          <RequireAuth>
            <MyGoalLineDetailPage />
          </RequireAuth>
        }
      />
```

- [ ] **Step 2: Tornar os cards de `MinhasMetasTab.tsx` clicáveis**

Em `src/client/pages/metas/MinhasMetasTab.tsx`, adicionar o import de `useNavigate` (topo do arquivo). Old:

```tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { ProgressBar } from "./ProgressBar";
```

New:

```tsx
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { ProgressBar } from "./ProgressBar";
```

Dentro de `export function MinhasMetasTab() {`, logo após `const ownMemberId = ...`, adicionar:

```tsx
  const navigate = useNavigate();
```

Tornar o card clicável. Old:

```tsx
        {lines?.map((line) => (
          <div key={line.goalLineId} className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{line.campaignName}</h3>
              <p className="text-xs text-muted-foreground">{line.resultTypeName}</p>
            </div>
```

New:

```tsx
        {lines?.map((line) => (
          <div
            key={line.goalLineId}
            onClick={() => navigate(`/metas/minhas/${line.goalCampaignId}/linha/MEMBRO/${ownMemberId}?lineId=${line.goalLineId}`)}
            className="cursor-pointer space-y-3 rounded-lg border border-border p-4 hover:bg-secondary/30"
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">{line.campaignName}</h3>
              <p className="text-xs text-muted-foreground">{line.resultTypeName}</p>
            </div>
```

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

Com `npm run server` (3333) e `npm run dev` (5173) rodando (reiniciar se não estiverem): login com um usuário Membro vinculado que tenha Linha de Meta em campanha vigente (mesmo dado real do seed já usado no PASSO 14 — Membro "Renan Rossin", `R.rossin@demo.com`, ou o Membro "Julio Turini" via usuário descartável vinculado temporariamente, mesmo procedimento já usado no PASSO 14 se a senha da conta real não estiver disponível). Ir em "Minhas Metas", clicar num card, confirmar:
- Navega para `/metas/minhas/<campaignId>/linha/MEMBRO/<memberId>?lineId=<lineId>`.
- Aparecem: Tipo de Resultado, Período de Vigência, Sazonalidade Mensal/Diária, Motor de Cálculo, Crescimento no Período, Valor Inicial/Final, Média Mensal, Hierarquia (se a Linha tiver — Membro sempre tem, mostra o caminho até o Canal).
- Gráficos Mensal, Trimestral e Diário (com seletor de mês) renderizam com barra + linha do acumulado.
- Nenhum botão de edição aparece em lugar nenhum (sem Reativar/Desativar, sem grade mensal editável, sem Sazonalidade Diária editável, sem Reforecast).
- "← Voltar" retorna para `/metas` com a aba "Minhas Metas" ainda selecionada.

Login como Admin/Gestor: confirmar que a aba "Campanhas" continua idêntica a antes (nenhuma regressão), e que trocar para "Minhas Metas" e voltar de qualquer navegação preserva a aba escolhida (valida a Task 1).

- [ ] **Step 3: Registrar no `.planosistemametas`**

Adicionar uma nova entrada `### PASSO 16 (FEITO 2026-07-28) — Detalhe de Meta em "Minhas Metas"` na seção "PRÓXIMOS PASSOS", resumindo: pedido do usuário (parte 1 de 3, as outras duas — deep-link Fechamento→Recebíveis e detalhe de Base com gráficos novos em Minhas Bases — ficam para specs seguintes), a descoberta de que nenhuma mudança de backend foi necessária, os arquivos novos/tocados, e o resultado da validação (tsc + navegador).
