# Fechamento — corrigir "Fechar Selecionados" + Selecionar Todos + Reabrir Selecionados — Design

## Contexto

Parte E de 4 (D já entregue — PASSO 22). Na tela de Fechamento (`FechamentoPage.tsx`), "Fechar Selecionados" não fecha de fato os Fechamentos marcados. Pedido: corrigir isso, adicionar um botão "Selecionar Todos" (tudo que está filtrado e é permitido) e um botão "Reabrir Selecionados" (reabre os selecionados que estiverem Fechados) — com cuidado para o botão novo não ter o mesmo problema do antigo.

## Causa raiz do bug (achada na investigação)

`rowKey(row)` monta a chave de seleção como `` `${row.memberId}:${row.referenceMonth}` ``, mas `row.referenceMonth` é um ISO **completo** (`"2026-04-01T00:00:00.000Z"`), que também contém `:`. `closeSelected()` desfaz a chave com `key.split(":")` e pega só os 2 primeiros pedaços — a data sai cortada e inválida (`"2026-04-01T00"`). O backend recebe essa data malformada, `saveClosing` provavelmente falha ao resolver o mês (ou grava num registro errado), e `saveClosingBulk` (que já captura erro por item, sucesso parcial esperado) reporta tudo como falha — dando a impressão de "não fecha de fato". A correção é 1 linha: cortar `referenceMonth` para só a data (`.slice(0, 10)`, sem `:`) antes de montar a chave — mesma fatia que a navegação de linha já usa (`row.referenceMonth.slice(0, 10)`, linha da tabela).

## Design

### Correção do bug

`rowKey` passa a usar `` `${row.memberId}:${row.referenceMonth.slice(0, 10)}` `` — chave sem `:` interno, `split(":")` volta a funcionar. Isso sozinho já resolve "Fechar Selecionados".

### Seleção passa a incluir linhas Fechadas também

Hoje `isRowSelectable` só permite marcar linhas `ABERTO`. Para permitir "Reabrir Selecionados", passa a permitir `ABERTO` **e** `FECHADO` (nunca `PREVISTO` — período ainda não encerrado; nunca a própria linha do Gestor logado — mesma trava de auto-fechamento/auto-reabertura já existente no backend).

### 2 botões de ação, cada um filtrando a própria seleção

Em vez de assumir que toda a seleção serve para 1 ação só, cada botão filtra a seleção pelo status relevante antes de agir — assim uma seleção mista (algumas Abertas, algumas Fechadas) nunca gera erro ou comportamento ambíguo:

- **"Fechar Selecionados (N)"**: só aparece se a seleção tiver ao menos 1 linha `ABERTO`; ao clicar, processa só essas (reaproveita `useSaveClosingBulk`/`POST /fechamento/bulk-save`, já existente, agora recebendo a chave corrigida).
- **"Reabrir Selecionados (N)"**: só aparece se a seleção tiver ao menos 1 linha `FECHADO`; processa só essas. **Endpoint novo** no backend, espelhando exatamente `saveClosingBulk` (mesmo padrão "1 resultado por item, sucesso parcial esperado", reaproveitando a função `reopenClosing` já existente e já testada — nenhuma lógica de reabertura nova, só o loop em lote).
- **"Selecionar Todos"**: sempre visível quando há ao menos 1 linha selecionável na tabela filtrada atual (independente de já haver seleção) — marca `rows.filter(isRowSelectable)` inteiro.
- **"Limpar seleção"**: como já existe hoje.

O resumo de resultado (`bulkSummary`) passa a indicar qual ação gerou aquele resultado ("X Fechamento(s) concluído(s)"/"X Fechamento(s) reaberto(s)"), evitando ambiguidade quando as 2 ações forem usadas em sequência.

## Backend

### `reopenClosingBulk` (novo, `fechamento.service.ts`) — espelha `saveClosingBulk`

```ts
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
```

Rota nova: `POST /fechamento/bulk-reopen`, mesmo formato de corpo (`{ items }`) e mesma resposta (array de resultado por item) que `/fechamento/bulk-save`.

## Frontend

- `useReopenClosingBulk()` (novo hook, `useFechamentoQueries.ts`), espelhando `useSaveClosingBulk()` — reaproveita os tipos `CloseBulkItem`/`CloseBulkResult` já existentes (mesmo formato).
- `FechamentoPage.tsx`: `rowKey` corrigido; `isRowSelectable` aceita `ABERTO`+`FECHADO`; `selectedAbertoKeys`/`selectedFechadoKeys` derivados da seleção atual cruzada com `rows`; botão "Selecionar Todos"; `closeSelected()` usa só `selectedAbertoKeys`; `reopenSelected()` (novo) usa só `selectedFechadoKeys`; `bulkSummary` ganha um rótulo de ação.

## Testes

Nenhuma função pura nova além do espelhamento direto de um padrão já existente e testado (`saveClosingBulk`→`reopenClosingBulk`). Validação: `tsc` (server+client); smoke real — selecionar via "Selecionar Todos", fechar um subconjunto Aberto (confirmar que os Status mudam de fato para Fechado, corrigindo o bug relatado), depois reabrir esse mesmo subconjunto via "Reabrir Selecionados" (confirmar que voltam para Aberto), e confirmar que uma seleção mista (Abertos + Fechados ao mesmo tempo) mostra os 2 botões e cada um age só no que é dele.
