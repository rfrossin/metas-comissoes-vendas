# Minhas Metas — Design

## Contexto

O módulo Metas (`/metas`) hoje é só a tela de gestão de Campanhas (`MetasPage.tsx`), acessível a qualquer usuário autenticado (a rota não tem `RequireRole`) mas sem nenhum recorte de autoatendimento — um Usuário (OPERACIONAL) que abrir `/metas` vê a tabela de gestão completa de Campanhas da empresa.

Pedido: uma aba "Minhas Metas", no mesmo espírito da aba "Minhas Bases" já existente em Bases de Recebível (PASSO 9.10 do `.planosistemametas`) — autoatendimento disponível para todos os papéis, mostrando as Linhas de Meta em que o próprio usuário participa, com barras de progresso por período (Diário/Semanal/Mensal/Trimestral/Acumulado Total) para o período vigente.

## Decisões de design validadas com o usuário

1. **"Vigente"** = campanhas cujo intervalo `[startDate, endDate]` inclui a data de hoje (literalmente em andamento agora), independente do campo `status`/`inactivatedAt`.
2. **Racional Diário/Semanal**: uma Linha só mostra as barras Diária e Semanal se tiver distribuição real por dia — `dailySeasonalityBaseId` preenchido, OU `seasonalityBase.analysisType` em `DIAS_ANO`/`MESES_DIAS_SEMANA`/`MESES_DIAS_MES`. Caso contrário (bases só Mensal/Trimestral, motor Manual sem overlay, motor Agrupamento sem overlay) a Linha começa direto do Mensal.
3. **Acumulado Total** = período inteiro da campanha: Meta = soma de toda a curva da Linha (Data Inicial–Data Final da campanha); Realizado = soma do Realizado do Membro do início da campanha até hoje.
4. **Escopo de dados** ("Linhas que o usuário participa"): mesma regra literal de Minhas Bases — vínculo direto, sem hierarquia. Concretamente: `GoalLine` com `entityType = MEMBRO`, coluna de ancestralidade `memberId` = o `memberId` do próprio usuário logado (via `resolveRequesterMemberId`), e `inactivatedAt IS NULL` (linha ativa), dentro de uma campanha vigente. Idêntico para Admin/Gestor/Usuário — cada um só vê as próprias. Sem `memberId` vinculado → lista vazia.
5. **Mudança de acesso aceita pelo usuário**: `MetasPage.tsx` passa a ser um container de abas — "Campanhas" (conteúdo atual, inalterado) só para ADMINISTRADOR/LIDERANCA_NO; "Minhas Metas" (nova) para todos os papéis, inclusive OPERACIONAL. Mesmo padrão exato de `BasesRecebiveisPage.tsx` (PASSO 9.10).

## Backend

### `metas.service.ts` — `listMyGoalLines(companyId, requestingUser)`

1. Resolve `memberId` do requisitante via `resolveRequesterMemberId` (scope.util.ts). Sem vínculo → retorna `[]`.
2. Busca campanhas vigentes: `prisma.goalCampaign.findMany({ where: { companyId, startDate: { lte: hoje }, endDate: { gte: hoje } }, include: { resultType: { select: { id, name, unit } } } })`.
3. Para cada campanha vigente, busca a(s) `GoalLine` ativa(s) do próprio Membro: `prisma.goalLine.findMany({ where: { companyId, goalCampaignId, entityType: "MEMBRO", memberId: ownMemberId, inactivatedAt: null }, include: { dailyValues: true, seasonalityBase: { select: { analysisType: true } }, dailySeasonalityBase: { select: { analysisType: true } } } })`.
4. Para cada Linha encontrada:
   - Monta o `DailyMap` de Meta a partir de `dailyValues` (mesmo padrão de `listGoalLines`/`dailyMapOfActiveLine` — usa `isoKey`).
   - Busca o `DailyMap` de Realizado via `getRealizadoDailyMap(companyId, campaign.resultTypeId, "MEMBRO", ownMemberId, campaign.startDate, endDateExclusive)` — função já existente em `acompanhamento.service.ts`, precisa só ser importada aqui (nenhuma lógica nova de agregação de Resultados/Ajustes).
   - Determina `hasDailyRationale`: `line.dailySeasonalityBaseId !== null || ["DIAS_ANO","MESES_DIAS_SEMANA","MESES_DIAS_MES"].includes(line.seasonalityBase?.analysisType)`.
   - Bucketiza os dois mapas com os helpers já existentes: `groupDailyMapBy(daily, monthKeyOf)`, `groupDailyMapBy(daily, isoWeekKey)`, `groupDailyMapBy(daily, quarterKeyOf)`, e a chave do dia (`isoKey(hoje)`) direto no mapa.
   - Para cada granularidade elegível (Diário/Semanal só se `hasDailyRationale`; Mensal/Trimestral sempre), localiza o bucket que contém "hoje" e monta `{ metaValue, realizadoValue, percentage }` (percentage = `realizadoValue / metaValue`, `null` se `metaValue` for zero — sem meta naquele período).
   - Acumulado Total: soma de todos os valores do `DailyMap` de Meta (total da campanha) vs soma de todos os valores do `DailyMap` de Realizado (que já cobre só até "hoje", pois a busca de Realizado é limitada a `[startDate, hoje]`).
5. Retorna um array de `MyGoalLineSummary`:
   ```ts
   interface PeriodProgress { metaValue: string; realizadoValue: string; percentage: string | null }
   interface MyGoalLineSummary {
     goalLineId: string;
     goalCampaignId: string;
     campaignName: string;
     resultTypeName: string;
     resultTypeUnit: "MOEDA" | "NUMERAL";
     hasDailyRationale: boolean;
     diario: PeriodProgress | null;   // null quando !hasDailyRationale
     semanal: PeriodProgress | null;  // null quando !hasDailyRationale
     mensal: PeriodProgress;
     trimestral: PeriodProgress;
     acumulado: PeriodProgress;
   }
   ```
   (Decimais serializados como string, mesmo padrão já usado pelas demais rotas de Metas — o client formata.)

### Rota

`GET /metas/minhas` em `metas.routes.ts`, registrada logo após `GET /` (não colide com `/:campaignId/...` por ter profundidade de path diferente, mas mantém a convenção já usada em Bases de Recebível de registrar antes de qualquer rota parametrizada).

### Controller

`listMyGoalLinesHandler` — mesmo padrão trivial de `listGoalCampaignsHandler` (sem `try/catch` extra; erros de infraestrutura já sobem pro `errorMiddleware`).

## Frontend

### `MetasPage.tsx`

Vira container de abas, mesmo padrão de `BasesRecebiveisPage.tsx`:
- `canManage = role === "ADMINISTRADOR" || role === "LIDERANCA_NO"`.
- Abas: `"campanhas"` (conteúdo atual da página, extraído sem alteração de lógica para dentro do próprio componente ou mantido inline — decisão de implementação, sem impacto de comportamento) visível só se `canManage`; `"minhas"` (novo `MinhasMetasTab.tsx`) sempre visível.
- Aba default: `canManage ? "campanhas" : "minhas"`.

### `MinhasMetasTab.tsx` (novo)

- `useQuery(["my-goal-lines"], () => api.get("/metas/minhas"))`.
- Sem `memberId` vinculado (`useAuthStore` → `user.memberId`) → mensagem "Seu usuário não está vinculado a um Membro — não há Metas para exibir aqui." (mesmo texto/padrão de Minhas Bases).
- Lista vazia (com vínculo) → "Você não tem Metas individuais em campanhas vigentes no momento."
- Um card por `MyGoalLineSummary`: cabeçalho com nome da campanha + Tipo de Resultado; uma `<ProgressBar>` por período elegível, cada uma com rótulo (`"Mensal — R$ 12.400 / R$ 20.000 (62%)"`, formatação de moeda/número conforme `resultTypeUnit`) e preenchimento visual `min(100%, percentage)`, com indicação textual se ultrapassou 100%. `percentage === null` (meta zero no período) → rótulo "sem meta neste período" em vez de barra.
- Novo componente pequeno `ProgressBar.tsx` (reaproveitável, sem estado, só props `label/percentage`).

## Edge cases

- Sem `memberId` vinculado → vazio (mensagem).
- Nenhuma campanha vigente ou nenhuma Linha MEMBRO própria ativa → vazio (mensagem).
- `metaValue` zero num bucket específico (ex: mês sem meta na curva) → `percentage: null`, exibido como "sem meta" em vez de dividir por zero.
- Campanha vigente mas Linha do Membro foi recalculada/inativada e substituída por outra — `inactivatedAt: null` já filtra para pegar só a Linha ativa atual (mesmo padrão do resto do módulo).

## Testes

- Unitários novos em `metas.service.test.ts`: função de elegibilidade de racional diário (`hasDailyRationale`) para as combinações de `analysisType`/`dailySeasonalityBaseId`/engineType; bucketização do "hoje" dentro de mês/semana/trimestre (reaproveita helpers já testados — só testar a nova função de localizar o bucket corrente).
- `tsc` (server + client) e `vitest` completo sem quebrar os testes existentes.
- Smoke via API real: usuário de teste com Linha MEMBRO numa campanha vigente, `GET /metas/minhas` retornando os 5 blocos esperados; usuário sem `memberId` → `[]`; Linha só com Base Mensal → `diario`/`semanal` null; Linha com Base DIAS_ANO → `diario`/`semanal` presentes.
- Navegador: abrir `/metas` como Usuário (só vê "Minhas Metas") e como Admin (vê as duas abas), conferir barras renderizando com os valores esperados.
