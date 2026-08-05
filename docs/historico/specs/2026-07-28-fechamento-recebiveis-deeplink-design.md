# Deep-link Fechamento → Recebíveis — Design

## Contexto

Parte 2 de 3 de um pedido maior do usuário (parte 1 — detalhe de Meta em "Minhas Metas" — já entregue no PASSO 16; parte 3 — detalhe de Base de Recebível com gráficos novos em "Minhas Bases" — vem depois). Pedido literal: ao clicar numa das "caixas" de Recebível dentro do Fechamento de um Membro, navegar para a tela de Recebíveis já com o filtro de Período/Entidade/Meta preenchido para aquela caixa específica, evidenciando a informação que gerou aquele valor.

## Descobertas de investigação

- **"Caixa de Recebível"** = componente `CampaignCard` dentro de `src/client/pages/fechamento/MemberClosingDetailPage.tsx`. Cada card representa 1 `(receivablesBaseId, periodStart)` — os campos disponíveis no objeto `campaign` (`ClosingCampaignRow`, `src/client/pages/fechamento/types.ts`) incluem `receivablesBaseId`, `baseName`, `periodStart`, `periodEndExclusive` (a janela **daquela caixa específica** — uma Base Semanal tem ~4 janelas por mês dentro do mesmo Fechamento mensal, não é o mês inteiro).
- **`RecebiveisPage.tsx` já filtra 100% via URL** (`useSearchParams`, não `useState`): `entityType`, `entityIds` (CSV), `periodStart`, `periodEnd`. Um deep-link é só montar essa URL — nenhum estado novo no lado de Recebíveis.
- **A tela de Recebíveis é sempre ao vivo** (`useRecebiveisOverview` recalcula na hora, para qualquer período pedido) — não existe hoje (e esta entrega não cria) uma visão "congelada" no valor exato do momento do fechamento. Isso já é o comportamento correto e esperado para qualquer período passado filtrado manualmente hoje; o deep-link não introduz nenhuma divergência nova, só preenche o filtro sozinho. Se os dados subjacentes mudaram desde o fechamento (resultado lançado depois, fechamento reaberto e reeditado), o valor ao vivo pode diferir do congelado em `MemberClosing`/`FinancialPeriodSnapshot` — comportamento pré-existente, não uma regressão desta entrega.
- **Papel de "Meta" no filtro**: `RecebiveisFilters` hoje não tem um campo de Meta/Base específica — a tela mostra a visão agregada do período inteiro para a entidade. Um deep-link de 1 só Membro (`entityIds.length === 1`) sempre cai na tabela "Ganho por Meta" (`GanhoPorMetaTable.tsx`, `overview.table.kind === "GANHO_POR_META"` — confirmado em `recebiveis.service.ts`, regra `memberRows.length === 1`), que já tem 1 linha por `(receivablesBaseId, periodStart)` — a peça que falta é só destacar visualmente a linha certa, não filtrar as demais.

## Desenho

1. **`CampaignCard` vira clicável** (`MemberClosingDetailPage.tsx`) — navega para:
   ```
   /recebiveis?entityType=MEMBRO&entityIds=<memberId>&periodStart=<campaign.periodStart>&periodEnd=<campaign.periodEndExclusive − 1 dia>&highlightBaseId=<campaign.receivablesBaseId>&highlightPeriodStart=<campaign.periodStart>
   ```
   `memberId` vem do `useParams` já existente na página (`MemberClosingDetailPage` já é acessada como `/fechamento/:memberId/:referenceMonth`). Funciona igual para quem vê o próprio Fechamento ou o de outro Membro (Gestor/Admin) — o mecanismo só depende do `memberId` da tela, não de quem está logado.
2. **`RecebiveisPage.tsx` lê 2 parâmetros novos, opcionais**: `highlightBaseId`/`highlightPeriodStart` (mesmo padrão dos já existentes — `searchParams.get(...)`, sem exigir nada). Repassa para `GanhoPorMetaTable` como props opcionais.
3. **`GanhoPorMetaTable` ganha destaque visual condicional**: quando uma linha bate `row.receivablesBaseId === highlightBaseId && row.periodStart.slice(0,10) === highlightPeriodStart`, aplica uma borda de destaque (mesma cor `primary` já usada em outros destaques do projeto) na linha, e a página rola até ela ao montar (`scrollIntoView`, 1 `useEffect` simples). Sem parâmetro, comportamento idêntico ao de hoje (nenhuma linha destacada, sem scroll).
4. **Sem toque em `DistribuicaoTable`** — um deep-link de Fechamento é sempre de 1 Membro específico, nunca cai na visão de grupo.

## Casos de borda

- Se por algum motivo a janela exata da caixa não aparecer mais na tabela (ex: Base excluída entre o fechamento e agora) — a tela de Recebíveis já trata "nenhuma linha" normalmente (mensagem "Nenhuma Base de Recebível aplicável neste período"); o destaque simplesmente não encontra a linha e não aplica nada — sem erro.
- Usuário (OPERACIONAL) clicando na própria caixa: `entityType`/`entityIds` da URL são ignorados pela tela de Recebíveis para esse papel (`isSelfOnly` já força o próprio Membro) — inofensivo incluir mesmo assim, mantém a URL consistente entre papéis.

## Testes

Sem lógica de negócio nova no backend. Validação: `tsc` (client) limpo; smoke no navegador — clicar numa caixa de Recebível no Fechamento (papel Usuário vendo o próprio, e Admin/Gestor vendo o de outro Membro), confirmar a URL gerada, o filtro já preenchido, a linha certa destacada e a página rolando até ela.
