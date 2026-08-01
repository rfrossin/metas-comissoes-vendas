# Recebíveis por Campanha — renomear, navegar pro detalhe, corrigir "No Topo" e "Ganho Potencial" — Design

## Contexto

Parte F de 4 (D e E já entregues — PASSOs 22 e 23). Na tela de Recebíveis: 1) renomear "Ganho por Meta" para "Recebíveis por Campanha"; 2) clicar numa linha abre o detalhe da Base de Recebível (mesma tela de "Minhas Bases de Recebível"); 3) corrigir "Próximo Degrau", que às vezes mostra "No Topo" mesmo quando ainda faltam Degraus acima; 4) redefinir "Ganho Potencial" como o valor se batesse **exatamente o último Degrau**, indicando Acumulado ou Na Faixa.

## Causa raiz do bug "No Topo" (achada na investigação)

Em `bases-recebiveis.service.ts`, tanto `computeLiveReceivablesOutcome` (usada por Recebíveis e por "Minhas Bases") quanto `simulateReceivablesBase` (Simulador) constroem o `fullLadder` (status "batido"/"não batido" de cada Degrau) assim:

```ts
const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
// ...
achieved: achievedIds.has(tier.id)
```

`pickAchievedTiers` em modo **Faixa** devolve só o Degrau mais alto batido (linha 889: `return [achieved[achieved.length - 1]]`) — correto para CALCULAR o pagamento (na Faixa só o Degrau mais alto conta), mas errado para marcar "batido" no ladder completo: um Membro no Degrau 2 de 5 (que já ultrapassou o limiar dos Degraus 1 e 2) tem `achievedIds = {Degrau 2}` só — o Degrau 1 fica marcado como **não batido**, mesmo com o limiar dele já superado. `nextTier = fullLadder.find(!achieved)` então acha o Degrau 1 primeiro, calcula `gap = limiar do Degrau 1 - atingimento`, que dá **negativo → 0** (já ultrapassado) — e o client, vendo `gap <= 0`, mostra "No Topo" mesmo faltando 3 Degraus acima.

**Correção**: extrair a construção do `fullLadder` para uma função pura separada, que marca "achieved" por comparação direta de limiar (`attainmentValue >= tier.threshold`) — sem depender de `pickAchievedTiers` (essa continua correta e intocada para CALCULAR o pagamento, só não deve mais alimentar o ladder completo). 1 correção usada nos 2 lugares — corrige de brinde o mesmo problema no Simulador (`SimulationResultPanel`) e em "Minhas Bases" (`MyReceivablesBasesTab`), que reaproveitam o mesmo `fullLadder`.

## Design

### 1. Renomear "Ganho por Meta" → "Recebíveis por Campanha"

Só o texto do cabeçalho em `RecebiveisPage.tsx` (`{overview.table.kind === "GANHO_POR_META" ? "Ganho por Meta" : "Distribuição"}`).

### 2. Clicar na linha abre o detalhe da Base

`GanhoPorMetaResult` (`recebiveis.service.ts`) **já** devolve `member: {id, fullName}` no nível raiz do resultado (não precisa de campo novo) — `RecebiveisPage.tsx` passa esse `memberId` como prop nova pra `GanhoPorMetaTable`. Cada linha já tem `receivablesBaseId`. A linha vira clicável, navegando para:
- `/bases-recebiveis/minhas/{receivablesBaseId}` se `memberId === ownMemberId` (o próprio usuário vendo o próprio Recebível — mesma tela de "Minhas Bases", PASSO 18/19);
- `/bases-recebiveis/{receivablesBaseId}/beneficiario/{memberId}` caso contrário (Admin/Gestor vendo o Recebível de outro Membro — mesma tela de detalhe reaproveitada pro Admin, PASSO 20).

Nenhuma rota nova — as 2 já existem.

### 3. Corrigir "Próximo Degrau" ("No Topo" só quando é de verdade)

Consequência direta da correção da causa raiz acima — `nextTierGap` volta a refletir corretamente quanto falta pro Degrau seguinte não-batido de verdade; "No Topo" só aparece quando `fullLadder` não tem mais nenhum Degrau não-batido.

### 4. "Ganho Potencial" = valor no último Degrau, com Acumulado/Na Faixa

Hoje `nextTierPotentialPayout` simula o pagamento se batesse o **próximo** Degrau. Passa a ser `topTierPotentialPayout`: simula o pagamento se batesse **exatamente o Degrau de maior ordem** (o mesmo mecanismo já usado para o "próximo", só trocando qual limiar é simulado — `pickAchievedTiers` aplicado ao limiar do último Degrau, que já respeita Faixa/Cumulativo automaticamente: em Cumulativo, soma todos; em Faixa, só o último). A tabela mostra o valor formatado + um rótulo "Acumulado" ou "Na Faixa" (`base.triggerMode`, já disponível — só faltava serializar em `serializeRow`).

## Backend

### `bases-recebiveis.service.ts`

- Nova função pura `buildFullLadder(attainmentValue: Prisma.Decimal, thresholds: TierThreshold[]): LadderRungStatus[]` — substitui a construção duplicada e com bug em `simulateReceivablesBase` e `computeLiveReceivablesOutcome` (remove de brinde o `tierSource` que virou redundante nos 2 lugares — `thresholds` já carrega `order`/`threshold` certos).
- `LiveReceivablesOutcome` ganha `topTierPotentialPayout: Prisma.Decimal` — calculado 1x (igual a `nextTier`, reaproveitando `payoutForTierIds`+`pickAchievedTiers` já existentes, só trocando o limiar de referência pro do Degrau de maior `order`), incluído nas 3 respostas da função (bloqueado/zero-atingido/sucesso — sempre calculável, independente do resultado).

### `recebiveis.service.ts`

- `MemberReceivableRow`: troca `nextTierPotentialPayout` por `topTierPotentialPayout` (só usado aqui — confirmado sem outro uso no projeto).
- `serializeRow`: inclui `triggerMode` (já existe no tipo, faltava serializar) e `topTierPotentialPayout` (no lugar de `nextTierPotentialPayout`).
- `getMemberGanhoPorMeta`: sem mudança (já devolve `member.id`).

## Frontend

- `types.ts`: `GanhoPorMetaRow` ganha `triggerMode`, troca `nextTierPotentialPayout` por `topTierPotentialPayout`.
- `GanhoPorMetaTable.tsx`: prop nova `memberId: string`; linha vira clicável (`useNavigate`, `useAuthStore` pro `ownMemberId`); coluna "Ganho Potencial" passa a mostrar `topTierPotentialPayout` + rótulo Acumulado/Na Faixa.
- `RecebiveisPage.tsx`: renomeia o cabeçalho; passa `memberId={overview.table.member.id}` pra `GanhoPorMetaTable`.

## Testes

Nenhum teste unitário novo previsto além de possivelmente cobrir `buildFullLadder` isoladamente (função pura, fácil de testar — decidir no plano se `bases-recebiveis.service.test.ts` já cobre algo parecido a reaproveitar como modelo). Validação: `tsc` (server+client); smoke real — achar (ou simular via API) um Beneficiário no meio do ladder (não no Degrau 1, não no último) numa Base trilha Faixa, confirmar que "Próximo Degrau" mostra o gap certo (não "No Topo"); confirmar "Ganho Potencial" bate com o cálculo manual do último Degrau, com o rótulo certo (Acumulado/Na Faixa conforme a Base); clicar numa linha como o próprio usuário (self) e como Admin vendo outro Membro, confirmar que cada caso abre a rota certa.
