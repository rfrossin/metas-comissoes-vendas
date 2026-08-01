# Ajustes no detalhe de "Minha Base de Recebível" — Hierarquia e Referências — Design

## Contexto

Parte A de 3 pedidos independentes de ajuste trazidos pelo usuário no mesmo dia da entrega do PASSO 18 (detalhe de Base em "Minhas Bases"). Dois ajustes na mesma tela (`MyReceivablesBaseDetailPage.tsx`):

1. "Entidade de Análise" hoje mostra só o nome (ex: "Terceirização Brasil") — falta a hierarquia completa.
2. Falta deixar claro qual Meta ou qual Tipo de Resultado alimenta cada Degrau/Gatilho Condicional.

Esta parte é pré-requisito da Parte B (nova tabela de Beneficiários na tela de edição de Base, que vai reaproveitar esta mesma tela de detalhe para o Admin/Gestor) — por isso vem primeiro.

## 1. Hierarquia completa da Entidade de Análise

### Descoberta

`resolveAncestorIds(companyId, entityType, entityId)` (`scope.util.ts`) e `buildHierarchyPath(companyId, entityType, ancestorIds)` (`metas.service.ts`, já reexportado e usado por `fechamento.service.ts` para o mesmo fim) resolvem a ancestralidade de **qualquer** entidade de `OrgScopeType` — não são específicos de Meta. `bases-recebiveis.service.ts` já importa `resolveAncestorIds` de `metas.service.ts`; só falta importar `buildHierarchyPath` também. Nenhuma função nova no backend.

`buildHierarchyPath` devolve a cadeia do ancestral **imediato até o topo** (ex.: para um Time, `"Hospitalar>Atacado"` — Departamento primeiro, Canal depois), ou `null` se não há nada acima (Canal/Empresa). Este é o mesmo formato já usado em "Minhas Metas" (PASSO 16), onde é exibido como `{entityName} · {Nível} ({hierarchyPath})`.

O usuário pediu um formato diferente para esta tela — ordem invertida (topo primeiro) com o nome e o nível no final, ex.: `"Atacado>Hospitalar>São Paulo (Time)"`. A composição desse formato final é responsabilidade do **client**: o backend só manda o `hierarchyPath` cru (mesmo campo/semântica de sempre); o client já tem `entityType`+`entityName` e monta a string invertendo as partes e anexando `{entityName} ({LEVEL_LABEL})` no fim. Isso mantém o campo do backend consistente com o resto do sistema e isola a formatação nova (específica desta tela) no componente de apresentação — a tela de Metas não é tocada.

### Backend

`MyReceivablesBaseDetailResponse` (e a função que a preenche, `getMyReceivablesBaseDetail`) ganha 1 campo novo: `hierarchyPath: string | null`, calculado a partir de `beneficiary.entityType`/`beneficiary.entityId` (a mesma Entidade de Análise que já resolve `entityName` hoje) — mesma chamada dupla (`resolveAncestorIds` + `buildHierarchyPath`) já usada em `fechamento.service.ts`.

### Frontend

Em `MyReceivablesBaseDetailPage.tsx`, a exibição de "Entidade de Análise" passa a montar a string completa: se `hierarchyPath` for `null`, mostra só `"{entityName} ({LEVEL_LABEL})"`; se não for `null`, inverte as partes (`hierarchyPath.split(">").reverse()`) e anexa `"{entityName} ({LEVEL_LABEL})"` no final, juntando tudo com `">"`. `LEVEL_LABEL` é o mesmo mapa `Record<ScopeType, string>` já usado em várias telas do módulo (`EMPRESA`→"Empresa", `CANAL`→"Canal", `DEPARTAMENTO`→"Departamento", `TIME`→"Time", `MEMBRO`→"Membro").

## 2. Qual Meta/Resultado referencia cada Degrau/Gatilho

### Descoberta

Já existe quase tudo — é só uma questão de deixar explícito na tela:

- Cada **Gatilho Condicional** já tem sua própria Meta/Resultado de referência, independente da Meta/Resultado da Base (`ReceivablesConditionalTrigger.conditionalGoalCampaignId`/`resultTypeId` — pode ser uma Campanha diferente da usada nos Degraus). O nome dessa Meta/Resultado já é devolvido como `trigger.label` (ex.: "Terceirização - Venda ($) - 2026") e `trigger.indicatorType` já diz se é Meta ou Resultado — só falta o rótulo deixar isso explícito na tela.
- Os **Degraus** (todos, sempre) usam a Meta/Resultado única da Base inteira — já devolvida em `goalOrResultLabel`/`indicatorType` e já exibida 1x no topo da página ("Baseado no Tipo de Resultado: Valor Vendido"). Falta repetir essa referência perto dos Degraus, para não depender do usuário lembrar do topo da página.

**Nenhuma mudança de backend** — os dois campos (`trigger.label`+`trigger.indicatorType`, `goalOrResultLabel`+`indicatorType`) já existem na resposta de hoje.

### Frontend

Em `MyReceivablesBaseDetailPage.tsx`:
- Cada item da lista de Gatilhos Condicionais passa de `"{label} — mínimo {valor}"` para `"{Meta|Resultado}: {label} — mínimo {valor}"`, escolhendo o prefixo por `trigger.indicatorType`.
- O título da seção "Degraus de Recompensa" passa a incluir a referência: `"Degraus de Recompensa — baseados {na Meta|no Resultado} \"{goalOrResultLabel}\""`.

## Testes

Nenhuma função pura nova — só passagem de dado adicional (`hierarchyPath`) e formatação de texto. Validação: `tsc` (server+client) limpo, e smoke visual no navegador confirmando a hierarquia completa e os novos rótulos nos 2 tipos de Base já usados no smoke do PASSO 18 (uma trilha META com Sazonalidade, uma trilha RESULTADO).
