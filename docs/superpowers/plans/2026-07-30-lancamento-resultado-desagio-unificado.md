# Lançamento unificado de Resultado/Deságio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fundir os 2 quadros de lançamento em "Lançamento por Membro" (`ResultEntryForm.tsx` + `AdjustmentForm.tsx`) num único formulário (`LaunchEntryForm.tsx`) com um toggle "Tipo de Lançamento" (Resultado/Deságio) que decide endpoint, validação de negativo e visibilidade do campo Motivo.

**Architecture:** Componente novo, sem estado de servidor novo — reaproveita os 2 endpoints já existentes (`POST /resultados/entries`/`POST /resultados/adjustments`) e o `BRNumberField` já existente (sua prop `allowNegative` já resolve a diferença de validação). `LaunchSection.tsx` passa a renderizar 1 componente em vez de 2.

**Tech Stack:** React + TypeScript, TanStack Query.

## Global Constraints

- Nenhuma mudança de backend — os 2 endpoints e sua validação permanecem exatamente como são hoje.
- Este projeto **não é um repositório git no momento** — nenhum passo deste plano inclui `git commit`.
- Validação de cada task: `npm run tsc` limpo antes de passar para a próxima.

---

### Task 1: `LaunchEntryForm.tsx` — formulário unificado

**Files:**
- Create: `src/client/pages/resultados/LaunchEntryForm.tsx`

**Interfaces:**
- Consumes: `BRNumberField`/`parseBRNumber` (`./BRNumberField.tsx`, já existentes), `ResultType` (`./ResultTypesSection.tsx`, já existente), `api`/`getErrorMessage` (`@/services/api`, já existentes).
- Produces: `LaunchEntryForm({ memberId: string })` — consumido pelo Task 2 (`LaunchSection.tsx`).

- [ ] **Step 1: Criar o componente**

```tsx
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";
import type { ResultType } from "./ResultTypesSection";
import { BRNumberField, parseBRNumber } from "./BRNumberField";

type LaunchType = "RESULTADO" | "DESAGIO";

// Fundo de ResultEntryForm.tsx + AdjustmentForm.tsx num quadro só: o usuário
// escolhe primeiro o Tipo de Lançamento (toggle, não <select> — é a decisão
// principal do fluxo) e o formulário se adapta — endpoint chamado, se Valor
// aceita negativo (via allowNegative do BRNumberField, sem lógica extra:
// trocar de Deságio pra Resultado com um valor negativo já digitado mostra
// erro na hora) e se o campo Motivo aparece.
export function LaunchEntryForm({ memberId }: { memberId: string }) {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState("");
  const [launchType, setLaunchType] = useState<LaunchType>("RESULTADO");
  const [date, setDate] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: types } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  const selectedType = types?.find((type) => type.id === typeId);

  const parsedValue = parseBRNumber(value);
  const isValidValue = parsedValue !== null && !Number.isNaN(parsedValue) && (launchType === "DESAGIO" || parsedValue >= 0);

  const createMutation = useMutation({
    mutationFn: () =>
      launchType === "RESULTADO"
        ? api.post("/resultados/entries", { memberId, typeId, date, value: parsedValue })
        : api.post("/resultados/adjustments", {
            memberId,
            typeId,
            dateReference: date,
            value: parsedValue,
            reason: reason.trim() ? reason : undefined,
          }),
    onSuccess: () => {
      // Mesmo padrão já usado no handler de exclusão de HistoryTable.tsx —
      // invalida as 3 queries incondicionalmente (HistoryTable lê Resultados
      // e Deságios juntos numa lista combinada, então não vale a pena
      // diferenciar por launchType aqui).
      queryClient.invalidateQueries({ queryKey: ["result-entries", memberId] });
      queryClient.invalidateQueries({ queryKey: ["operational-adjustments", memberId] });
      queryClient.invalidateQueries({ queryKey: ["realizado-liquido", memberId] });
      setTypeId("");
      setDate("");
      setValue("");
      setReason("");
      setError(null);
      setSuccess(launchType === "RESULTADO" ? "Resultado lançado." : "Deságio lançado.");
    },
    onError: (mutationError) => {
      setError(
        getErrorMessage(mutationError, launchType === "RESULTADO" ? "Não foi possível lançar o resultado." : "Não foi possível lançar o deságio."),
      );
      setSuccess(null);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);

    if (!typeId || !date || !isValidValue) {
      return;
    }

    createMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-xs font-semibold text-foreground">Novo Lançamento</h3>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="launch-entry-type">
          Tipo de Resultado
        </label>
        <select
          id="launch-entry-type"
          required
          value={typeId}
          onChange={(event) => setTypeId(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="">Selecione...</option>
          {types?.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Tipo de Lançamento</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLaunchType("RESULTADO")}
            className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
              launchType === "RESULTADO" ? "border-primary bg-primary/10 font-medium text-primary" : "border-input text-foreground"
            }`}
          >
            Resultado
          </button>
          <button
            type="button"
            onClick={() => setLaunchType("DESAGIO")}
            className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
              launchType === "DESAGIO" ? "border-primary bg-primary/10 font-medium text-primary" : "border-input text-foreground"
            }`}
          >
            Deságio
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="launch-entry-date">
          Data
        </label>
        <input
          id="launch-entry-date"
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        />
      </div>

      <BRNumberField
        id="launch-entry-value"
        label={launchType === "DESAGIO" ? "Valor (negativo para estorno)" : "Valor"}
        value={value}
        onChange={setValue}
        unit={selectedType?.unit}
        allowNegative={launchType === "DESAGIO"}
        negativeHint="Resultado não aceita valor negativo — troque o Tipo de Lançamento para Deságio para registrar estornos."
      />

      {launchType === "DESAGIO" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="launch-entry-reason">
            Motivo (opcional)
          </label>
          <textarea
            id="launch-entry-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={createMutation.isPending}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {createMutation.isPending ? "Lançando..." : launchType === "RESULTADO" ? "Lançar Resultado" : "Lançar Deságio"}
      </button>

      {success && <p className="text-xs text-success">{success}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 2: Ligar `LaunchEntryForm` em `LaunchSection.tsx` e apagar os 2 formulários antigos

**Files:**
- Modify: `src/client/pages/resultados/LaunchSection.tsx`
- Delete: `src/client/pages/resultados/ResultEntryForm.tsx`
- Delete: `src/client/pages/resultados/AdjustmentForm.tsx`

**Interfaces:**
- Consumes: `LaunchEntryForm` (Task 1).
- Produces: nada consumido por outra task deste plano — última task de código.

- [ ] **Step 1: Trocar o import e o grid de 2 formulários por 1**

Local atual (`LaunchSection.tsx`):

```tsx
import { ResultEntryForm } from "./ResultEntryForm";
import { AdjustmentForm } from "./AdjustmentForm";
import { HistoryTable } from "./HistoryTable";
```

Trocar para:

```tsx
import { LaunchEntryForm } from "./LaunchEntryForm";
import { HistoryTable } from "./HistoryTable";
```

E, mais abaixo:

```tsx
      {memberId && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ResultEntryForm memberId={memberId} />
            <AdjustmentForm memberId={memberId} />
          </div>

          <HistoryTable memberId={memberId} />
        </div>
      )}
```

Trocar para:

```tsx
      {memberId && (
        <div className="space-y-4">
          <LaunchEntryForm memberId={memberId} />

          <HistoryTable memberId={memberId} />
        </div>
      )}
```

- [ ] **Step 2: Apagar `ResultEntryForm.tsx` e `AdjustmentForm.tsx`**

Nenhum outro arquivo do projeto os referencia (confirmado por busca — só apareciam em si mesmos e em `LaunchSection.tsx`, já trocado no Step 1). Apagar os 2 arquivos por completo.

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros (nenhuma referência solta a `ResultEntryForm`/`AdjustmentForm`).

---

### Task 3: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 21`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Smoke test no navegador**

Usando `agent-browser` numa sessão isolada, logado com uma conta que possa lançar Resultado para algum Membro (Admin, ou um usuário descartável vinculado a um Membro com essa permissão — mesmo padrão já usado nas Partes A/B), abrir "Resultados" → aba "Lançamento por Membro", selecionar um Membro:

1. Confirmar que só existe 1 quadro agora ("Novo Lançamento"), com Tipo de Resultado, Tipo de Lançamento (2 botões, "Resultado" já selecionado por padrão), Data, Valor — sem o campo Motivo visível ainda.
2. Preencher Tipo de Resultado, Data, Valor (positivo) com "Resultado" selecionado, enviar — confirmar mensagem "Resultado lançado." e que a linha aparece em `HistoryTable` logo abaixo.
3. Digitar um valor negativo com "Resultado" ainda selecionado — confirmar que aparece o erro de "não aceita valor negativo".
4. Clicar em "Deságio" — confirmar que o campo Motivo aparece, e que o mesmo valor negativo do passo anterior deixa de mostrar erro (a validação mudou em tempo real).
5. Preencher Tipo de Resultado, Data, Valor negativo, Motivo, enviar — confirmar mensagem "Deságio lançado." e que a linha aparece em `HistoryTable`.
6. Conferir que não há erros no console.

- [ ] **Step 2: Limpeza**

Se um usuário descartável foi criado para o teste, excluí-lo (`DELETE /permissoes/usuarios/:id` como Admin) e fechar a sessão isolada do `agent-browser`.

- [ ] **Step 3: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 20`, um novo registro:

```markdown
### PASSO 21 (FEITO <data>) — Lançamento unificado de Resultado/Deságio

Pedido do usuário: parte C de 3 (última) — fechando o pedido completo trazido após a entrega do PASSO 18 (partes A e B — hierarquia/referências em "Minha Base de Recebível" e tabela de Beneficiários na edição de Base — PASSOs 19 e 20). Em "Lançamento por Membro" (aba Resultados), fundir os 2 quadros de lançamento (Resultado e Deságio, lado a lado) num só, com um Tipo de Lançamento escolhido primeiro — campos: Tipo de Resultado, Tipo de Lançamento, Data, Valor, Motivo (só quando Deságio) — para um design mais amigável.

**Implementado**: `LaunchEntryForm.tsx` (novo) substitui `ResultEntryForm.tsx`+`AdjustmentForm.tsx` (apagados, sem outros usos) — 1 quadro com um toggle "Tipo de Lançamento" (2 botões, não `<select>` — é a decisão principal do fluxo) que decide qual dos 2 endpoints já existentes chamar (`POST /resultados/entries`/`POST /resultados/adjustments`, nenhuma mudança de backend), se o campo Valor aceita negativo (via `allowNegative` do `BRNumberField.tsx`, reaproveitado sem alteração — trocar de Deságio pra Resultado com um valor negativo já digitado mostra o erro na hora, de graça) e se o campo Motivo aparece (só em Deságio). `LaunchSection.tsx` trocou o grid de 2 colunas por 1 componente só.

**Validação**: `tsc` (client) limpo em cada task. Smoke no navegador: lançamento de 1 Resultado e 1 Deságio (com Motivo) pelo formulário novo, ambos aparecendo corretos em `HistoryTable`; validação de valor negativo mudando em tempo real ao trocar o Tipo de Lançamento; sem erros no console.

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
