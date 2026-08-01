# Detalhe de Meta em "Minhas Metas" — Design

## Contexto

Parte 1 de 3 de um pedido maior do usuário (as outras duas — deep-link Fechamento→Recebíveis e detalhe de Base de Recebível com gráficos novos em "Minhas Bases" — são specs separadas, feitas em sequência). Hoje, `MinhasMetasTab.tsx` (PASSO 14) mostra só cards com barras de progresso por período, sem nenhum jeito de ver mais detalhe da Meta. O usuário quer que, ao clicar num card, abra uma tela com as mesmas informações que a tela de edição do Gestor/Admin (`GoalLineDetailPage.tsx`, acessada em "Campanhas") mostra, só que **somente leitura** — sem nenhum controle de edição.

## Descoberta de investigação — zero mudança de backend

- `getGoalLineDetail` (`metas.service.ts`, usado por `GET /metas/:campaignId/linha/:entityType/:entityId`) já checa permissão via `assertVisibleScope`, que para um usuário OPERACIONAL libera automaticamente a visualização do próprio Membro vinculado (vínculo concede VISUALIZAR sem precisar de nenhuma atribuição extra — regra já existente em `resolveVisibleMemberFilter`). Ou seja, este endpoint já funciona corretamente para o caso de autoatendimento, sem nenhuma alteração.
- `GET /metas` (`listGoalCampaigns`) não tem nenhuma restrição de papel — qualquer usuário autenticado da empresa já pode listar campanhas (nome, datas, Tipo de Resultado).
- `MyGoalLineSummary` (retorno de `GET /metas/minhas`) já traz `goalLineId` e `goalCampaignId`; `entityType` é sempre `"MEMBRO"` e `entityId` é sempre o próprio `memberId` do usuário (já disponível no client via `useAuthStore`) — não precisa vir do backend.

Conclusão: esta entrega é **só frontend** — uma página nova + uma rota nova + um pequeno ajuste de navegação em `MetasPage.tsx`.

## Decisão de arquitetura: página nova e isolada

`MyGoalLineDetailPage.tsx` novo, em vez de estender `GoalLineDetailPage.tsx` (550 linhas, várias responsabilidades de edição) com um modo `readOnly`. Motivo: isola por completo o caminho de autoatendimento do caminho de edição — reduz o risco de um usuário comum acabar vendo (ou, pior, conseguindo acionar) um controle de edição por uma condição esquecida, e mantém os dois arquivos menores e mais fáceis de raciocinar isoladamente.

## O que a tela mostra

Busca `GET /metas` (encontra a campanha pelo `campaignId` da URL — mesmo padrão de `GoalLineDetailPage.tsx`) + `GET /metas/:campaignId/linha/MEMBRO/:entityId?lineId=` (mesmo endpoint da tela do Gestor).

Campos exibidos (todos já vêm nas duas respostas acima — nenhum é novo, mas 4 deles não são renderizados hoje na tela do Gestor como campo próprio, só existem no payload):
- Nome da Entidade (`detail.entityName`) + **Hierarquia** (`detail.hierarchyPath`) — *novo campo exibido, dado já existe*.
- **Tipo de Resultado** (`campaign.resultType.name` + `.unit`) — *novo campo exibido*.
- **Período de Vigência** (`campaign.startDate`–`campaign.endDate`) — *novo campo exibido*.
- Tipo de Cálculo / motor (`ENGINE_LABELS[detail.engineType]`) — igual à tela do Gestor.
- **Sazonalidades aplicadas**: mensal (`detail.seasonalityBaseName`) e diária (`detail.dailySeasonalityBaseName`), cada uma como campo rotulado — *hoje só aparece dentro do texto do formulário de edição; vira campo próprio aqui*.
- Status: "Ativa" ou "Inativa desde `<data>`" (`detail.inactivatedAt`) — texto, sem botão.
- Valor Inicial, Valor Final, Crescimento no Período, Média Mensal — idênticos à tela do Gestor (mesmos campos, mesma formatação).
- Gráficos Mensal e Trimestral — reaproveita `GoalLinePeriodChart` (já inclui barra do período + linha do acumulado, sem alteração).
- Gráfico Diário com seletor de mês — mesma lógica de `activeMonth`/`dailyChartData` de `GoalLineDetailPage.tsx`.
- Se `engineType === "AGRUPAMENTO"`: tabela "Origens do Agrupamento" (informativa — nível, entidade, campanha, valor atual), sem nenhum controle de reconfiguração.

**Fora da tela** (controles de edição, não aparecem): botão Reativar/Desativar, grade "Meta por Mês (editável)", formulário de Sazonalidade Diária, painel de Reforecast.

## Navegação

- Cada card em `MinhasMetasTab.tsx` vira um elemento clicável, navegando para `/metas/minhas/:campaignId/linha/MEMBRO/:entityId?lineId=:goalLineId` (`entityId` = `ownMemberId`, já disponível no componente).
- Rota nova em `routes/index.tsx`: `/metas/minhas/:campaignId/linha/:entityType/:entityId` → `<RequireAuth><MyGoalLineDetailPage /></RequireAuth>` (mesmo padrão de proteção da rota irmã de edição — a permissão real é aplicada no backend via `assertVisibleScope`).
- Botão "← Voltar" navega explicitamente para `/metas?tab=minhas` (não `navigate(-1)`) — precisa que `MetasPage.tsx` passe a guardar a aba ativa (`campanhas`/`minhas`) num parâmetro de URL (`?tab=`), mesmo padrão que o componente já usa para `campaignId` e `status` via `useSearchParams`. Isso conserta também um caso de hoje: um Admin/Gestor que troca para a aba "Minhas Metas" e navega para outra tela perde a aba ao voltar (reseta pro padrão) — pequeno ajuste, mesmo arquivo, mesma sessão de trabalho.

## Testes

Sem lógica de negócio nova no backend — nenhum teste de service novo necessário. Validação: `tsc` (client) limpo; smoke no navegador com usuário real (Membro com Linha em campanha vigente, já usado no PASSO 14) — clicar no card, conferir os campos novos (Hierarquia/Tipo de Resultado/Período/Sazonalidades) e os gráficos, confirmar ausência de qualquer controle de edição, testar "Voltar" preservando a aba "Minhas Metas".
