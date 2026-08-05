# Detalhe de Base em "Minhas Bases" — Design

## Contexto

Parte 3 de 3 de um pedido maior do usuário (partes 1 e 2 já entregues — PASSOs 16 e 17). A mais trabalhosa das três: ao clicar num card em "Minhas Bases" (`MyReceivablesBasesTab.tsx`, PASSO 9.10), abrir uma tela de detalhe com tudo que diz respeito ao usuário naquela Base de Recebível — incluindo 2 gráficos que **não existem em nenhum lugar do sistema hoje**, nem na visão de gestão do Admin/Gestor.

## Princípio central (confirmado explicitamente pelo usuário após revisão)

**A parte gráfica e informacional desta tela é um ambiente 100% SIMULADO — sem nenhum vínculo com Resultado Realizado.** Ela mostra só a "régua de metas": quanto o Beneficiário PRECISARIA fazer, período a período, pra bater cada Gatilho Condicional e cada Degrau — nunca o quanto ele de fato fez. Isso vale mesmo quando o limiar de um Degrau/Gatilho é um percentual de atingimento de Meta (trilha META): o gráfico converte o percentual pro valor absoluto daquele período específico (usando a curva da Meta, que pode ter sazonalidade), mas nunca compara contra o Realizado. Exemplo dado pelo usuário: Gatilho Condicional fixo de R$6.000/mês de vendas (trilha RESULTADO, valor constante todo mês); Degraus na trilha META em Janeiro exigem R$8.000/10.000/12.000/14.000 de venda (pelos 4 percentuais de atingimento aplicados à Meta de Janeiro), e em Fevereiro os valores mudam porque a Meta tem sazonalidade — os gráficos mostram exatamente essa variação mês a mês, sem nenhuma barra de "realizado".

O Simulador (`MySimulatorModal.tsx`, já existente e reaproveitado sem alteração) continua sendo o único lugar da tela onde o usuário informa um resultado hipotético pra ver o recebível resultante — fica posicionado logo abaixo dos gráficos novos.

## Descobertas de investigação

- `computeLiveReceivablesOutcome` (bases-recebiveis.service.ts) já calcula tudo isso pra 1 período, mas junto com Realizado/elegibilidade/payout — não serve diretamente aqui (a tela não deve tocar em Realizado). A parte reaproveitável é a MECÂNICA de conversão % → valor absoluto: `metaTotal` (via `dailyMapOfActiveLine`+`sumDailyMapInWindow`, ambos já exportados) e o equivalente pra Gatilhos (`dailyMapOfActiveLine` na Entidade/Nível de Verificação do Gatilho, mesma soma).
- `enumeratePeriodWindows(periodicity, rangeStart, rangeEndExclusive)` (já existe, `bases-recebiveis.service.ts`) gera a sequência de janelas de fechamento de um intervalo — é exatamente o "período a período" pedido.
- `fetchReceivablesBaseDetail` (versão CRUA, sem checagem de gestão — já usada por `listMyReceivablesBases` para autoatendimento) dá acesso a `valueTiers`, `tierRules`, `conditionalTriggers` — a configuração completa da Base, sem depender de Realizado.
- Paginação: Acompanhamento já pagina Dia/Semana por mês (`monthWindow`, `{monthOffset, hasPrev, hasNext}` — `acompanhamento.service.ts`). Vou replicar o mesmo padrão (não importar cross-service; é uma função pequena, mesmo padrão de duplicação local já usado no projeto para helpers de data).
- `MySimulatorModal.tsx` já funciona exatamente como descrito pelo usuário (Data de Referência + Resultado Simulado → recebível) — reaproveitado sem nenhuma alteração de lógica, só de posição na tela.

## Backend

### `getMyReceivablesBaseDetail(companyId, requestingUser, baseId, page?)` — novo, `bases-recebiveis.service.ts`

1. Resolve o próprio `memberId` (`resolveRequesterMemberId`); sem vínculo ou não sendo Beneficiário desta Base → 404.
2. `fetchReceivablesBaseDetail` (crua) + acha a própria linha em `beneficiaries`.
3. Monta a configuração (sem Realizado):
   - `conditionalTriggers`: filtra por `triggerAppliesToMember` (já existe) — devolve `label`, `verificationLevel`, `indicatorType`, `requiredMinimum` (bruto, `minAttainmentPercentage` ou `minResultValue`).
   - `tierLadder`: 1 entrada por `ReceivablesValueTier` (`order`, `thresholdValue`), cada uma com sua lista de `ReceivablesTierRule` (pode ter mais de 1 recompensa por Degrau — ex. valor em dinheiro + prêmio físico simultâneos).
4. Determina o intervalo de períodos: `rangeStart = base.startDate ?? base.createdAt`; `rangeEndExclusive = min(hoje + 1 dia, base.endDate ?? hoje + 1 dia)`.
5. **Paginação**:
   - Periodicidade `DIARIO`/`SEMANAL` → sempre paginada por mês civil (1 página = todas as janelas cujo início cai dentro de 1 mês) — mesmo padrão de `monthWindow`/`{offset,hasPrev,hasNext}` de Acompanhamento, replicado localmente.
   - `MENSAL`/`TRIMESTRAL`/`ANUAL` → sem paginação se o total de janelas no intervalo for ≤ 12; caindo nisso, paginada em blocos de 12 meses.
   - `page` no request = offset (0 = primeira página); resposta devolve `pagination: {offset, hasPrev, hasNext} | null` (`null` = tudo numa página só).
6. Para cada janela da página atual, calcula (sem Realizado):
   - **Degraus**: se `indicatorType === "META"`, `metaTotal = sumDailyMapInWindow(dailyMapOfActiveLine(primaryGoalCampaignId, entityType, entityId), window)`; `requiredValue[tier] = thresholdValue / 100 * metaTotal`. Se `RESULTADO`, `requiredValue[tier] = thresholdValue` (constante, repete igual em todo período — esperado).
   - **Gatilhos**: mesma lógica por Gatilho, usando `verificationLevel`+a Entidade resolvida (`resolveMemberLevelEntity`, já existe) no lugar da Entidade de Análise do Beneficiário, e `minAttainmentPercentage`/`minResultValue` no lugar do `thresholdValue`.
7. Retorna `{ id, name, indicatorType, goalOrResultLabel, periodicity, triggerMode, startDate, endDate, entityType, entityId, entityName, conditionalTriggers, tierLadder, tierPeriods, triggerSeries, pagination }` — `tierPeriods`/`triggerSeries` só com os dados calculados no passo 6 (valor por Degrau/Gatilho, cumulativo — o cliente calcula o segmento incremental do empilhado por subtração, mesmo padrão já usado em `GoalLinePeriodChart.tsx` pro acumulado).

### Rota

`GET /bases-recebiveis/minhas/:id/graficos?page=<offset>` — registrada depois de `GET /bases-recebiveis/minhas` (já vem antes de `/:id` no arquivo, então não há colisão de qualquer forma, mas mantém a convenção de agrupar as rotas de autoatendimento juntas).

## Frontend

### `MyReceivablesBaseDetailPage.tsx` (novo, rota `/bases-recebiveis/minhas/:id`)

- **Cabeçalho**: nome da Base; se META ou RESULTADO + `goalOrResultLabel`; Período de Fechamento (rótulo da periodicidade); Modo (Faixa: "só o Degrau mais alto batido no período conta"; Cumulativo: "todos os Degraus batidos no período somam") — explicação breve inline; Período de Vigência (datas, ou "sem data definida" se ambas nulas).
- **Beneficiário**: Entidade de Análise (`entityName`); lista de Gatilhos Condicionais (label + mínimo exigido, SEM indicador de passou/não passou — não há Realizado aqui); lista de Degraus de Recompensa (ordem, limiar, recompensa(s) — mesmo SEM indicador de batido/não batido, pelo mesmo motivo).
- **Gráfico de Degraus** (coluna empilhada por período): reaproveita a mesma paleta/base de `GoalLinePeriodChart.tsx` (Recharts `BarChart` com `stackId`) — 1 segmento por Degrau, altura = `requiredValue[tier] - requiredValue[tier-1]` (primeiro = `requiredValue[0] - 0`). Sem cor de status — só a régua.
- **Gráfico(s) de Gatilhos**: 1 `BarChart` simples por Gatilho Condicional (1 barra por período = `requiredValue` daquele Gatilho naquele período).
- **Navegação de página** (só quando `pagination !== null`): botões Anterior/Próximo, mesmo padrão visual já usado em Acompanhamento.
- **Botão Simulador**: logo abaixo dos gráficos, abre `MySimulatorModal.tsx` — reaproveitado tal como está (mesmas props já usadas hoje em `MyReceivablesBasesTab.tsx`: `baseId`, `indicatorType`, `memberId`, `triggers`).

### Navegação

Cada card em `MyReceivablesBasesTab.tsx` vira clicável, indo para `/bases-recebiveis/minhas/:id`. "← Voltar" retorna para `/bases-recebiveis?tab=minhas` — mesmo ajuste de "lembrar a aba" já feito em Metas (PASSO 16) precisa ser replicado em `BasesRecebiveisPage.tsx` (hoje a aba ali também é só `useState`, sem URL).

## Testes

Funções puras novas (conversão % → valor absoluto por período, paginação por mês/12-meses) testáveis em `bases-recebiveis.service.test.ts`. Validação: `tsc` (server+client) + `vitest`; smoke no navegador com uma Base real de trilha META com Sazonalidade (pra confirmar que os valores dos Degraus realmente variam entre períodos) e uma de trilha RESULTADO (pra confirmar os valores constantes, comportamento esperado).
