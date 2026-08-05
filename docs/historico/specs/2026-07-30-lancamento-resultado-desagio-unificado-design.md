# Lançamento unificado de Resultado/Deságio — Design

## Contexto

Parte C de 3 ajustes independentes pedidos pelo usuário (Partes A e B já entregues — PASSOs 19 e 20). Hoje, "Lançamento por Membro" (`LaunchSection.tsx`, aba "Resultados") mostra 2 quadros lado a lado: `ResultEntryForm.tsx` (Tipo de Resultado, Data, Valor — sempre ≥ 0) e `AdjustmentForm.tsx` (Tipo de Resultado, Data, Valor com negativo permitido, Motivo opcional). Pedido: fundir os 2 em 1 quadro só, onde o usuário escolhe primeiro o Tipo de Lançamento (Resultado ou Deságio) e o formulário se adapta — campos: Tipo de Resultado, Tipo de Lançamento, Data, Valor, Motivo (só aparece se Deságio).

## Descobertas de investigação

- Backend inalterado: `POST /resultados/entries` (Resultado, `{memberId, typeId, date, value}`, valor sempre ≥ 0) e `POST /resultados/adjustments` (Deságio, `{memberId, typeId, dateReference, value, reason?}`, valor pode ser negativo) já são os 2 endpoints certos — o formulário unificado só decide qual chamar.
- `BRNumberField.tsx` (reaproveitado sem alteração) já resolve exatamente a diferença de validação entre os 2 tipos via sua prop `allowNegative` — trocar essa prop dinamicamente conforme o Tipo de Lançamento escolhido já dá a validação certa "de graça" (inclusive: se o usuário digitar um valor negativo em Deságio e depois trocar pra Resultado, o campo passa a mostrar erro na hora, sem lógica extra).
- `ResultEntryForm.tsx`/`AdjustmentForm.tsx` não têm nenhum outro uso no projeto além de `LaunchSection.tsx` — seguros para apagar por completo.
- `HistoryTable.tsx` (não tocado) já lê `result-entries` E `operational-adjustments` juntos numa lista combinada, e seu próprio handler de exclusão já invalida as 3 queries (`result-entries`, `operational-adjustments`, `realizado-liquido`) incondicionalmente, mesmo removendo só 1 tipo de registro — mesmo padrão replicado aqui: o formulário unificado invalida as 3 sempre, independente de qual tipo foi lançado.

## Design

### `LaunchEntryForm.tsx` (novo) — substitui `ResultEntryForm.tsx` + `AdjustmentForm.tsx`

Único quadro, campos na ordem pedida:

1. **Tipo de Resultado** — select, igual aos 2 formulários de hoje.
2. **Tipo de Lançamento** — 2 botões lado a lado ("Resultado" / "Deságio", o selecionado destacado), não um `<select>` — é a decisão principal do fluxo ("informe antes se é Deságio ou Resultado"), um toggle de 2 opções fica mais direto que abrir um dropdown. Começa em "Resultado" (caso mais comum).
3. **Data** — 1 campo só (`date`), reaproveitado pro payload dos 2 endpoints (`date` quando Resultado, `dateReference` quando Deságio — mesmo valor, nome de campo diferente só na hora de montar o body).
4. **Valor** (`BRNumberField`) — `allowNegative` segue o Tipo de Lançamento (`false` pra Resultado, `true` pra Deságio); rótulo e `negativeHint` atualizados pra refletir que agora é uma troca de Tipo de Lançamento, não "o quadro ao lado".
5. **Motivo** — só renderizado (não só desabilitado) quando Tipo de Lançamento = Deságio, igual ao campo de hoje em `AdjustmentForm.tsx` (opcional).

Botão de envio e mensagem de sucesso mudam de texto conforme o Tipo de Lançamento ("Lançar Resultado"/"Resultado lançado." vs "Lançar Deságio"/"Deságio lançado."), preservando a comunicação de cada ação de hoje.

### `LaunchSection.tsx` — grid de 2 colunas vira 1 formulário só

Troca `<div className="grid gap-4 md:grid-cols-2"><ResultEntryForm .../><AdjustmentForm .../></div>` por `<LaunchEntryForm memberId={memberId} />` direto (sem grid). `HistoryTable` abaixo continua igual.

## Testes

Nenhuma lógica nova de cálculo — mudança de UI/composição de formulário. Validação: `tsc` (client) limpo; smoke no navegador lançando 1 Resultado e 1 Deságio (com Motivo) pelo formulário novo, conferindo que ambos aparecem corretos em `HistoryTable` e que a validação de valor negativo muda junto com o Tipo de Lançamento.
