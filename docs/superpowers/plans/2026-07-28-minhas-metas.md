# Minhas Metas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a aba "Minhas Metas" (autoatendimento, todos os papéis) ao módulo Metas, mostrando as Linhas de Meta em nível MEMBRO do próprio usuário logado, em campanhas vigentes, com barras de progresso Diária/Semanal/Mensal/Trimestral/Acumulado Total.

**Architecture:** Backend: nova função pura de bucketização + nova função de serviço `listMyGoalLines` (mesmo padrão de `listMyReceivablesBases`) + rota `GET /metas/minhas`. Um pré-requisito descoberto durante o planejamento: `getRealizadoDailyMap` (hoje só em `acompanhamento.service.ts`) precisa ser reaproveitado por `metas.service.ts`, mas isso criaria um ciclo de import (`acompanhamento.service.ts` já importa de `metas.service.ts`) — resolvido extraindo os helpers puros de `DailyMap` para um novo módulo `daily-map.util.ts` sem dependências de serviço, e realocando `getRealizadoDailyMap` para `bases-metas.service.ts` (dono de `buildMemberScopeFilter`, já importado tanto por `metas.service.ts` quanto por `acompanhamento.service.ts` — nenhuma aresta nova de dependência). Frontend: `MetasPage.tsx` vira container de abas (mesmo padrão de `BasesRecebiveisPage.tsx`), nova aba `MinhasMetasTab.tsx` + componente `ProgressBar.tsx`.

**Tech Stack:** Node/Express/TypeScript, Prisma (PostgreSQL), decimal.js via `Prisma.Decimal`, Vitest, React/Vite/TypeScript, TanStack Query, Tailwind CSS.

## Global Constraints

- Toda query Prisma usa `companyId` explícito (multi-tenancy — CLAUDE.md / rule-auth-multitenancy.md).
- Valores financeiros/metas nunca usam `float`/`double` puro — sempre `Prisma.Decimal`, serializados como `string` nas respostas HTTP (padrão já usado em todo o módulo Metas).
- Nenhuma lógica matemática/de negócio em componentes React — cálculo de bucket/percentual vive só em `metas.service.ts`.
- Rodar `npx vitest run --pool=forks --poolOptions.forks.singleFork=true` (não o pool padrão — RAM limitada nesta máquina).
- `tsc` combinado pode estourar OOM nesta máquina — se `npm run tsc` falhar por memória, rodar server/client separados com `$env:NODE_OPTIONS="--max-old-space-size=1024"`.
- Não fazer commit (este diretório não é um repositório git ainda).

---

## Task 1: Extrair helpers puros de `DailyMap` + realocar `getRealizadoDailyMap`

**Files:**
- Create: `src/server/services/daily-map.util.ts`
- Modify: `src/server/services/metas.service.ts` (remover definições movidas, importar+reexportar)
- Modify: `src/server/services/bases-metas.service.ts` (adicionar `getRealizadoDailyMap`)
- Modify: `src/server/services/acompanhamento.service.ts` (remover definição local, importar de `bases-metas.service.ts`)

**Interfaces:**
- Produces: `daily-map.util.ts` exporta `type DailyMap = Map<string, Prisma.Decimal>`, `interface PeriodTotal { key: string; value: Prisma.Decimal }`, `isoKey(date: Date): string`, `monthKeyOf(date: Date): string`, `quarterKeyOf(date: Date): string`, `isoWeekKey(date: Date): string`, `groupDailyMapBy(daily: DailyMap, keyFn: (date: Date) => string): PeriodTotal[]`, `addDailyMaps(a: DailyMap, b: DailyMap): DailyMap`.
- Produces: `bases-metas.service.ts` passa a exportar também `getRealizadoDailyMap(companyId: string, resultTypeId: string, entityType: OrgScopeType, entityId: string, startDate: Date, endDateExclusive: Date): Promise<DailyMap>`.
- Consumes (Task 2): `metas.service.ts` continua exportando `DailyMap`, `isoKey`, `monthKeyOf`, `quarterKeyOf`, `isoWeekKey`, `groupDailyMapBy` com os MESMOS nomes de hoje (reexport) — nenhum outro arquivo do repo precisa mudar seus imports.

- [ ] **Step 1: Criar `daily-map.util.ts` com os 7 helpers movidos verbatim**

Criar `src/server/services/daily-map.util.ts`:

```ts
import { Prisma } from "@prisma/client";

// Módulo puro (sem I/O, sem dependência de outros services) — existe para
// quebrar um ciclo de import: bases-metas.service.ts (getRealizadoDailyMap)
// e metas.service.ts (curva de Meta) precisam dos dois lados destes helpers,
// e metas.service.ts/acompanhamento.service.ts já tinham uma aresta de
// dependência que impedia colocar isso direto num dos dois arquivos.

export type DailyMap = Map<string, Prisma.Decimal>;

export function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function quarterKeyOf(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-T${quarter}`;
}

// ISO-8601: semana começa na segunda-feira; a "dona" da semana é a que
// contém a quinta-feira dessa semana (regra padrão de numeração ISO).
export function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export interface PeriodTotal {
  key: string;
  value: Prisma.Decimal;
}

export function groupDailyMapBy(daily: DailyMap, keyFn: (date: Date) => string): PeriodTotal[] {
  const totals = new Map<string, Prisma.Decimal>();

  for (const [dateKey, value] of daily) {
    const key = keyFn(new Date(`${dateKey}T00:00:00.000Z`));
    totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(value));
  }

  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => ({ key, value }));
}

export function addDailyMaps(a: DailyMap, b: DailyMap): DailyMap {
  const result: DailyMap = new Map(a);
  for (const [key, value] of b) {
    result.set(key, (result.get(key) ?? new Prisma.Decimal(0)).plus(value));
  }
  return result;
}
```

Nota: `groupDailyMapBy` original usava um helper local `toDate` (de `resultados.service.ts`) para converter a chave de volta em `Date`. Para manter este arquivo sem nenhuma dependência de outro service, a conversão foi inlinada (`new Date(\`${dateKey}T00:00:00.000Z\`)`) — comportamento idêntico a `toDate(dateKey)`.

- [ ] **Step 2: Remover as 7 definições de `metas.service.ts` e substituir por import + reexport**

Em `src/server/services/metas.service.ts`, editar o bloco de imports do topo (linhas 1-16 hoje). Old:

```ts
import { prisma } from "../config/prisma";
import { Prisma, type GoalCampaignStatus, type GoalEngineType, type OrgScopeType } from "@prisma/client";
import { buildMemberScopeFilter, dayOfYear365, isCombinedAnalysisType, isoWeekday, type SupportedAnalysisType } from "./bases-metas.service";
```

New:

```ts
import { prisma } from "../config/prisma";
import { Prisma, type GoalCampaignStatus, type GoalEngineType, type OrgScopeType } from "@prisma/client";
import {
  buildMemberScopeFilter,
  dayOfYear365,
  getRealizadoDailyMap,
  isCombinedAnalysisType,
  isoWeekday,
  type SupportedAnalysisType,
} from "./bases-metas.service";
import {
  addDailyMaps,
  type DailyMap,
  groupDailyMapBy,
  isoKey,
  isoWeekKey,
  monthKeyOf,
  type PeriodTotal,
  quarterKeyOf,
} from "./daily-map.util";
```

Também no bloco de import de `./scope.util` (linhas 4-14 hoje), adicionar `resolveRequesterMemberId` à lista (necessário na Task 2):

Old:
```ts
import {
  assertNodeWithinEditableScope,
  assertOwnedOrAdmin,
  assertVisibleScope,
  isNodeWithinEditableScope,
  resolveAncestorIds,
  resolveVisibleMemberFilter,
  resolveVisibleNodeIds,
  type AncestorIds,
  type RequestingUser,
} from "./scope.util";
```

New:
```ts
import {
  assertNodeWithinEditableScope,
  assertOwnedOrAdmin,
  assertVisibleScope,
  isNodeWithinEditableScope,
  resolveAncestorIds,
  resolveRequesterMemberId,
  resolveVisibleMemberFilter,
  resolveVisibleNodeIds,
  type AncestorIds,
  type RequestingUser,
} from "./scope.util";
```

Logo após o bloco de imports (antes da primeira interface do arquivo), adicionar as linhas de reexport (para que todo import externo de `DailyMap`/`isoKey`/etc. `from "./metas.service"` continue funcionando sem nenhuma mudança em outros arquivos):

```ts
export { addDailyMaps, groupDailyMapBy, isoKey, isoWeekKey, monthKeyOf, quarterKeyOf };
export type { DailyMap, PeriodTotal };
```

Agora remover as definições originais (o conteúdo é idêntico ao que foi movido — está só sendo apagado daqui, não reescrito):

1. Remover `export function isoKey(date: Date): string { return date.toISOString().slice(0, 10); }` (hoje linhas 714-716, logo antes do comentário de `distributeEvenly`).
2. Remover o bloco `export type DailyMap = ...` até o fim de `export function groupDailyMapBy(...) { ... }` (hoje linhas 1308-1341 — inclui `addDailyMaps`, `monthKeyOf`, `quarterKeyOf`, `interface PeriodTotal`, `groupDailyMapBy`).
3. Remover `export function isoWeekKey(date: Date): string { ... }` (hoje linhas 761-772, junto com o comentário "// ISO-8601: semana começa..." que vive logo acima).

Não remover `distributeEvenly`, `periodValuesToDaily`, `summarizeDailyMap`, `buildGoalLineRow` nem nenhuma outra função — elas continuam usando `isoKey`/`DailyMap`/etc. normalmente, agora vindos do import novo em vez de definidos localmente.

- [ ] **Step 3: Mover `getRealizadoDailyMap` de `acompanhamento.service.ts` para `bases-metas.service.ts`**

Em `src/server/services/acompanhamento.service.ts`, remover o bloco (hoje linhas 227-266, incluindo o comentário):

```ts
// Novo primitivo — não existe equivalente exportado em resultados.service.ts.
// Soma Resultados Regulares + Deságios por dia, para um escopo organizacional
// livre (via buildMemberScopeFilter), mapa esparso (só dias com lançamento).
export async function getRealizadoDailyMap(
  companyId: string,
  resultTypeId: string,
  entityType: OrgScopeType,
  entityId: string,
  startDate: Date,
  endDateExclusive: Date,
): Promise<DailyMap> {
  const memberFilter = buildMemberScopeFilter(entityType, entityId);

  const [entries, adjustments] = await Promise.all([
    prisma.resultEntry.findMany({
      where: { companyId, typeId: resultTypeId, date: { gte: startDate, lt: endDateExclusive }, member: memberFilter },
      select: { date: true, value: true },
    }),
    prisma.operationalAdjustment.findMany({
      where: {
        companyId,
        typeId: resultTypeId,
        dateReference: { gte: startDate, lt: endDateExclusive },
        member: memberFilter,
      },
      select: { dateReference: true, value: true },
    }),
  ]);

  const daily: DailyMap = new Map();
  for (const entry of entries) {
    const key = isoKey(entry.date);
    daily.set(key, (daily.get(key) ?? new Prisma.Decimal(0)).plus(entry.value));
  }
  for (const adjustment of adjustments) {
    const key = isoKey(adjustment.dateReference);
    daily.set(key, (daily.get(key) ?? new Prisma.Decimal(0)).plus(adjustment.value));
  }
  return daily;
}
```

Deixar só o comentário de seção acima dele (`// ====... Primitivos de dados...`) intocado, já que `getMetaDailyMap` (a próxima função do arquivo) também faz parte dessa seção.

Atualizar a linha de import de `bases-metas.service.ts` no topo do arquivo. Old (linha 3 hoje):
```ts
import { buildMemberScopeFilter } from "./bases-metas.service";
```
New:
```ts
import { buildMemberScopeFilter, getRealizadoDailyMap } from "./bases-metas.service";
```

Em `src/server/services/bases-metas.service.ts`:
- Adicionar ao topo (junto aos imports existentes, logo após a linha `import { toDate } from "./resultados.service";`):
```ts
import { type DailyMap, isoKey } from "./daily-map.util";
```
- Inserir a função logo após o fechamento de `buildMemberScopeFilter` (hoje linha 164, antes de `export async function assertScopeEntityExists`):
```ts
// Soma Resultados Regulares + Ajustes Operacionais por dia, para um escopo
// organizacional livre (via buildMemberScopeFilter) — mapa esparso (só dias
// com lançamento). Mora aqui (não em resultados.service.ts) porque depende
// de buildMemberScopeFilter, definido neste arquivo; mora aqui (não em
// metas.service.ts/acompanhamento.service.ts) para evitar um ciclo de
// import entre os dois (acompanhamento.service.ts já importa de
// metas.service.ts).
export async function getRealizadoDailyMap(
  companyId: string,
  resultTypeId: string,
  entityType: OrgScopeType,
  entityId: string,
  startDate: Date,
  endDateExclusive: Date,
): Promise<DailyMap> {
  const memberFilter = buildMemberScopeFilter(entityType, entityId);

  const [entries, adjustments] = await Promise.all([
    prisma.resultEntry.findMany({
      where: { companyId, typeId: resultTypeId, date: { gte: startDate, lt: endDateExclusive }, member: memberFilter },
      select: { date: true, value: true },
    }),
    prisma.operationalAdjustment.findMany({
      where: {
        companyId,
        typeId: resultTypeId,
        dateReference: { gte: startDate, lt: endDateExclusive },
        member: memberFilter,
      },
      select: { dateReference: true, value: true },
    }),
  ]);

  const daily: DailyMap = new Map();
  for (const entry of entries) {
    const key = isoKey(entry.date);
    daily.set(key, (daily.get(key) ?? new Prisma.Decimal(0)).plus(entry.value));
  }
  for (const adjustment of adjustments) {
    const key = isoKey(adjustment.dateReference);
    daily.set(key, (daily.get(key) ?? new Prisma.Decimal(0)).plus(adjustment.value));
  }
  return daily;
}
```

- [ ] **Step 4: Verificar que nada quebrou**

Rodar:
```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.server.json --noEmit
```
Expected: sem erros.

Rodar:
```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```
Expected: os 93 testes existentes continuam passando (esta task não muda nenhum comportamento, só a localização do código).

---

## Task 2: `listMyGoalLines` — funções puras + orquestração

**Files:**
- Modify: `src/server/services/metas.service.ts` (adicionar no fim do arquivo)
- Test: `src/server/services/metas.service.test.ts` (adicionar testes novos no fim do arquivo)

**Interfaces:**
- Consumes: `resolveRequesterMemberId(companyId, requestingUser)` de `./scope.util` (Task 1 já importou); `getRealizadoDailyMap(companyId, resultTypeId, entityType, entityId, startDate, endDateExclusive)` de `./bases-metas.service` (Task 1); `isoKey`, `monthKeyOf`, `quarterKeyOf`, `isoWeekKey`, `groupDailyMapBy`, `type DailyMap`, `type PeriodTotal` de `./daily-map.util` (Task 1, já importados em `metas.service.ts`).
- Produces: `export function hasDailyRationale(dailySeasonalityBaseId: string | null, seasonalityAnalysisType: SeasonalityAnalysisType | null): boolean`; `export function buildPeriodProgress(metaValue: Prisma.Decimal, realizadoValue: Prisma.Decimal): PeriodProgress`; `export interface PeriodProgress { metaValue: string; realizadoValue: string; percentage: string | null }`; `export interface MyGoalLineSummary { goalLineId: string; goalCampaignId: string; campaignName: string; resultTypeName: string; resultTypeUnit: ResultUnit; hasDailyRationale: boolean; diario: PeriodProgress | null; semanal: PeriodProgress | null; mensal: PeriodProgress; trimestral: PeriodProgress; acumulado: PeriodProgress }`; `export async function listMyGoalLines(companyId: string, requestingUser: RequestingUser, referenceDate: Date = new Date()): Promise<MyGoalLineSummary[]>` (Task 3 consome esta função).

- [ ] **Step 1: Escrever os testes das funções puras (falhando)**

Adicionar ao fim de `src/server/services/metas.service.test.ts`:

```ts
import { buildPeriodProgress, hasDailyRationale } from "./metas.service";

describe("hasDailyRationale (elegibilidade das barras Diária/Semanal)", () => {
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

describe("buildPeriodProgress (barra de progresso de um período)", () => {
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true metas.service.test.ts
```
Expected: FAIL — `hasDailyRationale`/`buildPeriodProgress` não existem ainda (erro de import/undefined).

- [ ] **Step 3: Implementar as funções puras + `listMyGoalLines`**

Adicionar ao fim de `src/server/services/metas.service.ts` (após a última função existente, `applyRecalculatedGoalLine`):

```ts
// ============================================================
// Minhas Metas — autoatendimento (qualquer papel), mesmo espírito de
// listMyReceivablesBases (bases-recebiveis.service.ts): as Linhas de Meta
// em nível MEMBRO do próprio usuário logado, em campanhas vigentes, com
// barras de progresso por período.
// ============================================================

import type { SeasonalityAnalysisType, ResultUnit } from "@prisma/client";

const DAILY_RATIONALE_ANALYSIS_TYPES: SeasonalityAnalysisType[] = ["DIAS_ANO", "MESES_DIAS_SEMANA", "MESES_DIAS_MES"];

// Diário/Semanal só fazem sentido quando a Linha tem distribuição real por
// dia: overlay diário explícito (dailySeasonalityBaseId), OU a base
// principal já é por dia. Bases só Mensal/Trimestral (MESES_ANO/TRIMESTRES)
// e motores sem seasonalityBase (Manual/Agrupamento, seasonalityAnalysisType
// null) distribuem uniformemente dentro do mês — uma leitura diária/semanal
// aí não teria sentido, então a Linha começa direto do Mensal.
export function hasDailyRationale(
  dailySeasonalityBaseId: string | null,
  seasonalityAnalysisType: SeasonalityAnalysisType | null,
): boolean {
  if (dailySeasonalityBaseId !== null) return true;
  if (seasonalityAnalysisType === null) return false;
  return DAILY_RATIONALE_ANALYSIS_TYPES.includes(seasonalityAnalysisType);
}

export interface PeriodProgress {
  metaValue: string;
  realizadoValue: string;
  percentage: string | null;
}

// percentage = Realizado/Meta (fração, ex. 0.62 = 62%) — mesma convenção já
// usada em acompanhamento.service.ts (formatPercent no client multiplica
// por 100). null quando a Meta do período é zero (sem meta, não divisão por
// zero) — client mostra "sem meta neste período" em vez de uma barra.
export function buildPeriodProgress(metaValue: Prisma.Decimal, realizadoValue: Prisma.Decimal): PeriodProgress {
  const percentage = metaValue.isZero() ? null : realizadoValue.dividedBy(metaValue);
  return {
    metaValue: metaValue.toString(),
    realizadoValue: realizadoValue.toString(),
    percentage: percentage === null ? null : percentage.toString(),
  };
}

function findBucketValue(totals: PeriodTotal[], key: string): Prisma.Decimal {
  return totals.find((t) => t.key === key)?.value ?? new Prisma.Decimal(0);
}

function todayUtcDateOnly(referenceDate: Date): Date {
  return new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
}

export interface MyGoalLineSummary {
  goalLineId: string;
  goalCampaignId: string;
  campaignName: string;
  resultTypeName: string;
  resultTypeUnit: ResultUnit;
  hasDailyRationale: boolean;
  diario: PeriodProgress | null;
  semanal: PeriodProgress | null;
  mensal: PeriodProgress;
  trimestral: PeriodProgress;
  acumulado: PeriodProgress;
}

// "Vigente" = hoje dentro de [startDate, endDate] da campanha (literalmente
// em andamento agora), independente de status/inactivatedAt. "Participar" =
// mesma regra literal de listMyReceivablesBases: vínculo direto, sem
// hierarquia — GoalLine em nível MEMBRO cujo memberId (ancestralidade
// denormalizada) é o do próprio usuário, ativa (inactivatedAt null).
// Acumulado Total = Meta da campanha inteira vs Realizado do início da
// campanha até hoje.
export async function listMyGoalLines(
  companyId: string,
  requestingUser: RequestingUser,
  referenceDate: Date = new Date(),
): Promise<MyGoalLineSummary[]> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) return [];

  const today = todayUtcDateOnly(referenceDate);

  const campaigns = await prisma.goalCampaign.findMany({
    where: { companyId, startDate: { lte: today }, endDate: { gte: today } },
    include: { resultType: { select: { name: true, unit: true } } },
  });
  if (campaigns.length === 0) return [];

  const lines = await prisma.goalLine.findMany({
    where: {
      companyId,
      goalCampaignId: { in: campaigns.map((c) => c.id) },
      entityType: "MEMBRO",
      memberId,
      inactivatedAt: null,
    },
    include: {
      dailyValues: true,
      seasonalityBase: { select: { analysisType: true } },
    },
  });
  if (lines.length === 0) return [];

  const campaignsById = new Map(campaigns.map((c) => [c.id, c]));
  const todayKey = isoKey(today);
  const monthKey = monthKeyOf(today);
  const weekKey = isoWeekKey(today);
  const quarterKey = quarterKeyOf(today);
  const endExclusive = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));

  return Promise.all(
    lines.map(async (line) => {
      const campaign = campaignsById.get(line.goalCampaignId)!;

      const metaDaily: DailyMap = new Map();
      for (const dv of line.dailyValues) metaDaily.set(isoKey(dv.date), dv.value);

      const realizadoDaily = await getRealizadoDailyMap(
        companyId,
        campaign.resultTypeId,
        "MEMBRO",
        memberId,
        campaign.startDate,
        endExclusive,
      );

      const dailyRationale = hasDailyRationale(line.dailySeasonalityBaseId, line.seasonalityBase?.analysisType ?? null);

      const metaMonthly = groupDailyMapBy(metaDaily, monthKeyOf);
      const metaWeekly = groupDailyMapBy(metaDaily, isoWeekKey);
      const metaQuarterly = groupDailyMapBy(metaDaily, quarterKeyOf);
      const realizadoMonthly = groupDailyMapBy(realizadoDaily, monthKeyOf);
      const realizadoWeekly = groupDailyMapBy(realizadoDaily, isoWeekKey);
      const realizadoQuarterly = groupDailyMapBy(realizadoDaily, quarterKeyOf);

      const metaTotal = [...metaDaily.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));
      const realizadoTotal = [...realizadoDaily.values()].reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));

      return {
        goalLineId: line.id,
        goalCampaignId: campaign.id,
        campaignName: campaign.name,
        resultTypeName: campaign.resultType.name,
        resultTypeUnit: campaign.resultType.unit,
        hasDailyRationale: dailyRationale,
        diario: dailyRationale
          ? buildPeriodProgress(metaDaily.get(todayKey) ?? new Prisma.Decimal(0), realizadoDaily.get(todayKey) ?? new Prisma.Decimal(0))
          : null,
        semanal: dailyRationale
          ? buildPeriodProgress(findBucketValue(metaWeekly, weekKey), findBucketValue(realizadoWeekly, weekKey))
          : null,
        mensal: buildPeriodProgress(findBucketValue(metaMonthly, monthKey), findBucketValue(realizadoMonthly, monthKey)),
        trimestral: buildPeriodProgress(findBucketValue(metaQuarterly, quarterKey), findBucketValue(realizadoQuarterly, quarterKey)),
        acumulado: buildPeriodProgress(metaTotal, realizadoTotal),
      };
    }),
  );
}
```

Nota: o `import type { SeasonalityAnalysisType, ResultUnit } from "@prisma/client";` acima deve ser mesclado ao import já existente de `@prisma/client` no topo do arquivo (`import { Prisma, type GoalCampaignStatus, type GoalEngineType, type OrgScopeType } from "@prisma/client";` vira `import { Prisma, type GoalCampaignStatus, type GoalEngineType, type OrgScopeType, type ResultUnit, type SeasonalityAnalysisType } from "@prisma/client";`) em vez de um import duplicado — o bloco de código acima está separado só para deixar claro quais tipos novos são necessários.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true metas.service.test.ts
```
Expected: PASS (todos, incluindo os novos).

- [ ] **Step 5: Rodar a suíte completa**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```
Expected: PASS (93 + os novos testes, sem quebrar nada).

---

## Task 3: Rota e controller — `GET /metas/minhas`

**Files:**
- Modify: `src/server/controllers/metas.controller.ts`
- Modify: `src/server/routes/metas.routes.ts`

**Interfaces:**
- Consumes: `listMyGoalLines(companyId, requestingUser)` de `../services/metas.service` (Task 2).
- Produces: `GET /metas/minhas` → `200 MyGoalLineSummary[]` (JSON — decimais já vêm como `string` de `listMyGoalLines`, sem serialização extra necessária).

- [ ] **Step 1: Adicionar o handler**

Em `src/server/controllers/metas.controller.ts`, adicionar `listMyGoalLines` à lista de imports de `../services/metas.service` (ordem alfabética, junto aos demais `list*`):

```ts
  listGoalCampaigns,
  listGoalLines,
  listGoalTriggers,
  listMyGoalLines,
```

Adicionar o handler, logo após `listGoalCampaignsHandler`:

```ts
export async function listMyGoalLinesHandler(req: Request, res: Response) {
  const lines = await listMyGoalLines(req.user!.companyId, req.user!);
  res.json(lines);
}
```

- [ ] **Step 2: Registrar a rota**

Em `src/server/routes/metas.routes.ts`, adicionar `listMyGoalLinesHandler` ao import de `../controllers/metas.controller` (ordem alfabética):

```ts
  listGoalCampaignsHandler,
  listGoalLinesHandler,
  listGoalTriggersHandler,
  listMyGoalLinesHandler,
```

Adicionar a rota logo após `metasRoutes.get("/", asyncHandler(listGoalCampaignsHandler));`:

```ts
metasRoutes.get("/minhas", asyncHandler(listMyGoalLinesHandler));
```

(Precisa vir antes de qualquer rota que capture um segmento único como `:id` sob o mesmo verbo — hoje não existe nenhuma `GET /:id`, só `GET /:campaignId/lines` etc., de profundidade diferente, então a ordem exata não quebra nada, mas registrar logo no topo mantém a convenção já usada em `bases-recebiveis.routes.ts`.)

- [ ] **Step 3: Smoke test via API real**

Com o servidor rodando (`npm run server`, porta 3333), login como `admin@demo.com`/`admin123` e chamar `GET /api/metas/minhas` com o token — confirmar `200` e um array (vazio se o Admin não tiver Linha MEMBRO própria numa campanha vigente — esperado, Admin normalmente não tem Membro vinculado). Se houver um usuário de teste com `memberId` vinculado E uma Linha de Meta em nível MEMBRO numa campanha vigente, confirmar que ele aparece na resposta com os 5 blocos (`diario`/`semanal` podem ser `null` dependendo da Base de Sazonalidade da Linha).

---

## Task 4: `ProgressBar.tsx` — componente de barra de progresso

**Files:**
- Create: `src/client/pages/metas/ProgressBar.tsx`

**Interfaces:**
- Produces: `export function ProgressBar({ label, metaValue, realizadoValue, percentage, unit }: { label: string; metaValue: string; realizadoValue: string; percentage: string | null; unit: "MOEDA" | "NUMERAL" }): JSX.Element` (Task 5 consome este componente).

- [ ] **Step 1: Criar o componente**

Criar `src/client/pages/metas/ProgressBar.tsx`:

```tsx
import { formatMetricValue, formatPercent } from "@/pages/acompanhamento/format";

interface ProgressBarProps {
  label: string;
  metaValue: string;
  realizadoValue: string;
  percentage: string | null;
  unit: "MOEDA" | "NUMERAL";
}

// Barra de progresso de 1 período (Diário/Semanal/Mensal/Trimestral/
// Acumulado) de 1 Linha de Meta — sem estado, sem lógica de negócio (o
// cálculo de percentual vive inteiramente no servidor, ver
// buildPeriodProgress em metas.service.ts). Preenchimento visual capado em
// 100% mesmo quando o percentual real ultrapassa isso — o rótulo numérico
// sempre mostra o valor real.
export function ProgressBar({ label, metaValue, realizadoValue, percentage, unit }: ProgressBarProps) {
  if (percentage === null) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">Sem meta neste período.</p>
      </div>
    );
  }

  const fraction = Number(percentage);
  const widthPercent = Math.min(100, Math.max(0, fraction * 100));
  const isOverTarget = fraction > 1;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {formatMetricValue(realizadoValue, unit)} / {formatMetricValue(metaValue, unit)} ({formatPercent(percentage)})
        </p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${isOverTarget ? "bg-success" : "bg-primary"}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirmar que `bg-success` existe no tema**

Rodar:
```bash
grep -rn "success" tailwind.config.* src/client/styles/globals.css
```
Se `success` não existir como cor do tema Tailwind, trocar `bg-success` por `bg-primary` (evita depender de um token de cor não configurado — `text-success`/`text-destructive` já são usados em `MyReceivablesBasesTab.tsx`, então normalmente `success` existe; só confirmar antes de seguir).

---

## Task 5: `MinhasMetasTab.tsx` — aba de autoatendimento

**Files:**
- Create: `src/client/pages/metas/MinhasMetasTab.tsx`

**Interfaces:**
- Consumes: `GET /metas/minhas` (Task 3) → `MyGoalLineSummary[]`; `ProgressBar` (Task 4); `useAuthStore` (`state.user?.memberId`).
- Produces: `export function MinhasMetasTab(): JSX.Element` (Task 6 consome este componente).

- [ ] **Step 1: Criar o componente**

Criar `src/client/pages/metas/MinhasMetasTab.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { ProgressBar } from "./ProgressBar";

interface PeriodProgress {
  metaValue: string;
  realizadoValue: string;
  percentage: string | null;
}

interface MyGoalLineSummary {
  goalLineId: string;
  goalCampaignId: string;
  campaignName: string;
  resultTypeName: string;
  resultTypeUnit: "MOEDA" | "NUMERAL";
  hasDailyRationale: boolean;
  diario: PeriodProgress | null;
  semanal: PeriodProgress | null;
  mensal: PeriodProgress;
  trimestral: PeriodProgress;
  acumulado: PeriodProgress;
}

// "Minhas Metas" (mesmo espírito de "Minhas Bases", bases-recebiveis) —
// autoatendimento disponível para TODOS os papéis: as Linhas de Meta em
// nível Membro do próprio usuário, em campanhas vigentes (hoje dentro do
// período), com barras de progresso Diário/Semanal (quando a Linha tem
// racional para isso)/Mensal/Trimestral/Acumulado Total. Sem Membro
// vinculado, lista vazia.
export function MinhasMetasTab() {
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;

  const { data: lines, isLoading } = useQuery({
    queryKey: ["my-goal-lines"],
    queryFn: async () => {
      const { data } = await api.get<MyGoalLineSummary[]>("/metas/minhas");
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Suas Metas individuais em campanhas vigentes, com o progresso por período.
      </p>

      {!ownMemberId && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Seu usuário não está vinculado a um Membro — não há Metas para exibir aqui.
        </p>
      )}

      {!!ownMemberId && isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!!ownMemberId && !isLoading && lines?.length === 0 && (
        <p className="text-sm text-muted-foreground">Você não tem Metas individuais em campanhas vigentes no momento.</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {lines?.map((line) => (
          <div key={line.goalLineId} className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{line.campaignName}</h3>
              <p className="text-xs text-muted-foreground">{line.resultTypeName}</p>
            </div>

            <div className="space-y-3">
              {line.diario && <ProgressBar label="Diário" {...line.diario} unit={line.resultTypeUnit} />}
              {line.semanal && <ProgressBar label="Semanal" {...line.semanal} unit={line.resultTypeUnit} />}
              <ProgressBar label="Mensal" {...line.mensal} unit={line.resultTypeUnit} />
              <ProgressBar label="Trimestral" {...line.trimestral} unit={line.resultTypeUnit} />
              <ProgressBar label="Acumulado Total" {...line.acumulado} unit={line.resultTypeUnit} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Task 6: `MetasPage.tsx` vira container de abas

**Files:**
- Modify: `src/client/pages/metas/MetasPage.tsx`

**Interfaces:**
- Consumes: `MinhasMetasTab` (Task 5); `useAuthStore` (`state.user?.role`).

- [ ] **Step 1: Envolver o conteúdo atual numa aba "Campanhas" + adicionar a aba "Minhas Metas"**

Em `src/client/pages/metas/MetasPage.tsx`, adicionar os imports no topo (junto aos existentes):

```ts
import { useAuthStore } from "@/store/auth.store";
import { MinhasMetasTab } from "./MinhasMetasTab";
```

Dentro de `export function MetasPage() {`, logo após `const queryClient = useQueryClient();`, adicionar:

```ts
const role = useAuthStore((state) => state.user?.role);
const canManage = role === "ADMINISTRADOR" || role === "LIDERANCA_NO";
const tabs = (["campanhas", "minhas"] as const).filter((tab) => tab !== "campanhas" || canManage);
const [activeTab, setActiveTab] = useState<"campanhas" | "minhas">(canManage ? "campanhas" : "minhas");
```

No JSX do `return`, logo abaixo do `<div className="flex items-start justify-between gap-4">...</div>` (cabeçalho "Metas" + botão "+ Nova Campanha") e ANTES do bloco `{formMode !== "closed" && (...)}`, inserir o seletor de abas:

```tsx
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
              {tab === "campanhas" ? "Campanhas" : "Minhas Metas"}
            </button>
          ))}
        </div>
      )}

      {activeTab === "minhas" && <MinhasMetasTab />}
```

Em seguida, envolver TODO o restante do JSX que hoje vem depois do cabeçalho (o bloco de formulário `{formMode !== "closed" && (...)}`, o filtro de Estado, a tabela de campanhas, `{selectedCampaign && <CampaignDetail .../>}`, e o modal de desativação) numa condição `{activeTab === "campanhas" && canManage && ( ... )}`. Ou seja, a estrutura final do `return` fica:

```tsx
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        {/* cabeçalho + botão Nova Campanha — só mudar o botão para só aparecer quando activeTab === "campanhas" (ver Step 2) */}
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {/* ...abas, código acima... */}
        </div>
      )}

      {activeTab === "minhas" && <MinhasMetasTab />}

      {activeTab === "campanhas" && canManage && (
        <>
          {formMode !== "closed" && ( /* formulário — inalterado */ )}
          <div className="flex flex-wrap items-center gap-1.5">{/* filtro de Estado — inalterado */}</div>
          <div className="overflow-hidden rounded-md border border-border">{/* tabela — inalterada */}</div>
          {selectedCampaign && <CampaignDetail campaign={selectedCampaign} />}
          {deactivatingCampaign && ( /* modal — inalterado */ )}
        </>
      )}
    </div>
  );
```

- [ ] **Step 2: O botão "+ Nova Campanha" só aparece na aba Campanhas**

O botão já está condicionado a `formMode === "closed"`. Adicionar também `activeTab === "campanhas"` ao mesmo `&&`. Old:
```tsx
        {formMode === "closed" && (
          <button
```
New:
```tsx
        {formMode === "closed" && activeTab === "campanhas" && (
          <button
```

- [ ] **Step 3: Verificar `tsc` do client**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros.

---

## Task 7: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas`

- [ ] **Step 1: Suíte completa**

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```
Expected: PASS, sem nenhuma quebra.

- [ ] **Step 2: `tsc` completo (server + client)**

```bash
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.server.json --noEmit
$env:NODE_OPTIONS="--max-old-space-size=1024"; npx tsc -p tsconfig.app.json --noEmit
```
Expected: sem erros nos dois.

- [ ] **Step 3: Smoke test no navegador**

Com `npm run server` (3333) e `npm run dev` (5173) rodando:
1. Login como Usuário (papel OPERACIONAL, precisa ter `memberId` vinculado e, idealmente, uma Linha de Meta em nível Membro numa campanha vigente para o caso não-vazio — se não houver dado assim disponível, documentar que só o caso vazio foi validado no navegador e o caso com dado real foi validado via API na Task 3) — confirmar que só a aba "Minhas Metas" aparece (sem aba "Campanhas", sem botão "+ Nova Campanha").
2. Login como `admin@demo.com`/`admin123` — confirmar que as duas abas aparecem, "Campanhas" continua funcionando exatamente como antes (nenhuma regressão visual/funcional na tabela de campanhas), e "Minhas Metas" mostra vazio (Admin normalmente sem Membro vinculado) com a mensagem correta.
3. Se houver uma Linha de Meta em nível Membro vigente disponível para algum usuário de teste: confirmar visualmente as barras (Diário/Semanal presentes só quando esperado pela Base de Sazonalidade da Linha; Mensal/Trimestral/Acumulado sempre presentes; preenchimento e percentual coerentes com os valores retornados pela API).

- [ ] **Step 4: Registrar no `.planosistemametas`**

Adicionar uma nova entrada `### PASSO 14 (FEITO 2026-07-28) — Minhas Metas` na seção "PRÓXIMOS PASSOS" do `.planosistemametas`, resumindo: motivação (pedido do usuário, mesmo espírito de Minhas Bases), o refactor de `daily-map.util.ts`/realocação de `getRealizadoDailyMap` e por quê (quebra de ciclo de import), a regra de "vigente"/racional diário validada com o usuário, os arquivos novos/tocados, e o resultado da validação (testes/tsc/navegador). Atualizar também a linha do item "10. Níveis de Permissão" ou criar uma nova entrada de status, seguindo o padrão já usado nas entradas anteriores (referenciar o PASSO, não duplicar detalhe).
