# Tabela de Beneficiários na edição de Base de Recebível — Design

## Contexto

Parte B de 3 ajustes independentes pedidos pelo usuário (Parte A — hierarquia e referências em "Minha Base de Recebível" — já entregue, PASSO 19). Na tela de edição de uma Base de Recebível (Admin/Gestor, `ReceivablesBaseDetailPage.tsx`), adicionar uma tabela com 1 linha por Beneficiário (Nome, Hierarquia Completa do Beneficiado, Hierarquia Completa da Entidade Analisada, quantos Gatilhos Condicionais se aplicam, botão Simulador na própria linha) e, ao clicar na linha, abrir a mesma tela de detalhe que "Minhas Bases" usa — agora reaproveitada para o Admin/Gestor ver o detalhe de **qualquer** Beneficiário da Base. O card "Simulador" atual (com seletor genérico de Beneficiário) é removido, substituído pelo botão por linha.

## Descobertas de investigação

- **Hierarquia**: mesma dupla `resolveAncestorIds`+`buildHierarchyPath` da Parte A, aplicada agora a 2 entidades por Beneficiário: o próprio Membro (`MEMBRO`/`memberId`, para "Hierarquia Completa do Beneficiado") e a Entidade Analisada (`entityType`/`entityId`, já resolvida como `entityName` — para "Hierarquia Completa da Entidade Analisada"). Só faz sentido calcular isso para a tela de edição (usada por Admin/Gestor, olhando N Beneficiários de uma vez) — **não** vou colocar esse cálculo em `fetchReceivablesBaseDetail` (função crua, compartilhada com `getMyReceivablesBaseDetail` e o endpoint de simulação, ambos hot-paths que só precisam da hierarquia de 1 Beneficiário por vez, já resolvida separadamente). Fica isolado em `getReceivablesBaseDetail`, a função já usada só pelo endpoint de configuração (`GET /bases-recebiveis/:id`).
- **Contagem de Gatilhos Condicionais por Beneficiário**: não precisa de campo novo no backend — `ReceivablesBaseDetail.conditionalTriggers` já vem com `applicableMemberIds: string[]` para cada Gatilho (lista vazia = aplica a todos). A mesma regra de `triggerAppliesToMember` (`applicableMemberIds.length === 0 || applicableMemberIds.includes(memberId)`, `bases-recebiveis.service.ts:962`) é só 1 linha — reproduzida no client, filtrando `base.conditionalTriggers` já carregado pela tela.
- **Reaproveitamento da tela de detalhe**: `getMyReceivablesBaseDetail` (`bases-recebiveis.service.ts`) já faz TODO o cálculo necessário (Gatilhos aplicáveis, Degraus, séries por período) a partir de 2 coisas: a Base crua (`fetchReceivablesBaseDetail`) e 1 Beneficiário específico — as únicas linhas que dependem de "sou eu mesmo" são a resolução inicial do `memberId` (linhas 1730-1735). O resto (linhas 1737-1831) é puro `(base, beneficiary, page) → resposta`, extraível para uma função compartilhada.
- **Checagem de permissão para a nova rota de Admin**: mesmo padrão já usado no endpoint de simulação (`resolveReceivablesBaseAccess` → `FULL`/`PARTIAL`/`NONE` + `ownedMemberIds`). Mas a decisão de escopo é diferente conforme a ação:
  - **Visualizar o detalhe** (nova rota): mesma filosofia já documentada em `getReceivablesBaseDetail` — "acesso PARCIAL abre a Base inteira... para contexto". A tela nova é somente-leitura (sem Realizado, sem controle de edição), então Gestor com acesso PARCIAL pode visualizar o detalhe de **qualquer** Beneficiário da Base (não só os seus), consistente com o que ele já vê hoje nos cards de Gatilhos/Degraus/Beneficiados (config completa da Base, mesmo fora do seu escopo).
  - **Simular** (endpoint já existente, inalterado): continua restrito — Gestor PARCIAL só simula para Beneficiários dentro de `ownedMemberIds` (`ForbiddenError` já implementado). Isso significa que a tela de detalhe precisa saber se PODE oferecer o botão "Simular" para aquele Beneficiário específico — novo campo `canSimulate: boolean` na resposta (self-service: sempre `true`, já que simulação do próprio Membro nunca é bloqueada por escopo; visão de Admin: `access.level === "FULL" || access.ownedMemberIds.has(memberId)`).
  - Na tabela nova, Beneficiários fora do escopo do Gestor PARCIAL ficam com o botão Simulador travado (🔒 "Somente consulta"), mesmo padrão visual já usado em `AnalyzedEntitiesModal.tsx`/`ConditionalTriggersModal.tsx` — mas a LINHA continua clicável (visualizar é permitido pra todos).
- **`SimulatorModal.tsx`** (o "botão geral" a remover) só é referenciado por `ReceivablesBaseDetailPage.tsx` — remover essa referência o deixa órfão; o arquivo é apagado por completo (nenhuma outra tela usa).

## Backend

### `getReceivablesBaseDetail` — enriquecer `beneficiaries` com hierarquia

Cada item de `base.beneficiaries` ganha 2 campos novos: `memberHierarchyPath: string | null` (ancestralidade do próprio Membro) e `entityHierarchyPath: string | null` (ancestralidade da Entidade Analisada — mesmo dado que a Parte A chama de `hierarchyPath` na tela de autoatendimento, renomeado aqui só para não colidir com o significado de "hierarquia de quem" quando há 2 no mesmo objeto).

### Extrair `buildReceivablesBaseDetailForBeneficiary` — função compartilhada

Todo o corpo de `getMyReceivablesBaseDetail` a partir da resolução do `beneficiary` (cálculo de `hierarchyPath`, `goalOrResultLabel`, `conditionalTriggers`, `tierLadder`, período/paginação, `tierPeriods`, `triggerSeries`, montagem da resposta) vira uma função privada `buildReceivablesBaseDetailForBeneficiary(companyId, base, beneficiary, canSimulate, page)`, reaproveitada por 2 funções públicas:

- `getMyReceivablesBaseDetail(companyId, requestingUser, baseId, page)` (existente): resolve `memberId` via `resolveRequesterMemberId`, acha o `beneficiary`, chama a função compartilhada com `canSimulate = true`.
- `getReceivablesBaseDetailForBeneficiary(companyId, requestingUser, baseId, memberId, page)` (novo): busca a Base crua, resolve `access` via `resolveReceivablesBaseAccess` (`NONE` → 403), acha o `beneficiary` por `memberId` (não encontrado → 404), chama a função compartilhada com `canSimulate = access.level === "FULL" || access.ownedMemberIds.has(memberId)`.

A resposta de ambas continua tipada como `MyReceivablesBaseDetailResponse`, que ganha o campo `canSimulate: boolean`.

### Rota nova

`GET /bases-recebiveis/:id/beneficiario/:memberId/graficos?page=<offset>` — `RequireRole(["ADMINISTRADOR", "LIDERANCA_NO"])`, mesmo nível de acesso já exigido por `GET /bases-recebiveis/:id`.

## Frontend

### Tipos e hooks

- `BeneficiaryRow` (`types.ts`) ganha `memberHierarchyPath: string | null` e `entityHierarchyPath: string | null`.
- `MyReceivablesBaseDetail` (`types.ts`) ganha `canSimulate: boolean`.
- Novo hook `useReceivablesBaseDetailForBeneficiary(baseId, memberId, page)` em `useReceivablesQueries.ts`, espelhando `useMyReceivablesBaseDetail` (mesmo tipo de resposta `MyReceivablesBaseDetail` — reaproveitado, nenhum tipo novo).

### `hierarchy.ts` (novo, pequeno) — deduplica `LEVEL_LABEL`/`formatFullHierarchy`

Hoje `LEVEL_LABEL`+`formatFullHierarchy` (Parte A) vivem só dentro de `MyReceivablesBaseDetailPage.tsx`. Com a tabela nova precisando do mesmo formato, viram um módulo pequeno compartilhado (`src/client/pages/bases-recebiveis/hierarchy.ts`), importado pelos 2 lugares.

### `ReceivablesBaseDetailView.tsx` (novo) — UI extraída de `MyReceivablesBaseDetailPage.tsx`

Todo o JSX de exibição hoje em `MyReceivablesBaseDetailPage.tsx` (cabeçalho, Gatilhos, Degraus, gráficos, paginação, botão Simular) vira este componente de apresentação, recebendo por props: `detail: MyReceivablesBaseDetail`, `page: number`, `onPageChange: (page: number) => void`, `memberId: string` (pra quem é o Simulador — não lê mais `useAuthStore` internamente), `onBack: () => void`. O botão/modal "Simular" só aparece se `detail.canSimulate`.

`MyReceivablesBaseDetailPage.tsx` (self-service) vira um wrapper fino: lê `:id` da rota, `ownMemberId` do `useAuthStore`, usa `useMyReceivablesBaseDetail`, renderiza `<ReceivablesBaseDetailView>` com `onBack` indo pra `/bases-recebiveis?tab=minhas` (comportamento igual ao de hoje).

### `BeneficiaryReceivablesBaseDetailPage.tsx` (novo) — wrapper fino pro Admin/Gestor

Lê `:id`/`:memberId` da rota, usa `useReceivablesBaseDetailForBeneficiary`, renderiza `<ReceivablesBaseDetailView>` com `memberId` vindo da URL (não do usuário logado) e `onBack` indo pra `/bases-recebiveis/:id` (volta pra tela de edição da Base). Rota nova: `/bases-recebiveis/:id/beneficiario/:memberId`.

### `BeneficiariesSummaryTable.tsx` (novo) — a tabela pedida

Recebe `base: ReceivablesBaseDetail` (o objeto inteiro já carregado por `ReceivablesBaseDetailPage.tsx`, sem chamada extra). 1 linha por `base.beneficiaries[i]`:

- **Nome**: `beneficiary.member.fullName`.
- **Hierarquia do Beneficiado**: `formatFullHierarchy(beneficiary.memberHierarchyPath, "MEMBRO", beneficiary.member.fullName)`.
- **Hierarquia da Entidade Analisada**: `formatFullHierarchy(beneficiary.entityHierarchyPath, beneficiary.entityType, beneficiary.entityName)`.
- **Gatilhos Condicionais**: contagem de `base.conditionalTriggers` cujo `applicableMemberIds` inclui esse Beneficiário (ou está vazio).
- **Simulador**: botão que abre `MySimulatorModal` (reaproveitado sem alteração), com os Gatilhos filtrados pra esse Beneficiário — travado (🔒, `disabled`, `title="Somente consulta"`) se `base.access === "PARTIAL"` e o Beneficiário não estiver em `base.editableBeneficiaryMemberIds`.

Clicar na linha (fora da célula do botão — `stopPropagation` no clique do botão) navega para `/bases-recebiveis/${base.id}/beneficiario/${beneficiary.memberId}`, sempre disponível (ver decisão de escopo acima).

### `ReceivablesBaseDetailPage.tsx` — grid perde o card "Simulador", ganha a tabela

Remove o card "Simulador" do grid (fica só Beneficiados/Entidades Analisadas/Gatilhos Condicionais/Degraus e Recompensas) e o `case "simulador"` do `openModal`. `SimulatorModal.tsx` é apagado (sem outros usos). Nova seção `<BeneficiariesSummaryTable base={base} />` logo abaixo do grid de cards.

## Testes

Nenhuma função pura nova além da extração (`buildReceivablesBaseDetailForBeneficiary` é refatoração, mesmo comportamento já coberto indiretamente pelo smoke do PASSO 18/19). Validação: `tsc` (server+client) limpo a cada task; smoke no navegador cobrindo — tabela renderizando hierarquias corretas para Beneficiários em níveis diferentes (Membro/Time/Departamento); clique na linha abrindo o detalhe correto; botão Simulador da linha abrindo `MySimulatorModal` pré-filtrado; um caso de acesso PARCIAL (Gestor com só parte dos Beneficiários no escopo) confirmando 🔒 no Simulador dos que são de fora, mas linha ainda clicável; "← Voltar" da tela de detalhe (via Admin) retornando pra `/bases-recebiveis/:id`.
