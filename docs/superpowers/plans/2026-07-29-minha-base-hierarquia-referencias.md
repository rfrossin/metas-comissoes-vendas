# Hierarquia Completa e Referências de Meta/Resultado em "Minha Base de Recebível" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela de detalhe de "Minha Base de Recebível" (`MyReceivablesBaseDetailPage.tsx`, self-service, PASSO 18), mostrar a hierarquia completa da Entidade de Análise e deixar explícito qual Meta/Resultado alimenta cada Gatilho Condicional e os Degraus.

**Architecture:** 1 campo novo (`hierarchyPath`) passa a viajar do backend (`getMyReceivablesBaseDetail`, reaproveitando `resolveAncestorIds`+`buildHierarchyPath` já usados em Metas/Fechamento) até o client, que monta a string final no formato pedido (ordem invertida, nome+nível no fim). As referências de Meta/Resultado são só formatação de campos que já existiam na resposta (`trigger.indicatorType`/`trigger.label`, `goalOrResultLabel`/`indicatorType`) — zero mudança de backend nessa parte.

**Tech Stack:** TypeScript, Express, Prisma (server); React + TypeScript, TanStack Query (client).

## Global Constraints

- Multi-tenancy: nenhuma query nova é introduzida — o campo novo reaproveita `resolveAncestorIds`/`buildHierarchyPath`, que já recebem `companyId` explicitamente (mesmo padrão já auditado em `fechamento.service.ts`).
- Este projeto **não é um repositório git no momento** (`git status` → "not a git repository") — nenhum passo deste plano inclui `git commit`.
- Nenhuma função pura nova — não há necessidade de teste unitário novo em `bases-recebiveis.service.test.ts` (a spec já constatou isso; `getMyReceivablesBaseDetail` nunca teve teste unitário próprio, é validada por smoke real, mesmo padrão do PASSO 18).
- Validação de cada task: `tsc` do server (`npx tsc --noEmit -p tsconfig.server.json` ou equivalente já usado no projeto — confirmar o script exato com `cat package.json` se necessário, mas o padrão estabelecido nas partes anteriores é `npm run tsc` na raiz, que cobre server+client juntos) precisa ficar limpo antes de passar para a próxima task.

---

### Task 1: Backend — `hierarchyPath` em `getMyReceivablesBaseDetail`

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts:13-21` (import), `:1690` (interface), `:1728-1731` (cálculo), `:1815` (retorno)

**Interfaces:**
- Consumes: `resolveAncestorIds(companyId, entityType, entityId): Promise<AncestorIds>` (já importado, `./metas.service`); `buildHierarchyPath(companyId, entityType, ancestry): Promise<string | null>` (precisa ser importado, `./metas.service` — mesma assinatura já usada em `fechamento.service.ts:335`, `:438`).
- Produces: `MyReceivablesBaseDetailResponse.hierarchyPath: string | null` — consumido pelo Task 2 (tipo no client) e Task 3 (exibição).

- [ ] **Step 1: Adicionar `buildHierarchyPath` ao import existente de `./metas.service`**

Em `src/server/services/bases-recebiveis.service.ts`, o bloco de import (linhas 13-21) hoje é:

```ts
import {
  assertEntityBelongsToCompany,
  dailyMapOfActiveLine,
  type DailyMap,
  isoKey,
  resolveAncestorIds,
  resolveEntityName,
  summarizeDailyMap,
} from "./metas.service";
```

Trocar para:

```ts
import {
  assertEntityBelongsToCompany,
  buildHierarchyPath,
  dailyMapOfActiveLine,
  type DailyMap,
  isoKey,
  resolveAncestorIds,
  resolveEntityName,
  summarizeDailyMap,
} from "./metas.service";
```

- [ ] **Step 2: Adicionar o campo `hierarchyPath` na interface `MyReceivablesBaseDetailResponse`**

Local atual (por volta da linha 1688-1691):

```ts
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  conditionalTriggers: {
```

Trocar para:

```ts
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  // Ancestralidade da Entidade de Análise (canal→...→pai imediato, mesmo
  // formato de buildHierarchyPath usado em Metas/Fechamento) — null quando
  // não há nada acima (Canal/Empresa). O client monta a string final
  // (ordem invertida + nome/nível no fim) — ver MyReceivablesBaseDetailPage.tsx.
  hierarchyPath: string | null;
  conditionalTriggers: {
```

- [ ] **Step 3: Calcular `hierarchyPath` dentro de `getMyReceivablesBaseDetail`**

Local atual (por volta da linha 1728-1731):

```ts
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Base de Recebível não encontrada");

  const goalOrResultLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");
```

Trocar para:

```ts
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Base de Recebível não encontrada");

  const beneficiaryAncestorIds = await resolveAncestorIds(companyId, beneficiary.entityType, beneficiary.entityId);
  const hierarchyPath = await buildHierarchyPath(companyId, beneficiary.entityType, beneficiaryAncestorIds);

  const goalOrResultLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");
```

- [ ] **Step 4: Incluir `hierarchyPath` no objeto retornado**

Local atual (por volta da linha 1813-1816):

```ts
    entityType: beneficiary.entityType,
    entityId: beneficiary.entityId,
    entityName: beneficiary.entityName,
    conditionalTriggers,
```

Trocar para:

```ts
    entityType: beneficiary.entityType,
    entityId: beneficiary.entityId,
    entityName: beneficiary.entityName,
    hierarchyPath,
    conditionalTriggers,
```

- [ ] **Step 5: Rodar `tsc` do server e confirmar que compila limpo**

Run: `npm run tsc`
Expected: nenhum erro em `bases-recebiveis.service.ts` (o único novo consumidor do campo, `MyReceivablesBaseDetail` no client, ainda não existe até a Task 2 — está tudo bem ter o campo "a mais" no server nesse meio-tempo, TypeScript não reclama de campo extra no retorno de uma função sem tipo de retorno explícito diferente).

---

### Task 2: Client — tipo `MyReceivablesBaseDetail`

**Files:**
- Modify: `src/client/pages/bases-recebiveis/types.ts:213-230`

**Interfaces:**
- Consumes: nenhuma (só tipos).
- Produces: `MyReceivablesBaseDetail.hierarchyPath: string | null` — consumido pelo Task 3.

- [ ] **Step 1: Adicionar `hierarchyPath` à interface `MyReceivablesBaseDetail`**

Local atual:

```ts
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

Trocar para:

```ts
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
  hierarchyPath: string | null;
  conditionalTriggers: MyConditionalTriggerInfo[];
  tierLadder: MyTierLadderRung[];
  tierPeriods: TierPeriodTarget[];
  triggerSeries: TriggerSeries[];
  pagination: ReceivablesBasePagination | null;
}
```

- [ ] **Step 2: Rodar `tsc` do client e confirmar que compila limpo**

Run: `npm run tsc`
Expected: nenhum erro novo (o único consumidor, `MyReceivablesBaseDetailPage.tsx`, ainda não lê o campo até a Task 3 — campo extra no tipo não quebra nada).

---

### Task 3: Client — exibição da hierarquia completa e das referências de Meta/Resultado

**Files:**
- Modify: `src/client/pages/bases-recebiveis/MyReceivablesBaseDetailPage.tsx`

**Interfaces:**
- Consumes: `detail.hierarchyPath: string | null`, `detail.entityType: ScopeType`, `detail.entityName: string` (Task 1+2); `detail.indicatorType`, `detail.goalOrResultLabel`, `trigger.indicatorType`, `trigger.label` (já existiam).
- Produces: nada consumido por outra task deste plano — última task de código.

- [ ] **Step 1: Importar `ScopeType` e declarar `LEVEL_LABEL`**

No topo do arquivo, o import atual é:

```ts
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";
```

Trocar para (1 import novo):

```ts
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";
```

Logo abaixo de `TRIGGER_MODE_EXPLANATION` (que hoje é:

```ts
const TRIGGER_MODE_EXPLANATION: Record<"FAIXA" | "CUMULATIVO", string> = {
  FAIXA: "Faixa: só o Degrau mais alto batido no período conta — a recompensa é a daquele Degrau específico.",
  CUMULATIVO: "Cumulativo: todos os Degraus batidos no período somam — as recompensas de cada um se acumulam.",
};
```

), adicionar:

```ts
const LEVEL_LABEL: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};
```

- [ ] **Step 2: Adicionar a função `formatFullHierarchy`**

Logo abaixo da função `formatDate` existente:

```ts
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
```

adicionar:

```ts
// hierarchyPath vem do backend como "ancestral imediato → topo" (ex.:
// "Hospitalar>Atacado" para um Time — mesmo formato usado em Metas/
// Fechamento). Esta tela pediu o formato inverso, com o nome da própria
// Entidade e seu nível no final: "Atacado>Hospitalar>São Paulo (Time)".
function formatFullHierarchy(hierarchyPath: string | null, entityType: ScopeType, entityName: string): string {
  const own = `${entityName} (${LEVEL_LABEL[entityType]})`;
  if (!hierarchyPath) return own;
  return [...hierarchyPath.split(">").reverse(), own].join(">");
}
```

- [ ] **Step 3: Usar `formatFullHierarchy` no campo "Entidade de Análise"**

Local atual:

```tsx
        <div>
          <p className="text-xs text-muted-foreground">Entidade de Análise</p>
          <p className="text-sm font-medium text-foreground">{detail.entityName}</p>
        </div>
```

Trocar para:

```tsx
        <div>
          <p className="text-xs text-muted-foreground">Entidade de Análise</p>
          <p className="text-sm font-medium text-foreground">
            {formatFullHierarchy(detail.hierarchyPath, detail.entityType, detail.entityName)}
          </p>
        </div>
```

- [ ] **Step 4: Prefixar cada Gatilho Condicional com "Meta:"/"Resultado:"**

Local atual:

```tsx
          <ul className="space-y-0.5 text-sm text-foreground">
            {detail.conditionalTriggers.map((trigger) => (
              <li key={trigger.id}>
                {trigger.label} — mínimo {formatValue(trigger.requiredMinimum, trigger.indicatorType)}
              </li>
            ))}
          </ul>
```

Trocar para:

```tsx
          <ul className="space-y-0.5 text-sm text-foreground">
            {detail.conditionalTriggers.map((trigger) => (
              <li key={trigger.id}>
                {trigger.indicatorType === "META" ? "Meta" : "Resultado"}: {trigger.label} — mínimo{" "}
                {formatValue(trigger.requiredMinimum, trigger.indicatorType)}
              </li>
            ))}
          </ul>
```

- [ ] **Step 5: Incluir a referência de Meta/Resultado no título "Degraus de Recompensa"**

Local atual:

```tsx
      {detail.tierLadder.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Degraus de Recompensa</h3>
```

Trocar para:

```tsx
      {detail.tierLadder.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Degraus de Recompensa — baseados {detail.indicatorType === "META" ? "na Meta" : "no Resultado"} "{detail.goalOrResultLabel}"
          </h3>
```

- [ ] **Step 6: Rodar `tsc` do client e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 4: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 19`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Smoke test no navegador — Base trilha META (idealmente com Sazonalidade)**

Usando `agent-browser` numa sessão isolada (ex.: `agent-browser --session minha-base-refs-test ...`) e um usuário descartável vinculado a um Membro real com pelo menos 1 Base de Recebível trilha META (mesmo procedimento de convite+aceite+vínculo já usado nas partes anteriores desta feature):

1. Abrir `/bases-recebiveis?tab=minhas`, clicar num card de Base trilha META.
2. Conferir "Entidade de Análise": deve mostrar a cadeia completa top-down com o nome e o nível entre parênteses no final (ex.: `Atacado>Hospitalar>São Paulo (Time)` ou, se o Beneficiário for avaliado como Membro, terminando em `... (Membro)`).
3. Conferir a lista de Gatilhos Condicionais: cada item deve começar com `Meta:` ou `Resultado:` conforme o tipo daquele Gatilho específico (podem ser diferentes entre si).
4. Conferir o título "Degraus de Recompensa — baseados na Meta "X"" (ou "no Resultado "X"") com o nome correto da Meta/Resultado da Base.
5. Tirar 1 screenshot confirmando visualmente.

- [ ] **Step 2: Smoke test no navegador — Base trilha RESULTADO**

Repetir os mesmos 4 pontos de conferência do Step 1 numa Base trilha RESULTADO do mesmo usuário de teste (ou revincular o usuário a outro Membro, mesmo procedimento já usado no smoke do PASSO 18).

- [ ] **Step 3: Limpeza**

Excluir o usuário descartável (`DELETE /permissoes/usuarios/:id` como Admin) e fechar a sessão isolada do `agent-browser`.

- [ ] **Step 4: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 18`, um novo registro:

```markdown
### PASSO 19 (FEITO <data>) — Hierarquia completa e referências de Meta/Resultado em "Minha Base de Recebível"

Pedido do usuário: parte A de 3 ajustes independentes trazidos após a entrega do PASSO 18. 1) "Entidade de Análise" mostrava só o nome — precisa da hierarquia completa (formato pedido: `Atacado>Hospitalar>São Paulo (Time)`, ordem invertida em relação ao formato já usado em Metas). 2) Faltava deixar claro qual Meta/Resultado alimenta cada Gatilho Condicional e os Degraus.

**Implementado**: `getMyReceivablesBaseDetail` (`bases-recebiveis.service.ts`) ganhou o campo `hierarchyPath` (mesma dupla `resolveAncestorIds`+`buildHierarchyPath` já usada em Metas/Fechamento — nenhuma função nova), calculado sobre a Entidade de Análise do Beneficiário. `MyReceivablesBaseDetailPage.tsx` monta a string final invertendo a ordem do `hierarchyPath` e anexando `{nome} ({nível})` no fim — formato novo, específico desta tela (a de Metas não foi tocada). As referências de Meta/Resultado nos Gatilhos (prefixo "Meta:"/"Resultado:") e nos Degraus (título da seção) usaram dado que já existia na resposta — zero mudança de cálculo.

**Validação**: `tsc` (server+client) limpo em cada task. Smoke no navegador confirmando a hierarquia completa e os rótulos novos numa Base trilha META e numa trilha RESULTADO.

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
