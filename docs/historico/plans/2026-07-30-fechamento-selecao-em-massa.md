# Fechamento — corrigir "Fechar Selecionados" + Selecionar Todos + Reabrir Selecionados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o bug que impede "Fechar Selecionados" de fechar de fato, e adicionar "Selecionar Todos" e "Reabrir Selecionados" na tela de Fechamento.

**Architecture:** A causa raiz é 1 linha (`rowKey` monta a chave de seleção com um ISO completo, que tem `:` dentro, quebrando o `split(":")` de volta). O backend ganha `reopenClosingBulk`, espelho exato de `saveClosingBulk` já existente (mesmo padrão de loop com try/catch por item, sucesso parcial esperado). O client reorganiza a seleção para aceitar linhas Abertas e Fechadas ao mesmo tempo, com cada botão de ação filtrando só o que lhe cabe.

**Tech Stack:** TypeScript, Express, Prisma (server); React + TypeScript, TanStack Query (client).

## Global Constraints

- Nenhuma mudança de schema.
- Este projeto **não é um repositório git no momento** — nenhum passo deste plano inclui `git commit`.
- Nenhum teste unitário novo — `fechamento.service.ts` não tem arquivo de teste hoje (funções orquestradoras com banco real; validação por smoke real).
- Validação de cada task: `npm run tsc` limpo antes de passar para a próxima.

---

### Task 1: Backend — `reopenClosingBulk` + controller + rota

**Files:**
- Modify: `src/server/services/fechamento.service.ts`
- Modify: `src/server/controllers/fechamento.controller.ts`
- Modify: `src/server/routes/fechamento.routes.ts`

**Interfaces:**
- Consumes: `reopenClosing(companyId, requestingUser, memberId, referenceMonthIso): Promise<void>`, `CloseBulkItem`/`CloseBulkResult` (todos já existentes em `fechamento.service.ts`, logo acima de `saveClosingBulk`).
- Produces: `reopenClosingBulk(companyId, requestingUser, items: CloseBulkItem[]): Promise<CloseBulkResult[]>` — consumido pelo Task 2 (client hook); rota `POST /fechamento/bulk-reopen` — consumida pelo Task 2.

- [ ] **Step 1: Adicionar `reopenClosingBulk` logo abaixo de `saveClosingBulk`**

Local atual (`fechamento.service.ts`):

```ts
export async function saveClosingBulk(
  companyId: string,
  requestingUser: RequestingUser,
  items: CloseBulkItem[],
): Promise<CloseBulkResult[]> {
  const results: CloseBulkResult[] = [];

  for (const item of items) {
    try {
      await saveClosing(companyId, requestingUser, item.memberId, item.referenceMonth, {
        approvals: [],
        comments: null,
        manualAdjustmentValue: null,
        manualAdjustmentReason: null,
      });
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: false, error: message });
    }
  }

  return results;
}

export async function reopenClosing(companyId: string, requestingUser: RequestingUser, memberId: string, referenceMonthIso: string) {
```

Adicionar, entre o fim de `saveClosingBulk` e o começo de `reopenClosing`:

```ts
export async function saveClosingBulk(
  companyId: string,
  requestingUser: RequestingUser,
  items: CloseBulkItem[],
): Promise<CloseBulkResult[]> {
  const results: CloseBulkResult[] = [];

  for (const item of items) {
    try {
      await saveClosing(companyId, requestingUser, item.memberId, item.referenceMonth, {
        approvals: [],
        comments: null,
        manualAdjustmentValue: null,
        manualAdjustmentReason: null,
      });
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: false, error: message });
    }
  }

  return results;
}

// Espelho exato de saveClosingBulk — mesmo padrão de sucesso parcial (1
// item bloqueado, ex. auto-reabertura do próprio Gestor, não derruba o
// lote inteiro; reopenClosing já é atômico por conta própria).
export async function reopenClosingBulk(
  companyId: string,
  requestingUser: RequestingUser,
  items: CloseBulkItem[],
): Promise<CloseBulkResult[]> {
  const results: CloseBulkResult[] = [];

  for (const item of items) {
    try {
      await reopenClosing(companyId, requestingUser, item.memberId, item.referenceMonth);
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      results.push({ memberId: item.memberId, referenceMonth: item.referenceMonth, ok: false, error: message });
    }
  }

  return results;
}

export async function reopenClosing(companyId: string, requestingUser: RequestingUser, memberId: string, referenceMonthIso: string) {
```

- [ ] **Step 2: Adicionar o handler no controller**

Em `src/server/controllers/fechamento.controller.ts`, trocar o import:

```ts
import {
  getClosingDetail,
  listClosings,
  listCommercialPeriods,
  reopenClosing,
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
```

Logo depois de `saveClosingBulkHandler` (que hoje é):

```ts
export async function saveClosingBulkHandler(req: Request, res: Response) {
  const parsed = bulkSaveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const results = await saveClosingBulk(req.user!.companyId, req.user!, parsed.data.items);
    res.json(results);
  } catch (error) {
    respondToError(error, res);
  }
}
```

adicionar:

```ts
export async function reopenClosingBulkHandler(req: Request, res: Response) {
  const parsed = bulkSaveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const results = await reopenClosingBulk(req.user!.companyId, req.user!, parsed.data.items);
    res.json(results);
  } catch (error) {
    respondToError(error, res);
  }
}
```

- [ ] **Step 3: Registrar a rota**

Em `src/server/routes/fechamento.routes.ts`, trocar o import:

```ts
import {
  getClosingDetailHandler,
  listClosingsHandler,
  listCommercialPeriodsHandler,
  reopenClosingHandler,
  saveClosingBulkHandler,
  saveClosingHandler,
  setCommercialPeriodStatusHandler,
} from "../controllers/fechamento.controller";
```

Para:

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

E, logo abaixo de `fechamentoRoutes.post("/bulk-save", asyncHandler(saveClosingBulkHandler));`, adicionar:

```ts
fechamentoRoutes.post("/bulk-reopen", asyncHandler(reopenClosingBulkHandler));
```

- [ ] **Step 4: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 2: Client — hook `useReopenClosingBulk`

**Files:**
- Modify: `src/client/pages/fechamento/useFechamentoQueries.ts`

**Interfaces:**
- Consumes: `CloseBulkItem`/`CloseBulkResult` (já exportados nesse mesmo arquivo, linhas 5-13), `api` (já importado).
- Produces: `useReopenClosingBulk()` — hook TanStack Query, mesmo formato de `useSaveClosingBulk()` — consumido pelo Task 3.

- [ ] **Step 1: Adicionar o hook logo abaixo de `useSaveClosingBulk`**

Local atual:

```ts
export function useSaveClosingBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: CloseBulkItem[]) => {
      const { data } = await api.post<CloseBulkResult[]>("/fechamento/bulk-save", { items });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fechamento-list"] }),
  });
}
```

Adicionar logo abaixo:

```ts
export function useReopenClosingBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: CloseBulkItem[]) => {
      const { data } = await api.post<CloseBulkResult[]>("/fechamento/bulk-reopen", { items });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fechamento-list"] }),
  });
}
```

- [ ] **Step 2: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 3: Client — `FechamentoPage.tsx`: corrigir `rowKey`, seleção mista, "Selecionar Todos" e "Reabrir Selecionados"

**Files:**
- Modify: `src/client/pages/fechamento/FechamentoPage.tsx`

**Interfaces:**
- Consumes: `useReopenClosingBulk` (Task 2).
- Produces: nada consumido por outra task deste plano — última task de código.

- [ ] **Step 1: Importar `useReopenClosingBulk`**

Local atual:

```ts
import { useClosingsList, useCommercialPeriods, useSaveClosingBulk, useSetCommercialPeriodStatus } from "./useFechamentoQueries";
```

Trocar para:

```ts
import { useClosingsList, useCommercialPeriods, useReopenClosingBulk, useSaveClosingBulk, useSetCommercialPeriodStatus } from "./useFechamentoQueries";
```

- [ ] **Step 2: Corrigir `rowKey` (causa raiz do bug)**

Local atual:

```ts
function rowKey(row: Pick<ClosingListRow, "memberId" | "referenceMonth">): string {
  return `${row.memberId}:${row.referenceMonth}`;
}
```

Trocar para:

```ts
// row.referenceMonth é um ISO completo ("2026-04-01T00:00:00.000Z"), que
// também tem ":" dentro — sem o .slice(0, 10), split(":") na hora de
// desfazer a chave (closeSelected/reopenSelected) corta a data errado e o
// backend recebe uma data inválida. Mesma fatia já usada na navegação de
// linha da tabela (`row.referenceMonth.slice(0, 10)`).
function rowKey(row: Pick<ClosingListRow, "memberId" | "referenceMonth">): string {
  return `${row.memberId}:${row.referenceMonth.slice(0, 10)}`;
}
```

- [ ] **Step 3: Reescrever o bloco de seleção/ações em massa**

Local atual:

```ts
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkSave = useSaveClosingBulk();
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; failed: number } | null>(null);

  function isRowSelectable(row: ClosingListRow): boolean {
    if (row.status !== "ABERTO") return false;
    if (role === "LIDERANCA_NO" && ownMemberId && ownMemberId === row.memberId) return false;
    return true;
  }

  function toggleRowSelection(row: ClosingListRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closeSelected() {
    const items = [...selected].map((key) => {
      const [memberId, referenceMonth] = key.split(":");
      return { memberId, referenceMonth };
    });
    bulkSave.mutate(items, {
      onSuccess: (results) => {
        setBulkSummary({ ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
        setSelected(new Set());
      },
    });
  }
```

Trocar para:

```ts
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkSave = useSaveClosingBulk();
  const bulkReopen = useReopenClosingBulk();
  const [bulkSummary, setBulkSummary] = useState<{ action: "fechar" | "reabrir"; ok: number; failed: number } | null>(null);

  // Selecionável pra Fechar (ABERTO) OU pra Reabrir (FECHADO) — nunca
  // PREVISTO (período ainda não encerrado) nem a própria linha do Gestor
  // logado (mesma trava de auto-fechamento/auto-reabertura do backend).
  function isRowSelectable(row: ClosingListRow): boolean {
    if (row.status === "PREVISTO") return false;
    if (role === "LIDERANCA_NO" && ownMemberId && ownMemberId === row.memberId) return false;
    return true;
  }

  function toggleRowSelection(row: ClosingListRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set((rows ?? []).filter(isRowSelectable).map(rowKey)));
  }

  // Cada ação filtra a própria seleção pelo status relevante — uma seleção
  // mista (Abertos + Fechados juntos) nunca gera erro ou ambiguidade: Fechar
  // só age nos Abertos selecionados, Reabrir só nos Fechados selecionados.
  const selectedAbertoItems = (rows ?? [])
    .filter((row) => selected.has(rowKey(row)) && row.status === "ABERTO")
    .map((row) => ({ memberId: row.memberId, referenceMonth: row.referenceMonth.slice(0, 10) }));
  const selectedFechadoItems = (rows ?? [])
    .filter((row) => selected.has(rowKey(row)) && row.status === "FECHADO")
    .map((row) => ({ memberId: row.memberId, referenceMonth: row.referenceMonth.slice(0, 10) }));

  function closeSelected() {
    bulkSave.mutate(selectedAbertoItems, {
      onSuccess: (results) => {
        setBulkSummary({ action: "fechar", ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
        setSelected(new Set());
      },
    });
  }

  function reopenSelected() {
    bulkReopen.mutate(selectedFechadoItems, {
      onSuccess: (results) => {
        setBulkSummary({ action: "reabrir", ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
        setSelected(new Set());
      },
    });
  }
```

- [ ] **Step 4: Reescrever o bloco JSX de ações em massa**

Local atual:

```tsx
      {canManageClosings && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <span className="text-sm text-foreground">{selected.size} selecionado(s)</span>
          <button
            type="button"
            disabled={bulkSave.isPending}
            onClick={closeSelected}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {bulkSave.isPending ? "Fechando..." : "Fechar Selecionados"}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">
            Limpar seleção
          </button>
        </div>
      )}

      {bulkSummary && (
        <p className="text-sm text-muted-foreground">
          {bulkSummary.ok} Fechamento(s) concluído(s) com sucesso
          {bulkSummary.failed > 0 ? `, ${bulkSummary.failed} bloqueado(s) (confira status/permissão de cada um)` : ""}.
        </p>
      )}
```

Trocar para:

```tsx
      {canManageClosings && rows && rows.some(isRowSelectable) && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
          >
            Selecionar Todos
          </button>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
              <span className="text-sm text-foreground">{selected.size} selecionado(s)</span>
              {selectedAbertoItems.length > 0 && (
                <button
                  type="button"
                  disabled={bulkSave.isPending}
                  onClick={closeSelected}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {bulkSave.isPending ? "Fechando..." : `Fechar Selecionados (${selectedAbertoItems.length})`}
                </button>
              )}
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

      {bulkSummary && (
        <p className="text-sm text-muted-foreground">
          {bulkSummary.action === "fechar" ? "Fechamento" : "Reabertura"}: {bulkSummary.ok} concluído(s) com sucesso
          {bulkSummary.failed > 0 ? `, ${bulkSummary.failed} bloqueado(s) (confira status/permissão de cada um)` : ""}.
        </p>
      )}
```

- [ ] **Step 5: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 4: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 23`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Smoke test no navegador — Fechar Selecionados (prova do bug corrigido)**

Numa sessão isolada do `agent-browser`, logado como Admin, em "Fechamento": filtrar um Escopo/Período com algumas linhas `ABERTO` reais. Selecionar 2-3 delas (checkbox individual, ou "Selecionar Todos"), clicar "Fechar Selecionados (N)" — confirmar que o `bulkSummary` mostra "Fechamento: N concluído(s) com sucesso" e que, ao recarregar a lista, o Status dessas linhas mudou de fato para "Fechado" (prova de que o bug foi corrigido — antes disso `ok` vinha 0 pra tudo).

- [ ] **Step 2: Smoke test — Reabrir Selecionados**

Selecionar as mesmas linhas agora Fechadas (ou usar "Selecionar Todos" de novo, que agora as inclui) e clicar "Reabrir Selecionados (N)" — confirmar que o `bulkSummary` mostra "Reabertura: N concluído(s) com sucesso" e que o Status volta para "Aberto" na lista.

- [ ] **Step 3: Smoke test — seleção mista**

Selecionar manualmente ao menos 1 linha `ABERTO` e 1 linha `FECHADO` ao mesmo tempo — confirmar que os 2 botões ("Fechar Selecionados" e "Reabrir Selecionados") aparecem juntos, cada um com a contagem certa (não o total da seleção). Clicar em só 1 dos 2 e confirmar que só as linhas do status correspondente foram afetadas.

- [ ] **Step 4: Limpeza**

Se algum Fechamento de teste ficou num estado diferente do original (ex.: uma linha que estava Aberta antes do teste e foi fechada), reverter manualmente (reabrir) para não alterar permanentemente dados reais. Fechar a sessão isolada do `agent-browser`.

- [ ] **Step 5: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 22`, um novo registro:

```markdown
### PASSO 23 (FEITO <data>) — Fechamento: corrigir "Fechar Selecionados" + Selecionar Todos + Reabrir Selecionados

Pedido do usuário: parte E de um pedido de 4 partes (D já entregue — PASSO 22; F e G ainda pendentes). Na tela de Fechamento, "Fechar Selecionados" não fechava de fato os Fechamentos marcados; pedido: corrigir isso, adicionar "Selecionar Todos" (tudo que está filtrado e é permitido) e "Reabrir Selecionados" (reabre os selecionados que estiverem Fechados), com cuidado pro botão novo não ter o mesmo problema.

**Causa raiz achada**: `rowKey(row)` (`FechamentoPage.tsx`) montava a chave de seleção como `` `${memberId}:${referenceMonth}` `` — mas `referenceMonth` é um ISO completo, que também tem `:` dentro; `closeSelected()` desfazia a chave com `split(":")` e cortava a data errado, o backend recebia uma data inválida e `saveClosingBulk` reportava tudo como falha. Corrigido com `.slice(0, 10)` antes de montar a chave (mesma fatia já usada na navegação de linha).

**Implementado**: `reopenClosingBulk` (novo, `fechamento.service.ts`) espelha exatamente `saveClosingBulk` (mesmo padrão de sucesso parcial por item) — rota `POST /fechamento/bulk-reopen`, hook `useReopenClosingBulk`. `isRowSelectable` passou a aceitar `ABERTO` e `FECHADO` (antes só `ABERTO`); `selectAll()` marca tudo que está selecionável na lista filtrada atual; cada ação (`closeSelected`/`reopenSelected`) filtra a própria seleção pelo status relevante antes de agir, então uma seleção mista nunca gera ambiguidade — os 2 botões aparecem/somem de forma independente conforme o que está selecionado.

**Validação**: `tsc` (server+client) limpo em cada task. Smoke real: "Fechar Selecionados" fechou de fato Fechamentos reais (Status mudou pra Fechado — prova do bug corrigido); "Reabrir Selecionados" reverteu corretamente; seleção mista (Aberto+Fechado juntos) mostrou os 2 botões com contagens certas, cada um agindo só no que era dele. Estado original dos dados restaurado ao final.

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
