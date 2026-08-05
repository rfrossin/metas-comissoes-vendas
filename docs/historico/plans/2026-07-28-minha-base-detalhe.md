# Detalhe de Base em "Minhas Bases" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao clicar num card em "Minhas Bases", abrir uma tela de detalhe com cabeçalho/Gatilhos/Degraus/Simulador (tudo reaproveitado) mais 2 gráficos novos — "quanto seria preciso fazer" por período pra bater cada Degrau (coluna empilhada) e cada Gatilho Condicional (barra), sempre em modo simulado, nunca comparando com Realizado.

**Architecture:** Backend novo (endpoint + função de serviço), reaproveitando ao máximo `fetchReceivablesBaseDetail`/`dailyMapOfActiveLine`/`sumDailyMapInWindow`/`enumeratePeriodWindows`/`resolveMemberLevelEntity`/`triggerAppliesToMember` já existentes. Frontend novo (página + 2 componentes de gráfico), reaproveitando `MySimulatorModal` sem alteração.

**Tech Stack:** Node/Express/TypeScript, Prisma, `Prisma.Decimal`, Vitest, React/Vite/TypeScript, TanStack Query, Recharts, Tailwind CSS.

## Global Constraints

- **Ambiente 100% simulado**: os gráficos e a lista de Gatilhos/Degraus desta tela NUNCA leem Resultado Realizado — só a configuração da Base convertida em valor-alvo por período. Nenhuma chamada a `getRealizadoDailyMap`/`computeLiveReceivablesOutcome` nesta funcionalidade.
- `companyId` explícito em toda query Prisma (multi-tenancy).
- Nenhum float solto — sempre `Prisma.Decimal`, serializado como `string` nas respostas HTTP.
- Rodar `npx vitest run --pool=forks --poolOptions.forks.singleFork=true` após mexer no service.
- `tsc` (client e/ou server, conforme a task) precisa ficar limpo ao final de cada task.

---

## Task 1: Funções puras — conversão de limiar em valor-alvo + paginação por período

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts` (adicionar no fim do arquivo)
- Test: `src/server/services/bases-recebiveis.service.test.ts` (adicionar no fim do arquivo)

**Interfaces:**
- Produces: `export function computeRequiredValue(indicatorType: ReceivablesIndicatorType, thresholdOrMinimum: Prisma.Decimal, referenceTotalForWindow: Prisma.Decimal): Prisma.Decimal`; `export interface ReceivablesBasePageResult { periodWindows: PeriodWindow[]; pagination: { offset: number; hasPrev: boolean; hasNext: boolean } | null }`; `export function resolveReceivablesBasePage(periodicity: ReceivablesPeriodicity, rangeStart: Date, rangeEndExclusive: Date, page: number): ReceivablesBasePageResult`. Consumidas pela Task 2.

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao fim de `src/server/services/bases-recebiveis.service.test.ts`:

```ts
import { computeRequiredValue, resolveReceivablesBasePage } from "./bases-recebiveis.service";

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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true bases-recebiveis.service.test.ts
```
Expected: FAIL — `computeRequiredValue`/`resolveReceivablesBasePage` não existem ainda.

- [ ] **Step 3: Implementar**

Adicionar ao fim de `src/server/services/bases-recebiveis.service.ts`:

```ts
// ============================================================
// Minhas Bases — Detalhe (autoatendimento, ambiente SIMULADO): nunca lê
// Realizado, só converte os limiares (Gatilhos/Degraus) em valor-alvo por
// período de fechamento. Na trilha META o limiar é um percentual — o valor
// absoluto exigido muda de período pra período porque a Meta de referência
// tem sazonalidade; na trilha RESULTADO o limiar já é um valor absoluto,
// constante em todo período (comportamento esperado, confirmado pelo
// usuário).
// ============================================================

export function computeRequiredValue(
  indicatorType: ReceivablesIndicatorType,
  thresholdOrMinimum: Prisma.Decimal,
  referenceTotalForWindow: Prisma.Decimal,
): Prisma.Decimal {
  if (indicatorType === "RESULTADO") return thresholdOrMinimum;
  return thresholdOrMinimum.dividedBy(100).times(referenceTotalForWindow);
}

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Mesmo padrão de monthWindow (acompanhamento.service.ts), duplicado
// localmente (convenção já usada no projeto para helpers pequenos de data).
function monthPageWindow(referenceStart: Date, monthOffset: number): PeriodWindow {
  const start = new Date(Date.UTC(referenceStart.getUTCFullYear(), referenceStart.getUTCMonth() + monthOffset, 1));
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, endExclusive };
}

function twelveMonthPageWindow(referenceStart: Date, blockOffset: number): PeriodWindow {
  const start = new Date(Date.UTC(referenceStart.getUTCFullYear(), referenceStart.getUTCMonth() + blockOffset * 12, 1));
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 1));
  return { start, endExclusive };
}

function totalMonthsBetween(start: Date, endExclusive: Date): number {
  const endInclusive = addDaysUtc(endExclusive, -1);
  return (endInclusive.getUTCFullYear() - start.getUTCFullYear()) * 12 + (endInclusive.getUTCMonth() - start.getUTCMonth()) + 1;
}

export interface ReceivablesBasePageResult {
  periodWindows: PeriodWindow[];
  pagination: { offset: number; hasPrev: boolean; hasNext: boolean } | null;
}

// Diário/Semanal sempre paginam por mês civil (mesmo padrão de Acompanhamento
// pra granularidade Dia/Semana). Mensal/Trimestral/Anual só paginam (em
// blocos de 12 meses) se o total de janelas passar de 12; senão devolvem
// tudo numa página só (pagination null).
export function resolveReceivablesBasePage(
  periodicity: ReceivablesPeriodicity,
  rangeStart: Date,
  rangeEndExclusive: Date,
  page: number,
): ReceivablesBasePageResult {
  if (rangeStart >= rangeEndExclusive) return { periodWindows: [], pagination: null };

  const isDailyOrWeekly = periodicity === "DIARIO" || periodicity === "SEMANAL";
  const totalMonths = Math.max(totalMonthsBetween(rangeStart, rangeEndExclusive), 1);

  function clip(window: PeriodWindow): PeriodWindow {
    const start = window.start < rangeStart ? rangeStart : window.start;
    const endExclusive = window.endExclusive > rangeEndExclusive ? rangeEndExclusive : window.endExclusive;
    return { start, endExclusive };
  }

  if (isDailyOrWeekly) {
    const clampedOffset = Math.min(Math.max(page, 0), totalMonths - 1);
    const clipped = clip(monthPageWindow(rangeStart, clampedOffset));
    return {
      periodWindows: enumeratePeriodWindows(periodicity, clipped.start, clipped.endExclusive),
      pagination: { offset: clampedOffset, hasPrev: clampedOffset > 0, hasNext: clampedOffset < totalMonths - 1 },
    };
  }

  const allWindows = enumeratePeriodWindows(periodicity, rangeStart, rangeEndExclusive);
  if (allWindows.length <= 12) {
    return { periodWindows: allWindows, pagination: null };
  }

  const totalBlocks = Math.max(Math.ceil(totalMonths / 12), 1);
  const clampedOffset = Math.min(Math.max(page, 0), totalBlocks - 1);
  const clipped = clip(twelveMonthPageWindow(rangeStart, clampedOffset));
  return {
    periodWindows: enumeratePeriodWindows(periodicity, clipped.start, clipped.endExclusive),
    pagination: { offset: clampedOffset, hasPrev: clampedOffset > 0, hasNext: clampedOffset < totalBlocks - 1 },
  };
}
```

`toUtcDateOnly` fica sem uso nesta task (será usado na Task 2) — não remover, `tsc` não acusa função exportada sem uso (só variável local); como é `function` de nível de módulo (não exportada), rodar o Step 4 já confirma se sobra algum aviso.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true bases-recebiveis.service.test.ts
```
Expected: PASS (todos, incluindo os novos).

- [ ] **Step 5: `tsc` do server**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.server.json --noEmit
```
Expected: sem erros. Se `toUtcDateOnly` acusar "declared but never read", é porque a Task 2 ainda não foi feita — normal nesta task isolada, sem problema (função de módulo não é flagada como erro em `tsc`, só potencialmente por lint; não rodar lint aqui).

---

## Task 2: `getMyReceivablesBaseDetail` — orquestração + controller + rota

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts` (adicionar no fim)
- Modify: `src/server/controllers/bases-recebiveis.controller.ts`
- Modify: `src/server/routes/bases-recebiveis.routes.ts`

**Interfaces:**
- Consumes: `computeRequiredValue`, `resolveReceivablesBasePage` (Task 1); `fetchReceivablesBaseDetail`, `dailyMapOfActiveLine`, `sumDailyMapInWindow`, `resolveMemberLevelEntity`, `triggerAppliesToMember`, `resolveRequesterMemberId` (já existem).
- Produces: `export async function getMyReceivablesBaseDetail(companyId: string, requestingUser: RequestingUser, baseId: string, page?: number): Promise<MyReceivablesBaseDetailResponse>`. Consumida pelo controller (Task 2) e pela Task 3 (tipos do client espelham este shape).

- [ ] **Step 1: Implementar a função de serviço**

Adicionar ao fim de `src/server/services/bases-recebiveis.service.ts`:

```ts
export interface MyReceivablesBaseDetailResponse {
  id: string;
  name: string;
  indicatorType: ReceivablesIndicatorType;
  goalOrResultLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: Date | null;
  endDate: Date | null;
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  conditionalTriggers: {
    id: string;
    label: string;
    verificationLevel: OrgScopeType;
    indicatorType: ReceivablesIndicatorType;
    requiredMinimum: Prisma.Decimal;
  }[];
  tierLadder: {
    order: number;
    thresholdValue: Prisma.Decimal;
    rules: {
      rewardType: RewardType;
      rewardResultTypeName: string | null;
      rewardPercentage: Prisma.Decimal | null;
      rewardFixedValue: Prisma.Decimal | null;
      rewardDescription: string | null;
    }[];
  }[];
  tierPeriods: { periodStart: Date; periodEndExclusive: Date; tiers: { order: number; requiredValue: Prisma.Decimal }[] }[];
  triggerSeries: {
    triggerId: string;
    label: string;
    points: { periodStart: Date; periodEndExclusive: Date; requiredValue: Prisma.Decimal }[];
  }[];
  pagination: { offset: number; hasPrev: boolean; hasNext: boolean } | null;
}

export async function getMyReceivablesBaseDetail(
  companyId: string,
  requestingUser: RequestingUser,
  baseId: string,
  page = 0,
): Promise<MyReceivablesBaseDetailResponse> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) throw new NotFoundError("Base de Recebível não encontrada");

  const base = await fetchReceivablesBaseDetail(companyId, baseId);
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Base de Recebível não encontrada");

  const goalOrResultLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");

  const applicableTriggers = base.conditionalTriggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));
  const conditionalTriggers = applicableTriggers.map((trigger) => ({
    id: trigger.id,
    label: trigger.indicatorType === "META" ? (trigger.conditionalGoal?.name ?? "—") : (trigger.resultType?.name ?? "—"),
    verificationLevel: trigger.verificationLevel,
    indicatorType: trigger.indicatorType,
    requiredMinimum:
      trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0)),
  }));

  const tierLadder = base.valueTiers.map((tier) => ({
    order: tier.order,
    thresholdValue: tier.thresholdValue,
    rules: base.tierRules
      .filter((rule) => rule.valueTierId === tier.id)
      .map((rule) => ({
        rewardType: rule.rewardType,
        rewardResultTypeName: rule.rewardResultType?.name ?? null,
        rewardPercentage: rule.rewardPercentage,
        rewardFixedValue: rule.rewardFixedValue,
        rewardDescription: rule.rewardDescription,
      })),
  }));

  const rangeStart = base.startDate ?? toUtcDateOnly(base.createdAt);
  const today = toUtcDateOnly(new Date());
  const tomorrow = addDaysUtc(today, 1);
  const vigenciaEndExclusive = base.endDate ? addDaysUtc(base.endDate, 1) : tomorrow;
  const rangeEndExclusive = vigenciaEndExclusive < tomorrow ? vigenciaEndExclusive : tomorrow;

  const { periodWindows, pagination } = resolveReceivablesBasePage(base.periodicity, rangeStart, rangeEndExclusive, page);

  const tierPeriods: MyReceivablesBaseDetailResponse["tierPeriods"] = [];
  const triggerPointsByTriggerId = new Map<string, MyReceivablesBaseDetailResponse["triggerSeries"][number]["points"]>(
    applicableTriggers.map((trigger) => [trigger.id, []]),
  );

  for (const window of periodWindows) {
    let metaTotal = new Prisma.Decimal(0);
    if (base.indicatorType === "META" && base.primaryGoalCampaignId) {
      const daily = await dailyMapOfActiveLine(companyId, base.primaryGoalCampaignId, beneficiary.entityType, beneficiary.entityId);
      metaTotal = sumDailyMapInWindow(daily, window);
    }
    const tiers = base.valueTiers.map((tier) => ({
      order: tier.order,
      requiredValue: computeRequiredValue(base.indicatorType, tier.thresholdValue, metaTotal),
    }));
    tierPeriods.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, tiers });

    for (const trigger of applicableTriggers) {
      let conditionalTotal = new Prisma.Decimal(0);
      if (trigger.indicatorType === "META" && trigger.conditionalGoalCampaignId) {
        const conditionEntityId = await resolveMemberLevelEntity(companyId, memberId, trigger.verificationLevel);
        if (conditionEntityId) {
          const daily = await dailyMapOfActiveLine(companyId, trigger.conditionalGoalCampaignId, trigger.verificationLevel, conditionEntityId);
          conditionalTotal = sumDailyMapInWindow(daily, window);
        }
      }
      const requiredMinimum =
        trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0));
      const requiredValue = computeRequiredValue(trigger.indicatorType, requiredMinimum, conditionalTotal);
      triggerPointsByTriggerId.get(trigger.id)?.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, requiredValue });
    }
  }

  const triggerSeries = conditionalTriggers.map((trigger) => ({
    triggerId: trigger.id,
    label: trigger.label,
    points: triggerPointsByTriggerId.get(trigger.id) ?? [],
  }));

  return {
    id: base.id,
    name: base.name,
    indicatorType: base.indicatorType,
    goalOrResultLabel,
    periodicity: base.periodicity,
    triggerMode: base.triggerMode,
    startDate: base.startDate,
    endDate: base.endDate,
    entityType: beneficiary.entityType,
    entityId: beneficiary.entityId,
    entityName: beneficiary.entityName,
    conditionalTriggers,
    tierLadder,
    tierPeriods,
    triggerSeries,
    pagination,
  };
}
```

- [ ] **Step 2: Controller**

Em `src/server/controllers/bases-recebiveis.controller.ts`, adicionar `getMyReceivablesBaseDetail` à lista de imports de `../services/bases-recebiveis.service` (ordem alfabética, junto aos demais):

```ts
  getMyReceivablesBaseDetail,
```

O arquivo já tem um helper privado `respondToError(error, res)` (traduz `NotFoundError`/`ConflictError`/`ForbiddenError` pros status HTTP certos) usado por todos os handlers existentes — reaproveitar em vez de duplicar a tradução de erro. Adicionar o handler logo após `listMyReceivablesBasesHandler`:

```ts
export async function getMyReceivablesBaseDetailHandler(req: Request, res: Response) {
  const page = req.query.page ? Number(req.query.page) : 0;
  try {
    const detail = await getMyReceivablesBaseDetail(req.user!.companyId, req.user!, req.params.id, Number.isFinite(page) ? page : 0);
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}
```

- [ ] **Step 3: Rota**

Em `src/server/routes/bases-recebiveis.routes.ts`, adicionar `getMyReceivablesBaseDetailHandler` ao import do controller, e a rota logo após `GET /minhas`:

```ts
basesRecebiveisRoutes.get("/minhas/:id/graficos", asyncHandler(getMyReceivablesBaseDetailHandler));
```

(Como tem 3 segmentos de path, não colide com `GET /:id`, de 1 segmento — mas mantém o agrupamento das rotas de autoatendimento junto de `GET /minhas`.)

- [ ] **Step 4: `tsc` do server + suíte completa**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.server.json --noEmit
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```
Expected: sem erros; todos os testes (existentes + novos da Task 1) passam.

- [ ] **Step 5: Smoke via serviço direto contra dado real**

Com o servidor rodando (ou via script `tsx` direto, mesmo padrão já usado nesta sessão para as partes 1/2): chamar `getMyReceivablesBaseDetail` para um Membro real Beneficiário de uma Base trilha META com Sazonalidade — confirmar que `tierPeriods` tem valores de `requiredValue` DIFERENTES entre períodos (prova que a sazonalidade da Meta está sendo aplicada). Para uma Base trilha RESULTADO, confirmar que os valores são IGUAIS em todos os períodos (comportamento esperado, não um bug).

---

## Task 3: Tipos e hook no client

**Files:**
- Modify: `src/client/pages/bases-recebiveis/types.ts`
- Modify: `src/client/pages/bases-recebiveis/useReceivablesQueries.ts`

**Interfaces:**
- Produces: `export interface MyReceivablesBaseDetail` (tipos client); `export function useMyReceivablesBaseDetail(id: string | null, page: number)`. Consumidos pela Task 5.

- [ ] **Step 1: Adicionar os tipos**

Adicionar ao fim de `src/client/pages/bases-recebiveis/types.ts`:

```ts
export interface MyConditionalTriggerInfo {
  id: string;
  label: string;
  verificationLevel: ScopeType;
  indicatorType: IndicatorType;
  requiredMinimum: string;
}

export interface MyTierRuleInfo {
  rewardType: RewardType;
  rewardResultTypeName: string | null;
  rewardPercentage: string | null;
  rewardFixedValue: string | null;
  rewardDescription: string | null;
}

export interface MyTierLadderRung {
  order: number;
  thresholdValue: string;
  rules: MyTierRuleInfo[];
}

export interface TierPeriodTarget {
  periodStart: string;
  periodEndExclusive: string;
  tiers: { order: number; requiredValue: string }[];
}

export interface TriggerSeriesPoint {
  periodStart: string;
  periodEndExclusive: string;
  requiredValue: string;
}

export interface TriggerSeries {
  triggerId: string;
  label: string;
  points: TriggerSeriesPoint[];
}

export interface ReceivablesBasePagination {
  offset: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface MyReceivablesBaseDetail {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  goalOrResultLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: string | null;
  endDate: string | null;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  conditionalTriggers: MyConditionalTriggerInfo[];
  tierLadder: MyTierLadderRung[];
  tierPeriods: TierPeriodTarget[];
  triggerSeries: TriggerSeries[];
  pagination: ReceivablesBasePagination | null;
}
```

- [ ] **Step 2: Hook**

Em `src/client/pages/bases-recebiveis/useReceivablesQueries.ts`, adicionar `MyReceivablesBaseDetail` ao import de `./types` (ordem alfabética), e adicionar o hook novo (logo após `useMyReceivablesBases`):

```ts
export function useMyReceivablesBaseDetail(id: string | null, page: number) {
  return useQuery({
    queryKey: ["my-receivables-base-detail", id, page],
    queryFn: async () => {
      const { data } = await api.get<MyReceivablesBaseDetail>(`/bases-recebiveis/minhas/${id}/graficos`, { params: { page } });
      return data;
    },
    enabled: !!id,
  });
}
```

- [ ] **Step 3: `tsc` do client**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 4: Componentes de gráfico novos

**Files:**
- Create: `src/client/pages/bases-recebiveis/ReceivablesTargetCharts.tsx`

**Interfaces:**
- Produces: `export interface TierLadderChartPoint { label: string; [tierKey: string]: string | number }`; `export interface TierLadderSeriesInfo { key: string; label: string }`; `export function TierLadderChart({ data, series }: { data: TierLadderChartPoint[]; series: TierLadderSeriesInfo[] })`; `export interface TriggerChartPoint { label: string; value: number }`; `export function TriggerRequirementChart({ title, data }: { title: string; data: TriggerChartPoint[] })`. Consumidos pela Task 5.

- [ ] **Step 1: Criar o arquivo**

Criar `src/client/pages/bases-recebiveis/ReceivablesTargetCharts.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";

const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";
// Paleta categórica validada (skill de dataviz, references/palette.md) —
// ordem fixa, nunca ciclada por rank (mesma ordem: azul/laranja/água/
// amarelo/magenta/verde/violeta/vermelho). Primeiro uso de gráfico
// multi-série no projeto — os gráficos existentes (GoalLinePeriodChart) só
// tinham série única.
const CATEGORICAL_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function StackedTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey as string} style={{ color: entry.color }}>
          {entry.name}: {formatNumber(entry.value as number)}
        </p>
      ))}
    </div>
  );
}

export interface TierLadderChartPoint {
  label: string;
  [tierKey: string]: string | number;
}

export interface TierLadderSeriesInfo {
  key: string;
  label: string;
}

// Coluna empilhada por período: 1 segmento por Degrau, altura = valor
// incremental daquele Degrau (diferença pro anterior). Mostra só a régua de
// metas (quanto seria preciso fazer) — ambiente simulado, nunca usa
// Realizado, por isso não há indicação de "batido"/"não batido" aqui.
export function TierLadderChart({ data, series }: { data: TierLadderChartPoint[]; series: TierLadderSeriesInfo[] }) {
  if (data.length === 0 || series.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem Degraus ou períodos para exibir.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-xs">
        {series.map((s, index) => (
          <span key={s.key} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<StackedTooltip />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
            {series.map((s, index) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="tiers"
                fill={CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]}
                radius={index === series.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface TriggerChartPoint {
  label: string;
  value: number;
}

function ValueTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-foreground">{formatNumber(payload[0].value as number)}</p>
    </div>
  );
}

// Valor mínimo exigido por período pra 1 Gatilho Condicional específico —
// mesma régua-alvo, sem Realizado.
export function TriggerRequirementChart({ title, data }: { title: string; data: TriggerChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <h5 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h5>
        <p className="text-xs text-muted-foreground">Sem períodos para exibir.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <h5 className="text-xs font-semibold text-foreground">{title}</h5>
      <div className="h-40 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<ValueTooltip />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
            <Bar dataKey="value" fill={CATEGORICAL_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `tsc` do client**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 5: `MyReceivablesBaseDetailPage.tsx` + navegação

**Files:**
- Create: `src/client/pages/bases-recebiveis/MyReceivablesBaseDetailPage.tsx`
- Modify: `src/client/pages/bases-recebiveis/MyReceivablesBasesTab.tsx`
- Modify: `src/client/routes/index.tsx`

**Interfaces:**
- Consumes: `useMyReceivablesBaseDetail` (Task 3); `TierLadderChart`/`TriggerRequirementChart` (Task 4); `MySimulatorModal` (já existe, sem alteração); `PERIODICITY_LABELS` (já existe, `BaseFormFields.tsx`).

- [ ] **Step 1: Criar a página**

Criar `src/client/pages/bases-recebiveis/MyReceivablesBaseDetailPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";

const TRIGGER_MODE_EXPLANATION: Record<"FAIXA" | "CUMULATIVO", string> = {
  FAIXA: "Faixa: só o Degrau mais alto batido no período conta — a recompensa é a daquele Degrau específico.",
  CUMULATIVO: "Cumulativo: todos os Degraus batidos no período somam — as recompensas de cada um se acumulam.",
};

function formatValue(value: string, indicatorType: "META" | "RESULTADO"): string {
  const n = Number(value);
  return indicatorType === "META" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function periodLabel(iso: string, periodicity: string): string {
  const date = new Date(iso);
  if (periodicity === "MENSAL" || periodicity === "DIARIO" || periodicity === "SEMANAL") {
    return date.toLocaleDateString("pt-BR", { timeZone: "UTC", day: periodicity === "MENSAL" ? undefined : "2-digit", month: "short", year: "numeric" });
  }
  if (periodicity === "TRIMESTRAL") {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `T${quarter}/${date.getUTCFullYear()}`;
  }
  return `${date.getUTCFullYear()}`;
}

const REWARD_LABELS: Record<string, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

function rewardText(rule: { rewardType: string; rewardResultTypeName: string | null; rewardPercentage: string | null; rewardFixedValue: string | null; rewardDescription: string | null }): string {
  const label = REWARD_LABELS[rule.rewardType] ?? rule.rewardType;
  if (rule.rewardType === "PREMIO_FISICO") return `${label}${rule.rewardDescription ? `: ${rule.rewardDescription}` : ""}`;
  if (rule.rewardType === "PERCENT_FIXO" || rule.rewardType === "PERCENT_RESULTADO") {
    const base = rule.rewardType === "PERCENT_RESULTADO" && rule.rewardResultTypeName ? ` de ${rule.rewardResultTypeName}` : "";
    return `${label}${base}: ${rule.rewardPercentage ?? "—"}%`;
  }
  return `${label}: ${rule.rewardFixedValue ?? "—"}`;
}

export function MyReceivablesBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const [page, setPage] = useState(0);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  const { data: detail, isLoading } = useMyReceivablesBaseDetail(id ?? null, page);

  const tierSeries: TierLadderSeriesInfo[] = useMemo(
    () => detail?.tierLadder.map((tier) => ({ key: `tier${tier.order}`, label: `Degrau ${tier.order}` })) ?? [],
    [detail],
  );

  const tierChartData: TierLadderChartPoint[] = useMemo(() => {
    if (!detail) return [];
    return detail.tierPeriods.map((period) => {
      const point: TierLadderChartPoint = { label: periodLabel(period.periodStart, detail.periodicity) };
      let previous = 0;
      const sorted = [...period.tiers].sort((a, b) => a.order - b.order);
      for (const tier of sorted) {
        const cumulative = Number(tier.requiredValue);
        point[`tier${tier.order}`] = Math.max(cumulative - previous, 0);
        previous = cumulative;
      }
      return point;
    });
  }, [detail]);

  const triggerCharts = useMemo(() => {
    if (!detail) return [];
    return detail.triggerSeries.map((series) => ({
      triggerId: series.triggerId,
      label: series.label,
      data: series.points.map((point) => ({ label: periodLabel(point.periodStart, detail.periodicity), value: Number(point.requiredValue) })),
    }));
  }, [detail]);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate("/bases-recebiveis?tab=minhas")} className="text-sm text-muted-foreground hover:underline">
        ← Voltar
      </button>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.indicatorType === "META" ? "Baseado na Meta" : "Baseado no Tipo de Resultado"}: {detail.goalOrResultLabel}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Período de Fechamento</p>
          <p className="text-sm font-medium text-foreground">{PERIODICITY_LABELS[detail.periodicity]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Modo</p>
          <p className="text-sm font-medium text-foreground">{detail.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"}</p>
          <p className="text-xs text-muted-foreground">{TRIGGER_MODE_EXPLANATION[detail.triggerMode]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Período de Vigência</p>
          <p className="text-sm font-medium text-foreground">
            {detail.startDate ? formatDate(detail.startDate) : "Início aberto"} até {detail.endDate ? formatDate(detail.endDate) : "sem data final"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Entidade de Análise</p>
          <p className="text-sm font-medium text-foreground">{detail.entityName}</p>
        </div>
      </div>

      {detail.conditionalTriggers.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Gatilhos Condicionais</h3>
          <ul className="space-y-0.5 text-sm text-foreground">
            {detail.conditionalTriggers.map((trigger) => (
              <li key={trigger.id}>
                {trigger.label} — mínimo {formatValue(trigger.requiredMinimum, trigger.indicatorType)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.tierLadder.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Degraus de Recompensa</h3>
          <ul className="space-y-1 text-sm text-foreground">
            {detail.tierLadder.map((tier) => (
              <li key={tier.order}>
                Degrau #{tier.order} — limiar {formatValue(tier.thresholdValue, detail.indicatorType)}
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {tier.rules.map((rule, index) => (
                    <li key={index}>{rewardText(rule)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Quanto é preciso fazer — Degraus (simulado, por período)</h3>
        <TierLadderChart data={tierChartData} series={tierSeries} />
      </div>

      {triggerCharts.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Quanto é preciso fazer — Gatilhos Condicionais (simulado, por período)</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {triggerCharts.map((chart) => (
              <TriggerRequirementChart key={chart.triggerId} title={chart.label} data={chart.data} />
            ))}
          </div>
        </div>
      )}

      {detail.pagination && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={!detail.pagination.hasPrev}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            ← Anterior
          </button>
          <button
            type="button"
            disabled={!detail.pagination.hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Próximo →
          </button>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setSimulatorOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Simular
        </button>
      </div>

      {simulatorOpen && (
        <MySimulatorModal
          baseId={detail.id}
          indicatorType={detail.indicatorType}
          memberId={ownMemberId ?? ""}
          triggers={detail.conditionalTriggers.map((trigger) => ({
            triggerId: trigger.id,
            label: trigger.label,
            verificationLevel: trigger.verificationLevel,
            indicatorType: trigger.indicatorType,
          }))}
          onClose={() => setSimulatorOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Cards de `MyReceivablesBasesTab.tsx` viram clicáveis**

Adicionar `useNavigate` ao import de `react-router-dom` no topo do arquivo. Old:

```tsx
import { useState } from "react";
import { useAuthStore } from "@/store/auth.store";
```

New:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
```

Dentro de `export function MyReceivablesBasesTab() {`, logo após `const ownMemberId = ...`, adicionar:

```tsx
  const navigate = useNavigate();
```

Tornar o bloco de título do card clicável. Old:

```tsx
          <div key={base.id} className="space-y-2 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{base.name}</h3>
              <p className="text-xs text-muted-foreground">
                {PERIODICITY_LABELS[base.periodicity]} · Entidade Analisada: {base.entityName}
              </p>
              <p className="text-xs text-muted-foreground">
                Período: {formatDate(base.periodStart)} até {formatDate(new Date(new Date(base.periodEndExclusive).getTime() - 86400000).toISOString())}
              </p>
            </div>
```

New:

```tsx
          <div key={base.id} className="space-y-2 rounded-lg border border-border p-4">
            <div onClick={() => navigate(`/bases-recebiveis/minhas/${base.id}`)} className="cursor-pointer hover:underline">
              <h3 className="text-sm font-semibold text-foreground">{base.name}</h3>
              <p className="text-xs text-muted-foreground">
                {PERIODICITY_LABELS[base.periodicity]} · Entidade Analisada: {base.entityName}
              </p>
              <p className="text-xs text-muted-foreground">
                Período: {formatDate(base.periodStart)} até {formatDate(new Date(new Date(base.periodEndExclusive).getTime() - 86400000).toISOString())}
              </p>
            </div>
```

(Só o título vira clicável, não o card inteiro — evita conflito com o botão "Simular" mais abaixo no mesmo card.)

- [ ] **Step 3: Rota nova**

Em `src/client/routes/index.tsx`, adicionar o import (junto aos demais de `@/pages/bases-recebiveis`):

```tsx
import { MyReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/MyReceivablesBaseDetailPage";
```

Adicionar a rota logo após a rota `/bases-recebiveis/:id` (gestão):

```tsx
      <Route
        path="/bases-recebiveis/minhas/:id"
        element={
          <RequireAuth>
            <MyReceivablesBaseDetailPage />
          </RequireAuth>
        }
      />
```

- [ ] **Step 4: `tsc` do client**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 6: `BasesRecebiveisPage.tsx` guarda a aba ativa na URL

**Files:**
- Modify: `src/client/pages/bases-recebiveis/BasesRecebiveisPage.tsx`

Mesmo ajuste já feito em `MetasPage.tsx` no PASSO 16 — necessário pro "← Voltar" da nova tela (`/bases-recebiveis?tab=minhas`) reabrir na aba certa.

- [ ] **Step 1: Reescrever o componente com `useSearchParams`**

Substituir todo o conteúdo de `src/client/pages/bases-recebiveis/BasesRecebiveisPage.tsx` por:

```tsx
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { ManageBasesTab } from "./ManageBasesTab";
import { MyReceivablesBasesTab } from "./MyReceivablesBasesTab";

// PASSO 9.10: "Bases de Recebível" (gestão, como antes) só para Admin+Gestor;
// "Minhas Bases" (autoatendimento) para TODOS os papéis, inclusive Usuário —
// mesmo padrão de abas do PASSO 8 (Estrutura Organizacional/Membros).
// PASSO 18: aba ativa passou a viver na URL (?tab=), mesmo ajuste já feito
// em MetasPage.tsx (PASSO 16) — necessário para o "Voltar" da tela de
// detalhe de Base reabrir na aba "Minhas Bases".
export function BasesRecebiveisPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === "ADMINISTRADOR" || role === "LIDERANCA_NO";
  const tabs = (["gerenciar", "minhas"] as const).filter((tab) => tab !== "gerenciar" || canManage);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState<"gerenciar" | "minhas">(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "minhas") return "minhas";
    if (tabParam === "gerenciar" && canManage) return "gerenciar";
    return canManage ? "gerenciar" : "minhas";
  });

  function setActiveTab(tab: "gerenciar" | "minhas") {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Bases de Recebível</h1>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm ${
                activeTab === tab ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "gerenciar" ? "Bases de Recebível" : "Minhas Bases"}
            </button>
          ))}
        </div>
      )}

      {activeTab === "gerenciar" && canManage && <ManageBasesTab />}
      {activeTab === "minhas" && <MyReceivablesBasesTab />}
    </div>
  );
}
```

- [ ] **Step 2: `tsc` do client**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 7: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas`

- [ ] **Step 1: Suíte completa + `tsc` (server e client)**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.server.json --noEmit
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: tudo limpo, sem quebrar nenhum teste existente.

- [ ] **Step 2: Smoke test no navegador**

Com `npm run server` (3333) e `npm run dev` (5173) rodando (reiniciar se preciso; usar sessão isolada do agent-browser — `--session <nome>` — pelo problema já encontrado no PASSO 17): usuário Membro Beneficiário de uma Base real (usuário descartável vinculado, mesmo procedimento das partes 1/2 se não houver senha de conta real disponível).

1. Ir em "Minhas Bases", clicar no título de um card. Confirmar navegação para `/bases-recebiveis/minhas/:id`.
2. Conferir cabeçalho: Meta/Resultado-base, Período de Fechamento, Modo (com a explicação breve), Período de Vigência, Entidade de Análise.
3. Conferir listas de Gatilhos Condicionais e Degraus de Recompensa — SEM nenhum indicador de "batido"/"passou" (ambiente simulado).
4. Conferir o gráfico de Degraus (coluna empilhada, sem cor de status) e o(s) gráfico(s) de Gatilhos — se a Base for trilha META com Sazonalidade, confirmar visualmente que os valores mudam entre os primeiros períodos exibidos; se for trilha RESULTADO, confirmar que os valores são iguais em todos.
5. Se a Base tiver periodicidade Diária/Semanal ou vigência longa, confirmar que aparecem os botões Anterior/Próximo e que navegam corretamente.
6. Clicar em "Simular", confirmar que o `MySimulatorModal` abre e funciona normalmente (sem alteração de comportamento).
7. "← Voltar" retorna para `/bases-recebiveis?tab=minhas`, aba certa selecionada.

- [ ] **Step 3: Registrar no `.planosistemametas`**

Adicionar `### PASSO 18 (FEITO 2026-07-28) — Detalhe de Base em "Minhas Bases"` na seção "PRÓXIMOS PASSOS", resumindo: pedido do usuário (parte 3 de 3, partes 1/2 nos PASSOs 16/17), o princípio central confirmado pelo usuário (ambiente 100% simulado, nunca usa Realizado — só converte limiares em valor-alvo por período, com o exemplo de sazonalidade dado por ele), a decisão de paginação (Diário/Semanal sempre por mês; Mensal/Trimestral/Anual só se passar de 12 períodos, em blocos de 12 meses — mesmo padrão de Acompanhamento), os arquivos novos/tocados, e o resultado da validação (testes/tsc/navegador). Isso fecha as 3 partes do pedido original do usuário sobre navegação/detalhe em Minhas Metas/Minhas Bases/Fechamento.
