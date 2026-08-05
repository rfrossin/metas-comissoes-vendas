# Bloqueio de lançamento em período com Fechamento apurado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloquear lançamento (manual ou em massa) de Resultado/Deságio para um Tipo de Resultado que já foi apurado num Fechamento existente do mesmo Membro+Mês.

**Architecture:** Nova função de guarda `assertNoMemberClosingForType`, no mesmo estilo e arquivo de `assertPeriodOpen` (`resultados.service.ts`), consultando `MemberClosing.resultsByType` (já contém todos os Tipos de Resultado apurados no Fechamento). Chamada nos 2 pontos de criação manual e no ponto de criação em massa.

**Tech Stack:** TypeScript, Express, Prisma.

## Global Constraints

- Nenhuma mudança de schema.
- Este projeto **não é um repositório git no momento** — nenhum passo deste plano inclui `git commit`.
- Fora de escopo (não tocar): `updateResultEntry`, e o endpoint de edição em massa `/resultados/bulk-update` (`BulkEditPanel.tsx`).
- Nenhum teste unitário novo — `resultados.service.ts`/`resultados-bulk-import.service.ts` não têm arquivo de teste hoje (funções orquestradoras com banco real; validação por smoke real, mesmo padrão já estabelecido nesta sessão).
- Validação de cada task: `npm run tsc` limpo antes de passar para a próxima.

---

### Task 1: `assertNoMemberClosingForType` + chamadas em `createResultEntry`/`createOperationalAdjustment`

**Files:**
- Modify: `src/server/services/resultados.service.ts`

**Interfaces:**
- Consumes: `firstDayOfMonth(date: Date): Date`, `DbClient` (ambos já existentes no arquivo), `ConflictError` (já importado), `prisma` (já importado).
- Produces: `export async function assertNoMemberClosingForType(companyId: string, memberId: string, date: Date, typeId: string, client?: DbClient): Promise<void>` — consumido pelo Task 2 (`resultados-bulk-import.service.ts`).

- [ ] **Step 1: Adicionar `assertNoMemberClosingForType` logo abaixo de `assertPeriodOpen`**

Local atual (`resultados.service.ts`):

```ts
export async function assertPeriodOpen(companyId: string, date: Date, client: DbClient = prisma) {
  const period = await client.commercialPeriod.findFirst({
    where: { companyId, referenceMonth: firstDayOfMonth(date) },
  });

  if (period?.status === "FECHADO") {
    throw new ConflictError(
      "Este período está fechado. Reabra o fechamento para editar os dados.",
    );
  }
}
```

Adicionar logo abaixo:

```ts
// Um Fechamento de Membro (MemberClosing) trava, por Tipo de Resultado, só
// os Tipos que de fato foram apurados nele (MemberClosing.resultsByType —
// já é a soma de ResultEntry+OperationalAdjustment daquele mês, gravada no
// momento do Fechamento). Diferente de assertPeriodOpen (trava o mês
// inteiro, independente do Tipo): aqui um Tipo de Resultado não apurado
// naquele Fechamento continua livre para lançamento no mesmo Membro+Mês.
export async function assertNoMemberClosingForType(
  companyId: string,
  memberId: string,
  date: Date,
  typeId: string,
  client: DbClient = prisma,
): Promise<void> {
  const closing = await client.memberClosing.findUnique({
    where: { memberId_referenceMonth: { memberId, referenceMonth: firstDayOfMonth(date) } },
    select: { companyId: true, resultsByType: true },
  });
  if (!closing || closing.companyId !== companyId) return;

  const resultsByType = closing.resultsByType as unknown as { resultTypeId: string }[];
  if (resultsByType.some((r) => r.resultTypeId === typeId)) {
    throw new ConflictError("Impossível lançar este resultado pois o período tem um fechamento realizado para o membro");
  }
}
```

- [ ] **Step 2: Chamar em `createResultEntry`**

Local atual:

```ts
export async function createResultEntry(companyId: string, requestingUser: RequestingUser, data: ResultEntryInput) {
  assertNonNegativeResultValue(data.value);
  await assertCanMutateResults(companyId, requestingUser, data.memberId);
  await assertMemberAndTypeBelongToCompany(companyId, data.memberId, data.typeId);
  const date = toDate(data.date);
  await assertPeriodOpen(companyId, date);

  return prisma.resultEntry.create({
```

Trocar para:

```ts
export async function createResultEntry(companyId: string, requestingUser: RequestingUser, data: ResultEntryInput) {
  assertNonNegativeResultValue(data.value);
  await assertCanMutateResults(companyId, requestingUser, data.memberId);
  await assertMemberAndTypeBelongToCompany(companyId, data.memberId, data.typeId);
  const date = toDate(data.date);
  await assertPeriodOpen(companyId, date);
  await assertNoMemberClosingForType(companyId, data.memberId, date, data.typeId);

  return prisma.resultEntry.create({
```

- [ ] **Step 3: Chamar em `createOperationalAdjustment`**

Local atual:

```ts
export async function createOperationalAdjustment(
  companyId: string,
  requestingUser: RequestingUser,
  data: OperationalAdjustmentInput,
) {
  await assertCanMutateResults(companyId, requestingUser, data.memberId);
  await assertMemberAndTypeBelongToCompany(companyId, data.memberId, data.typeId);
  const dateReference = toDate(data.dateReference);
  await assertPeriodOpen(companyId, dateReference);

  return prisma.operationalAdjustment.create({
```

Trocar para:

```ts
export async function createOperationalAdjustment(
  companyId: string,
  requestingUser: RequestingUser,
  data: OperationalAdjustmentInput,
) {
  await assertCanMutateResults(companyId, requestingUser, data.memberId);
  await assertMemberAndTypeBelongToCompany(companyId, data.memberId, data.typeId);
  const dateReference = toDate(data.dateReference);
  await assertPeriodOpen(companyId, dateReference);
  await assertNoMemberClosingForType(companyId, data.memberId, dateReference, data.typeId);

  return prisma.operationalAdjustment.create({
```

- [ ] **Step 4: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 2: Chamar `assertNoMemberClosingForType` em `commitResultsImport` (importação em massa)

**Files:**
- Modify: `src/server/services/resultados-bulk-import.service.ts`

**Interfaces:**
- Consumes: `assertNoMemberClosingForType` (Task 1).
- Produces: nada consumido por outra task deste plano — última task de código.

- [ ] **Step 1: Adicionar ao import existente de `./resultados.service`**

Local atual:

```ts
import { assertCanMutateResults, assertPeriodOpen } from "./resultados.service";
```

Trocar para:

```ts
import { assertCanMutateResults, assertNoMemberClosingForType, assertPeriodOpen } from "./resultados.service";
```

- [ ] **Step 2: Chamar dentro do loop de `commitResultsImport`, dentro da transação**

Local atual:

```ts
        if (!member || !type || !row.date || row.value === null) {
          throw new ConflictError(`Linha ${row.rowNumber} não pôde ser resolvida no momento da gravação.`);
        }

        await assertPeriodOpen(companyId, row.date, tx);

        if (row.value < 0) {
```

Trocar para:

```ts
        if (!member || !type || !row.date || row.value === null) {
          throw new ConflictError(`Linha ${row.rowNumber} não pôde ser resolvida no momento da gravação.`);
        }

        await assertPeriodOpen(companyId, row.date, tx);
        await assertNoMemberClosingForType(companyId, member.id, row.date, type.id, tx);

        if (row.value < 0) {
```

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 3: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 22`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Preparar um cenário de teste com Fechamento real**

Usando a API como Admin (`admin@demo.com`): escolher um Membro real com Resultados de "Valor Vendido" já lançados num mês em Aberto (`GET /resultados/entries?memberId=...` para achar um), e fechar esse Membro+Mês via `PUT /fechamento/:memberId/:referenceMonth` (ou pela UI). Confirmar via `GET /fechamento/:memberId/:referenceMonth` que o Fechamento tem `resultsByType` incluindo o `typeId` de "Valor Vendido".

- [ ] **Step 2: Smoke test no navegador — lançamento manual bloqueado**

Numa sessão isolada do `agent-browser`, logado como Admin: em "Resultados" → "Lançamento por Membro", selecionar o Membro fechado no Step 1, mês igual ao do Fechamento, Tipo de Resultado = "Valor Vendido" (o mesmo apurado):

1. Tentar lançar um Resultado (Tipo de Lançamento = Resultado) — confirmar que a mensagem de erro exibida é exatamente "Impossível lançar este resultado pois o período tem um fechamento realizado para o membro".
2. Trocar Tipo de Lançamento para Deságio, tentar lançar — confirmar o mesmo bloqueio.
3. Trocar o Tipo de Resultado para um que NÃO está em `resultsByType` daquele Fechamento (ex.: "Clientes Atendidos", se não fez parte) — confirmar que o lançamento é aceito normalmente (mensagem de sucesso, linha aparece em `HistoryTable`). Excluir esse lançamento de teste ao final (via botão Excluir).

- [ ] **Step 3: Smoke test — importação em massa bloqueada**

Na aba "Resultados" → painel de importação em massa (`ResultsBulkImportPanel`), montar/enviar 1 linha para o mesmo Membro+Mês+Tipo "Valor Vendido" bloqueado — confirmar que o commit falha e a mensagem de erro exibida menciona o bloqueio (mesmo comportamento "tudo ou nada" que `assertPeriodOpen` já tinha antes desta Parte, não é regressão nova).

- [ ] **Step 4: Limpeza**

Reabrir o Fechamento de teste criado no Step 1 (`DELETE /fechamento/:memberId/:referenceMonth`), se esse Fechamento não existia antes do teste — devolvendo o Membro ao estado original. Fechar a sessão isolada do `agent-browser`.

- [ ] **Step 5: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 21`, um novo registro:

```markdown
### PASSO 22 (FEITO <data>) — Bloqueio de lançamento em período com Fechamento apurado

Pedido do usuário: parte D de um novo pedido de 4 partes (D, E, F, G — as próximas 3 ainda pendentes). Quando um Fechamento é realizado para um Membro num Período, os Tipos de Resultado apurados naquele Fechamento devem ficar bloqueados para novos lançamentos (Resultado ou Deságio, manual ou em massa) nesse Membro+Período, com a mensagem "Impossível lançar este resultado pois o período tem um fechamento realizado para o membro".

**Implementado**: `assertNoMemberClosingForType` (nova, `resultados.service.ts`) consulta `MemberClosing.resultsByType` (já grava todos os Tipos de Resultado apurados no Fechamento, sem mudança de schema) — chamada em `createResultEntry`/`createOperationalAdjustment` (lançamento manual) e em `commitResultsImport` (`resultados-bulk-import.service.ts`, lançamento em massa, dentro da mesma transação). Fora de escopo, deliberadamente: `updateResultEntry` e o endpoint de edição em massa de lançamentos já existentes (`/resultados/bulk-update`) — o pedido foi especificamente sobre lançamentos novos.

**Validação**: `tsc` (server) limpo em cada task. Smoke real: Fechamento de teste com "Valor Vendido" apurado bloqueou lançamento manual (Resultado e Deságio) e importação em massa do mesmo Tipo no mesmo Membro+Mês, com a mensagem exata pedida; um Tipo de Resultado diferente (não apurado naquele Fechamento) continuou liberado normalmente. Fechamento de teste reaberto ao final para não alterar permanentemente os dados do Membro.

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
