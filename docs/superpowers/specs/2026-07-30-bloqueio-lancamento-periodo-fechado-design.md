# Bloqueio de lançamento em período com Fechamento apurado — Design

## Contexto

Parte D de 4 novas verificações/atualizações pedidas pelo usuário no mesmo dia da entrega do PASSO 21 (fechando o pedido anterior de 3 partes). Quando um Fechamento é realizado para um Membro num Período, os Tipos de Resultado que foram apurados naquele Fechamento devem ficar bloqueados para novos lançamentos (Resultado ou Deságio, manual ou em massa) naquele mesmo Membro+Período — com a mensagem: **"Impossível lançar este resultado pois o período tem um fechamento realizado para o membro"**.

## Descoberta

`MemberClosing.resultsByType` (`prisma/schema.prisma`) já é exatamente o dado necessário: `Json` no formato `[{resultTypeId, resultTypeName, totalValue}]` — **todos** os Tipos de Resultado lançados pelo Membro naquele mês (`ResultEntry`+`OperationalAdjustment` somados, `computeResultsByType`, `fechamento.service.ts`), gravado no momento do Fechamento (`saveClosing`). A existência de uma linha `MemberClosing` para `(memberId, referenceMonth)` já significa Status=FECHADO (confirmado em `getClosingDetail`/`listClosings`, `fechamento.service.ts`) — não precisa de mais nenhuma consulta para saber "está fechado".

Nenhuma mudança de schema. A checagem é: existe `MemberClosing` para este Membro+Mês? Se sim, o `typeId` do lançamento está em `resultsByType`? Se sim, bloqueia.

## Escopo

Cobre as 2 vias de **criação** de lançamento, exatamente como pedido ("em massa ou mesmo manual"):
- `createResultEntry`/`createOperationalAdjustment` (`resultados.service.ts`) — lançamento manual, usado por `LaunchEntryForm.tsx` (PASSO 21).
- `commitResultsImport` (`resultados-bulk-import.service.ts`) — lançamento em massa via planilha.

**Fora de escopo, deliberadamente**: `updateResultEntry` (edição individual, sem UI atualmente) e o endpoint de edição em massa (`BulkEditPanel.tsx`/`/resultados/bulk-update`, que troca Tipo/Data/Motivo de lançamentos **já existentes**). O pedido do usuário fala em "lançamento" (entrada nova) — editar um lançamento antigo pra dentro de um período fechado é um cenário diferente, não pedido agora. Se o usuário quiser essa cobertura depois, é uma extensão pontual da mesma função de checagem.

## Implementação

### `assertNoMemberClosingForType` (nova, privada, `resultados.service.ts`)

```ts
async function assertNoMemberClosingForType(companyId: string, memberId: string, date: Date, typeId: string, client: DbClient = prisma): Promise<void> {
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

Mesmo padrão de `assertPeriodOpen` já existente no arquivo — aceita um `client` de transação opcional, para ser chamada tanto fora (`createResultEntry`/`createOperationalAdjustment`) quanto dentro do `$transaction` de `commitResultsImport`.

### Pontos de chamada

- `createResultEntry`: logo após `assertPeriodOpen(companyId, date)`.
- `createOperationalAdjustment`: logo após `assertPeriodOpen(companyId, dateReference)`.
- `commitResultsImport` (`resultados-bulk-import.service.ts`): logo após `assertPeriodOpen(companyId, row.date, tx)`, passando `tx` como client — mesmo comportamento "tudo ou nada" que `assertPeriodOpen` já tem nessa função hoje (1 linha bloqueada aborta o lote inteiro; não é um comportamento novo desta Parte, é o padrão já existente que está sendo replicado).

## Testes

Função pura o suficiente para teste unitário direto (dado um `MemberClosing` mockado/uma chamada real ao Prisma em teste de integração leve, se o arquivo já tiver esse padrão — a verificar durante o plano). Validação: `tsc` (server) limpo; smoke real — Fechar um Membro num mês com Resultados de "Valor Vendido" apurados, depois tentar lançar manualmente e via planilha um novo Resultado/Deságio de "Valor Vendido" no mesmo Membro+Mês (deve bloquear com a mensagem exata) e de um Tipo de Resultado diferente não apurado naquele Fechamento (deve permitir normalmente).
