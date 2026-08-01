# Recebíveis por Campanha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renomear "Ganho por Meta" para "Recebíveis por Campanha", tornar a linha clicável (abrindo o detalhe da Base de Recebível), corrigir o bug de "No Topo" indevido no "Próximo Degrau", e redefinir "Ganho Potencial" como o valor no último Degrau (com rótulo Acumulado/Na Faixa).

**Architecture:** A causa raiz do bug é isolada numa função pura nova (`buildFullLadder`), testada e reaproveitada nos 2 lugares que hoje duplicam a construção do ladder com o bug (`simulateReceivablesBase` e `computeLiveReceivablesOutcome`). "Ganho Potencial" vira um campo novo (`topTierPotentialPayout`) calculado com o mesmo mecanismo já usado pro "próximo degrau", só trocando qual limiar é simulado. A navegação de linha reaproveita as 2 rotas de detalhe de Base já existentes (PASSOs 18-20), sem rota nova.

**Tech Stack:** TypeScript, Express, Prisma, Vitest (server); React + TypeScript, React Router (client).

## Global Constraints

- Nenhuma mudança de schema, nenhuma rota nova.
- Este projeto **não é um repositório git no momento** — nenhum passo deste plano inclui `git commit`.
- Validação de cada task: `npm run tsc` limpo; tasks com função pura nova também rodam `npm run test` (Vitest).

---

### Task 1: `buildFullLadder` — função pura nova, com teste (TDD)

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts`
- Modify: `src/server/services/bases-recebiveis.service.test.ts`

**Interfaces:**
- Consumes: `Prisma.Decimal`, `TierThreshold` (`{id, order, threshold}`), `LadderRungStatus` (`{order, threshold, achieved}`) — todos já existentes no arquivo.
- Produces: `buildFullLadder(attainmentValue: Prisma.Decimal, thresholds: TierThreshold[]): LadderRungStatus[]` — consumido pelo Task 2.

- [ ] **Step 1: Escrever o teste que reproduz o bug**

Em `bases-recebiveis.service.test.ts`, adicionar `buildFullLadder` ao import existente:

```ts
import {
  buildFullLadder,
  computeAttainmentValue,
  computePayout,
  computeRequiredValue,
  computeTierPayout,
  enumeratePeriodWindows,
  pickAchievedTiers,
  resolvePeriodWindow,
  resolveReceivablesBasePage,
  sumDailyMapInWindow,
  triggerAppliesToMember,
  type TierRewardConfig,
  type TierThreshold,
} from "./bases-recebiveis.service";
```

Adicionar, logo depois do `describe("pickAchievedTiers"...)` já existente:

```ts
describe("buildFullLadder — status de cada Degrau é comparação PURA de limiar (não reaproveita pickAchievedTiers)", () => {
  const tiers = [threshold(1, 80, "G1"), threshold(2, 100, "G2"), threshold(3, 120, "G3"), threshold(4, 140, "G4"), threshold(5, 160, "G5")];

  it("marca como batidos TODOS os degraus já ultrapassados, mesmo em modo Faixa (onde pickAchievedTiers devolveria só o mais alto)", () => {
    // Achado do bug: um Beneficiário no Degrau 2 (100<=x<120) tinha o Degrau 1
    // marcado como "não batido" (porque pickAchievedTiers em Faixa só retorna
    // G2), fazendo "Próximo Degrau" achar G1 primeiro e mostrar gap<=0 → "No Topo".
    const ladder = buildFullLadder(d(105), tiers);
    expect(ladder.map((r) => r.achieved)).toEqual([true, true, false, false, false]);
  });

  it("nenhum degrau batido quando o atingimento é menor que o primeiro limiar", () => {
    const ladder = buildFullLadder(d(50), tiers);
    expect(ladder.every((r) => !r.achieved)).toBe(true);
  });

  it("todos os degraus batidos quando o atingimento supera o último limiar", () => {
    const ladder = buildFullLadder(d(200), tiers);
    expect(ladder.every((r) => r.achieved)).toBe(true);
  });

  it("devolve em ordem crescente de order, independente da ordem de entrada", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    const ladder = buildFullLadder(d(90), shuffled);
    expect(ladder.map((r) => r.order)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm run test -- bases-recebiveis.service.test.ts`
Expected: FAIL — `buildFullLadder is not a function` (ainda não existe/não está exportada).

- [ ] **Step 3: Implementar `buildFullLadder`**

Em `bases-recebiveis.service.ts`, logo abaixo de `pickAchievedTiers` (que hoje termina em `return [achieved[achieved.length - 1]]; }`), adicionar:

```ts
// Ladder completo com o status de "atingido" por Degrau — comparação PURA
// de limiar (attainmentValue >= tier.threshold), independente do Modo
// (Faixa/Cumulativo). NÃO reaproveitar pickAchievedTiers aqui: em modo
// Faixa ela devolve só o Degrau mais alto batido (correto pra CALCULAR o
// pagamento), e usar isso pra marcar "achieved" no ladder completo faz os
// Degraus abaixo do atual aparecerem como não batidos — bug encontrado no
// "Próximo Degrau"/"No Topo" de Recebíveis (um Membro no Degrau 2 de 5
// aparecia como "No Topo", porque o Degrau 1 — já ultrapassado — era o
// primeiro "não batido" encontrado).
export function buildFullLadder(attainmentValue: Prisma.Decimal, thresholds: TierThreshold[]): LadderRungStatus[] {
  return [...thresholds]
    .sort((a, b) => a.order - b.order)
    .map((tier) => ({ order: tier.order, threshold: tier.threshold, achieved: attainmentValue.greaterThanOrEqualTo(tier.threshold) }));
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm run test -- bases-recebiveis.service.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos).

- [ ] **Step 5: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 2: Usar `buildFullLadder` em `simulateReceivablesBase` e `computeLiveReceivablesOutcome`

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts`

**Interfaces:**
- Consumes: `buildFullLadder` (Task 1).
- Produces: nada novo — só corrige o comportamento de `fullLadder` nas 2 funções (consumido indiretamente por tudo que já usa essas 2 funções: Recebíveis, Simulador, "Minhas Bases").

- [ ] **Step 1: Corrigir em `simulateReceivablesBase`**

Local atual:

```ts
  const thresholds: TierThreshold[] = base.valueTiers.map((tier) => ({ id: tier.id, order: tier.order, threshold: tier.thresholdValue }));
  const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
  const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
  const tierSource = (tierId: string) => base.valueTiers.find((valueTier) => valueTier.id === tierId)!;
  const achievedTiersInfo: AchievedTierInfo[] = achievedThresholds.map((tier) => {
    const source = tierSource(tier.id);
    return { order: source.order, threshold: tier.threshold };
  });
  const fullLadder: LadderRungStatus[] = thresholds
    .map((tier) => {
      const source = tierSource(tier.id);
      return { order: source.order, threshold: tier.threshold, achieved: achievedIds.has(tier.id) };
    })
    .sort((a, b) => a.order - b.order);

  // Avalia TODAS as Condições aplicáveis a este Beneficiário (não para no
```

Trocar para:

```ts
  const thresholds: TierThreshold[] = base.valueTiers.map((tier) => ({ id: tier.id, order: tier.order, threshold: tier.thresholdValue }));
  const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
  const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
  const achievedTiersInfo: AchievedTierInfo[] = achievedThresholds.map((tier) => ({ order: tier.order, threshold: tier.threshold }));
  const fullLadder = buildFullLadder(attainmentValue, thresholds);

  // Avalia TODAS as Condições aplicáveis a este Beneficiário (não para no
```

(`tierSource` era só usado nesses 2 trechos — `thresholds` já carrega `order`/`threshold` certos, o lookup era redundante.)

- [ ] **Step 2: Corrigir em `computeLiveReceivablesOutcome`**

Local atual (bloco idêntico ao do Step 1, no meio de `computeLiveReceivablesOutcome`):

```ts
  const thresholds: TierThreshold[] = base.valueTiers.map((tier) => ({ id: tier.id, order: tier.order, threshold: tier.thresholdValue }));
  const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
  const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
  const tierSource = (tierId: string) => base.valueTiers.find((valueTier) => valueTier.id === tierId)!;
  const achievedTiersInfo: AchievedTierInfo[] = achievedThresholds.map((tier) => {
    const source = tierSource(tier.id);
    return { order: source.order, threshold: tier.threshold };
  });
  const fullLadder: LadderRungStatus[] = thresholds
    .map((tier) => {
      const source = tierSource(tier.id);
      return { order: source.order, threshold: tier.threshold, achieved: achievedIds.has(tier.id) };
    })
    .sort((a, b) => a.order - b.order);

  const applicableTriggers = base.conditionalTriggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));
```

Trocar para:

```ts
  const thresholds: TierThreshold[] = base.valueTiers.map((tier) => ({ id: tier.id, order: tier.order, threshold: tier.thresholdValue }));
  const achievedThresholds = pickAchievedTiers(attainmentValue, thresholds, base.triggerMode);
  const achievedIds = new Set(achievedThresholds.map((tier) => tier.id));
  const achievedTiersInfo: AchievedTierInfo[] = achievedThresholds.map((tier) => ({ order: tier.order, threshold: tier.threshold }));
  const fullLadder = buildFullLadder(attainmentValue, thresholds);

  const applicableTriggers = base.conditionalTriggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));
```

**Atenção**: este bloco é textualmente idêntico ao do Step 1 — se usar busca-e-troca no editor, confirme que trocou nos 2 lugares (Step 1 fica dentro de `simulateReceivablesBase`, Step 2 dentro de `computeLiveReceivablesOutcome`, mais abaixo no arquivo — são funções diferentes, ambas precisam da correção).

- [ ] **Step 3: Rodar `tsc` e os testes**

Run: `npm run tsc && npm run test`
Expected: sem erros; todos os testes passam (108 + 4 novos do Task 1 = 112).

---

### Task 3: `topTierPotentialPayout` em `computeLiveReceivablesOutcome`

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts`

**Interfaces:**
- Consumes: `payoutForTierIds`, `pickAchievedTiers`, `thresholds` (já existentes/em escopo dentro de `computeLiveReceivablesOutcome`).
- Produces: `LiveReceivablesOutcome.topTierPotentialPayout: Prisma.Decimal` — consumido pelo Task 4.

- [ ] **Step 1: Adicionar o campo à interface**

Local atual:

```ts
export interface LiveReceivablesOutcome {
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  metaTotal: Prisma.Decimal | null;
  // Realizado bruto do Tipo de Resultado do indicador principal (META ou
  // RESULTADO) — na trilha RESULTADO é o mesmo valor de attainmentValue; na
  // trilha META, attainmentValue já é o % (realizado/metaTotal*100), então
  // este campo expõe o valor absoluto por trás do %, usado pelo Fechamento.
  mainRealized: Prisma.Decimal;
  attainmentValue: Prisma.Decimal;
  achievedTiers: AchievedTierInfo[];
  fullLadder: LadderRungStatus[];
  tierBreakdown: TierPayoutBreakdown[];
  conditionalChecks: ConditionalCheckResult[];
  blockedTrigger: BlockedTriggerInfo | null;
  nextTier: NextTierInfo | null;
}
```

Trocar para:

```ts
export interface LiveReceivablesOutcome {
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  metaTotal: Prisma.Decimal | null;
  // Realizado bruto do Tipo de Resultado do indicador principal (META ou
  // RESULTADO) — na trilha RESULTADO é o mesmo valor de attainmentValue; na
  // trilha META, attainmentValue já é o % (realizado/metaTotal*100), então
  // este campo expõe o valor absoluto por trás do %, usado pelo Fechamento.
  mainRealized: Prisma.Decimal;
  attainmentValue: Prisma.Decimal;
  achievedTiers: AchievedTierInfo[];
  fullLadder: LadderRungStatus[];
  tierBreakdown: TierPayoutBreakdown[];
  conditionalChecks: ConditionalCheckResult[];
  blockedTrigger: BlockedTriggerInfo | null;
  nextTier: NextTierInfo | null;
  // "Ganho Potencial": o pagamento SE o Beneficiário batesse exatamente o
  // Degrau de maior order (não o próximo) — respeitando Faixa/Cumulativo
  // automaticamente (pickAchievedTiers já resolve isso pro limiar do Degrau
  // de topo). 0 quando a Base não tem nenhum Degrau configurado.
  topTierPotentialPayout: Prisma.Decimal;
}
```

- [ ] **Step 2: Calcular logo abaixo de `nextTier`**

Local atual:

```ts
  const nextRung = fullLadder.find((rung) => !rung.achieved) ?? null;
  const nextTier: NextTierInfo | null = nextRung
    ? {
        order: nextRung.order,
        gap: Prisma.Decimal.max(nextRung.threshold.minus(attainmentValue), 0),
        potentialPayout: payoutForTierIds(new Set(pickAchievedTiers(nextRung.threshold, thresholds, base.triggerMode).map((t) => t.id))).payoutValue,
      }
    : null;

  const firstFailed = conditionalChecks.find((check) => !check.passed) ?? null;
```

Trocar para:

```ts
  const nextRung = fullLadder.find((rung) => !rung.achieved) ?? null;
  const nextTier: NextTierInfo | null = nextRung
    ? {
        order: nextRung.order,
        gap: Prisma.Decimal.max(nextRung.threshold.minus(attainmentValue), 0),
        potentialPayout: payoutForTierIds(new Set(pickAchievedTiers(nextRung.threshold, thresholds, base.triggerMode).map((t) => t.id))).payoutValue,
      }
    : null;

  const topRung = [...thresholds].sort((a, b) => b.order - a.order)[0] ?? null;
  const topTierPotentialPayout = topRung
    ? payoutForTierIds(new Set(pickAchievedTiers(topRung.threshold, thresholds, base.triggerMode).map((t) => t.id))).payoutValue
    : new Prisma.Decimal(0);

  const firstFailed = conditionalChecks.find((check) => !check.passed) ?? null;
```

- [ ] **Step 3: Incluir nas 3 respostas da função**

Local atual (1ª resposta, bloqueado por Condição):

```ts
    return {
      eligible: false,
      blockedReason: "Bloqueado por Condição Comercial",
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      mainRealized,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: firstFailed,
      nextTier,
    };
```

Trocar para:

```ts
    return {
      eligible: false,
      blockedReason: "Bloqueado por Condição Comercial",
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      mainRealized,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: firstFailed,
      nextTier,
      topTierPotentialPayout,
    };
```

Local atual (2ª resposta, zero Degraus atingidos):

```ts
    return {
      eligible: true,
      blockedReason: null,
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      mainRealized,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: null,
      nextTier,
    };
```

Trocar para:

```ts
    return {
      eligible: true,
      blockedReason: null,
      payoutValue: new Prisma.Decimal(0),
      physicalPrizeDescription: null,
      metaTotal: base.indicatorType === "META" ? metaTotal : null,
      mainRealized,
      attainmentValue,
      achievedTiers: [],
      fullLadder,
      tierBreakdown: [],
      conditionalChecks,
      blockedTrigger: null,
      nextTier,
      topTierPotentialPayout,
    };
```

Local atual (3ª resposta, sucesso — é a última coisa na função):

```ts
  return {
    eligible: true,
    blockedReason: null,
    payoutValue,
    physicalPrizeDescription,
    metaTotal: base.indicatorType === "META" ? metaTotal : null,
    mainRealized,
    attainmentValue,
    achievedTiers: achievedTiersInfo,
    fullLadder,
    tierBreakdown,
    conditionalChecks,
    blockedTrigger: null,
    nextTier,
  };
}
```

Trocar para:

```ts
  return {
    eligible: true,
    blockedReason: null,
    payoutValue,
    physicalPrizeDescription,
    metaTotal: base.indicatorType === "META" ? metaTotal : null,
    mainRealized,
    attainmentValue,
    achievedTiers: achievedTiersInfo,
    fullLadder,
    tierBreakdown,
    conditionalChecks,
    blockedTrigger: null,
    nextTier,
    topTierPotentialPayout,
  };
}
```

- [ ] **Step 4: Rodar `tsc` e os testes**

Run: `npm run tsc && npm run test`
Expected: sem erros; testes continuam passando.

---

### Task 4: `recebiveis.service.ts` — `triggerMode` serializado + `topTierPotentialPayout`

**Files:**
- Modify: `src/server/services/recebiveis.service.ts`

**Interfaces:**
- Consumes: `outcome.topTierPotentialPayout` (Task 3).
- Produces: `GET /recebiveis/overview` (via `getMemberGanhoPorMeta`/`serializeRow`) passa a incluir `triggerMode` e `topTierPotentialPayout` em cada linha — consumido pelo Task 5 (tipo no client) e Task 6 (tabela).

- [ ] **Step 1: Trocar `nextTierPotentialPayout` por `topTierPotentialPayout` em `MemberReceivableRow`**

Local atual:

```ts
export interface MemberReceivableRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: "META" | "RESULTADO";
  indicatorLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: "FAIXA" | "CUMULATIVO";
  periodStart: Date;
  periodEndExclusive: Date;
  status: WindowStatus;
  attainmentValue: Prisma.Decimal;
  mainRealized: Prisma.Decimal;
  currentTierLabel: string | null;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  nextTierGap: Prisma.Decimal | null;
  nextTierPotentialPayout: Prisma.Decimal | null;
  tierBreakdown: TierPayoutBreakdown[];
}
```

Trocar para:

```ts
export interface MemberReceivableRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: "META" | "RESULTADO";
  indicatorLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: "FAIXA" | "CUMULATIVO";
  periodStart: Date;
  periodEndExclusive: Date;
  status: WindowStatus;
  attainmentValue: Prisma.Decimal;
  mainRealized: Prisma.Decimal;
  currentTierLabel: string | null;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: Prisma.Decimal;
  physicalPrizeDescription: string | null;
  nextTierGap: Prisma.Decimal | null;
  topTierPotentialPayout: Prisma.Decimal;
  tierBreakdown: TierPayoutBreakdown[];
}
```

- [ ] **Step 2: Preencher `topTierPotentialPayout` em vez de `nextTierPotentialPayout` no `rows.push`**

Local atual:

```ts
      rows.push({
        receivablesBaseId: base.id,
        baseName: base.name,
        indicatorType: base.indicatorType,
        indicatorLabel,
        periodicity: base.periodicity,
        triggerMode: base.triggerMode,
        periodStart: window.start,
        periodEndExclusive: window.endExclusive,
        status,
        attainmentValue: outcome.attainmentValue,
        mainRealized: outcome.mainRealized,
        currentTierLabel,
        eligible: outcome.eligible,
        blockedReason: outcome.blockedReason,
        payoutValue: outcome.eligible ? outcome.payoutValue : new Prisma.Decimal(0),
        physicalPrizeDescription: outcome.eligible ? outcome.physicalPrizeDescription : null,
        nextTierGap: outcome.nextTier?.gap ?? null,
        nextTierPotentialPayout: outcome.nextTier?.potentialPayout ?? null,
        tierBreakdown: outcome.eligible ? outcome.tierBreakdown : [],
      });
```

Trocar para:

```ts
      rows.push({
        receivablesBaseId: base.id,
        baseName: base.name,
        indicatorType: base.indicatorType,
        indicatorLabel,
        periodicity: base.periodicity,
        triggerMode: base.triggerMode,
        periodStart: window.start,
        periodEndExclusive: window.endExclusive,
        status,
        attainmentValue: outcome.attainmentValue,
        mainRealized: outcome.mainRealized,
        currentTierLabel,
        eligible: outcome.eligible,
        blockedReason: outcome.blockedReason,
        payoutValue: outcome.eligible ? outcome.payoutValue : new Prisma.Decimal(0),
        physicalPrizeDescription: outcome.eligible ? outcome.physicalPrizeDescription : null,
        nextTierGap: outcome.nextTier?.gap ?? null,
        topTierPotentialPayout: outcome.topTierPotentialPayout,
        tierBreakdown: outcome.eligible ? outcome.tierBreakdown : [],
      });
```

- [ ] **Step 3: Serializar `triggerMode` e `topTierPotentialPayout` em `serializeRow`**

Local atual:

```ts
function serializeRow(row: MemberReceivableRow) {
  return {
    receivablesBaseId: row.receivablesBaseId,
    baseName: row.baseName,
    indicatorType: row.indicatorType,
    indicatorLabel: row.indicatorLabel,
    periodicity: row.periodicity,
    periodStart: isoKey(row.periodStart),
    periodEndExclusive: isoKey(row.periodEndExclusive),
    status: row.status,
    attainmentValue: row.attainmentValue.toString(),
    currentTierLabel: row.currentTierLabel,
    eligible: row.eligible,
    blockedReason: row.blockedReason,
    payoutValue: row.payoutValue.toString(),
    physicalPrizeDescription: row.physicalPrizeDescription,
    nextTierGap: row.nextTierGap ? row.nextTierGap.toString() : null,
    nextTierPotentialPayout: row.nextTierPotentialPayout ? row.nextTierPotentialPayout.toString() : null,
  };
}
```

Trocar para:

```ts
function serializeRow(row: MemberReceivableRow) {
  return {
    receivablesBaseId: row.receivablesBaseId,
    baseName: row.baseName,
    indicatorType: row.indicatorType,
    indicatorLabel: row.indicatorLabel,
    periodicity: row.periodicity,
    triggerMode: row.triggerMode,
    periodStart: isoKey(row.periodStart),
    periodEndExclusive: isoKey(row.periodEndExclusive),
    status: row.status,
    attainmentValue: row.attainmentValue.toString(),
    currentTierLabel: row.currentTierLabel,
    eligible: row.eligible,
    blockedReason: row.blockedReason,
    payoutValue: row.payoutValue.toString(),
    physicalPrizeDescription: row.physicalPrizeDescription,
    nextTierGap: row.nextTierGap ? row.nextTierGap.toString() : null,
    topTierPotentialPayout: row.topTierPotentialPayout.toString(),
  };
}
```

- [ ] **Step 4: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 5: Client — tipos (`types.ts`)

**Files:**
- Modify: `src/client/pages/recebiveis/types.ts`

**Interfaces:**
- Produces: `TriggerMode` (novo type alias), `GanhoPorMetaRow.triggerMode`, `GanhoPorMetaRow.topTierPotentialPayout` — consumidos pelo Task 6.

- [ ] **Step 1: Adicionar o type alias `TriggerMode`**

Local atual:

```ts
export type IndicatorType = "META" | "RESULTADO";
export type ReceivablesPeriodicity = "DIARIO" | "SEMANAL" | "MENSAL" | "TRIMESTRAL" | "ANUAL";
export type WindowStatus = "FECHADO" | "LIBERADO" | "PREVISTO";
export type RewardType = "PERCENT_FIXO" | "PERCENT_RESULTADO" | "VALOR_FIXO" | "PREMIO_FISICO";
```

Trocar para:

```ts
export type IndicatorType = "META" | "RESULTADO";
export type ReceivablesPeriodicity = "DIARIO" | "SEMANAL" | "MENSAL" | "TRIMESTRAL" | "ANUAL";
export type WindowStatus = "FECHADO" | "LIBERADO" | "PREVISTO";
export type RewardType = "PERCENT_FIXO" | "PERCENT_RESULTADO" | "VALOR_FIXO" | "PREMIO_FISICO";
export type TriggerMode = "FAIXA" | "CUMULATIVO";
```

- [ ] **Step 2: Atualizar `GanhoPorMetaRow`**

Local atual:

```ts
export interface GanhoPorMetaRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: IndicatorType;
  indicatorLabel: string;
  periodicity: ReceivablesPeriodicity;
  periodStart: string;
  periodEndExclusive: string;
  status: WindowStatus;
  attainmentValue: string;
  currentTierLabel: string | null;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: string;
  physicalPrizeDescription: string | null;
  nextTierGap: string | null;
  nextTierPotentialPayout: string | null;
}
```

Trocar para:

```ts
export interface GanhoPorMetaRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: IndicatorType;
  indicatorLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  periodStart: string;
  periodEndExclusive: string;
  status: WindowStatus;
  attainmentValue: string;
  currentTierLabel: string | null;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: string;
  physicalPrizeDescription: string | null;
  nextTierGap: string | null;
  topTierPotentialPayout: string;
}
```

- [ ] **Step 3: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros novos (o único consumidor, `GanhoPorMetaTable.tsx`, ainda não lê os campos novos até o Task 6).

---

### Task 6: Client — `GanhoPorMetaTable.tsx`: linha clicável + "Ganho Potencial" novo

**Files:**
- Modify: `src/client/pages/recebiveis/GanhoPorMetaTable.tsx`

**Interfaces:**
- Consumes: `GanhoPorMetaRow` (Task 5), `useAuthStore` (já existente no projeto).
- Produces: `GanhoPorMetaTable({ rows, memberId, highlightBaseId, highlightPeriodStart })` — prop `memberId` nova, consumida pelo Task 7.

- [ ] **Step 1: Reescrever o arquivo inteiro**

```tsx
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import type { GanhoPorMetaRow, WindowStatus } from "./types";

const STATUS_LABELS: Record<WindowStatus, string> = { FECHADO: "Fechado", LIBERADO: "Liberado", PREVISTO: "Previsto" };
const STATUS_CLASSES: Record<WindowStatus, string> = {
  FECHADO: "bg-primary/10 text-primary",
  LIBERADO: "bg-success/10 text-success",
  PREVISTO: "border border-dashed border-muted-foreground/40 text-muted-foreground",
};

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPercentOrValue(value: string, indicatorType: "META" | "RESULTADO"): string {
  const n = Number(value);
  return indicatorType === "META" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatWindow(periodStart: string, periodEndExclusive: string): string {
  const start = new Date(`${periodStart}T00:00:00.000Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const endInclusive = new Date(new Date(`${periodEndExclusive}T00:00:00.000Z`).getTime() - 86400000).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return `${start} – ${endInclusive}`;
}

// Recebíveis por Campanha (Visão Vendedor, spec § Recebíveis/2 — nome
// exibido trocado de "Ganho por Meta" a pedido do usuário) — 1 linha por
// (Base, janela) dentro do Período filtrado. Previsto é exibido
// (transparência total, spec §4) mas não conta nos totais oficiais da tela.
//
// highlightBaseId/highlightPeriodStart (opcionais): vêm do deep-link de
// Fechamento → Recebíveis (CampaignCard, MemberClosingDetailPage.tsx) — a
// linha que bate ganha destaque visual e a tabela rola até ela ao montar.
//
// Clicar na linha (fora do destaque) abre o detalhe da Base de Recebível —
// mesma tela de "Minhas Bases" (self) ou a visão de Admin/Gestor pra
// qualquer Beneficiário (PASSO 20), conforme memberId bater ou não com o
// usuário logado.
export function GanhoPorMetaTable({
  rows,
  memberId,
  highlightBaseId,
  highlightPeriodStart,
}: {
  rows: GanhoPorMetaRow[];
  memberId: string;
  highlightBaseId?: string | null;
  highlightPeriodStart?: string | null;
}) {
  const navigate = useNavigate();
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightBaseId, highlightPeriodStart]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma Base de Recebível aplicável neste período.</p>;
  }

  function openBaseDetail(receivablesBaseId: string) {
    navigate(
      memberId === ownMemberId
        ? `/bases-recebiveis/minhas/${receivablesBaseId}`
        : `/bases-recebiveis/${receivablesBaseId}/beneficiario/${memberId}`,
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="px-3 py-1.5">Meta / Indicador</th>
            <th className="px-3 py-1.5">Período</th>
            <th className="px-3 py-1.5">Status</th>
            <th className="px-3 py-1.5">Atingimento</th>
            <th className="px-3 py-1.5">Gatilho Atual</th>
            <th className="px-3 py-1.5">Ganho (R$)</th>
            <th className="px-3 py-1.5">Próximo Degrau</th>
            <th className="px-3 py-1.5">Ganho Potencial (R$)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isHighlighted =
              !!highlightBaseId &&
              !!highlightPeriodStart &&
              row.receivablesBaseId === highlightBaseId &&
              row.periodStart.slice(0, 10) === highlightPeriodStart;
            return (
              <tr
                key={`${row.receivablesBaseId}-${row.periodStart}-${index}`}
                ref={isHighlighted ? highlightedRowRef : undefined}
                onClick={() => openBaseDetail(row.receivablesBaseId)}
                className={`cursor-pointer border-t border-border hover:bg-secondary/30 ${isHighlighted ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
              >
                <td className="px-3 py-1.5">
                  <div className="font-medium text-foreground">{row.baseName}</div>
                  <div className="text-xs text-muted-foreground">{row.indicatorLabel}</div>
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{formatWindow(row.periodStart, row.periodEndExclusive)}</td>
                <td className="px-3 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}>{STATUS_LABELS[row.status]}</span>
                </td>
                <td className="px-3 py-1.5">{fmtPercentOrValue(row.attainmentValue, row.indicatorType)}</td>
                <td className="px-3 py-1.5">
                  {row.currentTierLabel ?? "—"}
                  {!row.eligible && <p className="text-xs text-destructive">{row.blockedReason}</p>}
                </td>
                <td className="px-3 py-1.5 font-medium text-foreground">
                  {row.eligible ? fmtCurrency(row.payoutValue) : "R$ 0,00"}
                  {row.physicalPrizeDescription && <p className="text-xs text-muted-foreground">{row.physicalPrizeDescription}</p>}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {row.nextTierGap && Number(row.nextTierGap) > 0 ? `Faltam ${fmtPercentOrValue(row.nextTierGap, row.indicatorType)}` : "No topo"}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {fmtCurrency(row.topTierPotentialPayout)}
                  <p className="text-muted-foreground/70">{row.triggerMode === "CUMULATIVO" ? "Acumulado" : "Na Faixa"}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros (o único consumidor, `RecebiveisPage.tsx`, ainda não passa `memberId` até o Task 7 — vai quebrar até lá, é esperado; confirmar no Task 7).

---

### Task 7: Client — `RecebiveisPage.tsx`: renomear cabeçalho + passar `memberId`

**Files:**
- Modify: `src/client/pages/recebiveis/RecebiveisPage.tsx`

**Interfaces:**
- Consumes: `GanhoPorMetaTable` (Task 6).
- Produces: nada consumido por outra task deste plano — última task de código.

- [ ] **Step 1: Renomear o cabeçalho e passar `memberId`**

Local atual:

```tsx
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">{overview.table.kind === "GANHO_POR_META" ? "Ganho por Meta" : "Distribuição"}</h3>
            {overview.table.kind === "GANHO_POR_META" ? (
              <GanhoPorMetaTable
                rows={overview.table.rows}
                highlightBaseId={highlightBaseId}
                highlightPeriodStart={highlightPeriodStart}
              />
            ) : (
              <DistribuicaoTable rows={overview.table.rows} periodStart={periodStart} periodEnd={periodEnd} />
            )}
          </div>
```

Trocar para:

```tsx
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">{overview.table.kind === "GANHO_POR_META" ? "Recebíveis por Campanha" : "Distribuição"}</h3>
            {overview.table.kind === "GANHO_POR_META" ? (
              <GanhoPorMetaTable
                rows={overview.table.rows}
                memberId={overview.table.member.id}
                highlightBaseId={highlightBaseId}
                highlightPeriodStart={highlightPeriodStart}
              />
            ) : (
              <DistribuicaoTable rows={overview.table.rows} periodStart={periodStart} periodEnd={periodEnd} />
            )}
          </div>
```

(`overview.table.member.id` já vem pronto do backend — `RecebiveisTable` do tipo `GANHO_POR_META` já inclui `member: {id, fullName}`, confirmado em `types.ts`; nenhuma mudança de tipo necessária aqui.)

- [ ] **Step 2: Rodar `tsc`**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 8: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 24`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Achar (ou montar) um cenário real no meio do ladder**

Usando a API como Admin: escolher uma Base trilha Faixa com vários Degraus e um Beneficiário cujo Realizado/Meta o coloque no meio da escada (nem no primeiro Degrau, nem no último) — os dados de "Venda Individuais ($) - Atacado" já usados nos smokes anteriores (PASSO 18-20) têm exemplos assim (ex.: Alberto Fonseca teve `attainmentPercentage: 248.63` num Fechamento visto no PASSO 22 — confirmar contra os Degraus reais dessa Base se ele fica no meio, não no topo).

- [ ] **Step 2: Smoke test no navegador — "Recebíveis por Campanha", "Próximo Degrau" e "Ganho Potencial"**

Numa sessão isolada do `agent-browser`, logado como Admin, em "Recebíveis" com Escopo resolvido a esse Beneficiário e Período cobrindo a janela relevante:

1. Confirmar que o título da tabela mudou para "Recebíveis por Campanha".
2. Achar a linha do cenário do Step 1 — confirmar que "Próximo Degrau" mostra "Faltam X" (não "No topo") com um valor coerente com o Degrau seguinte real.
3. Confirmar que "Ganho Potencial" mostra o valor calculado pro ÚLTIMO Degrau da Base (conferir manualmente contra a config de Degraus/Recompensas dessa Base, ex. via `GET /bases-recebiveis/:id`), com o rótulo "Acumulado" ou "Na Faixa" batendo com o `triggerMode` real da Base.
4. Clicar na linha — confirmar que abre o detalhe correto da Base (self ou Admin-vendo-outro, conforme o caso) e que "← Voltar" retorna pra Recebíveis.

- [ ] **Step 3: Confirmar que o Simulador e "Minhas Bases" também se beneficiam da correção**

Abrir o Simulador (`MySimulatorModal`, de qualquer Base com Faixa e o mesmo Beneficiário no meio do ladder) e simular um valor que o deixe no meio — confirmar que o ladder completo mostrado (`SimulationResultPanel`) marca os Degraus abaixo do atual como batidos também (não só o mais alto). Confirmar o mesmo em "Minhas Bases" (`MyReceivablesBasesTab`) se houver um cenário real equivalente.

- [ ] **Step 4: Limpeza**

Fechar a sessão isolada do `agent-browser`. Nenhum dado de teste foi criado neste PASSO (só leitura/simulação), não precisa de reversão.

- [ ] **Step 5: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 23`, um novo registro:

```markdown
### PASSO 24 (FEITO <data>) — Recebíveis por Campanha: renomear, navegar pro detalhe, corrigir "No Topo" e "Ganho Potencial"

Pedido do usuário: parte F de um pedido de 4 partes (D e E já entregues — PASSOs 22 e 23; G ainda pendente). Na tela de Recebíveis: renomear "Ganho por Meta" para "Recebíveis por Campanha"; clicar numa linha abre o detalhe da Base de Recebível (mesma tela de "Minhas Bases"); corrigir "Próximo Degrau", que às vezes mostrava "No Topo" indevidamente; redefinir "Ganho Potencial" como o valor no último Degrau, com rótulo Acumulado/Na Faixa.

**Causa raiz do bug "No Topo" achada**: `fullLadder` (usado tanto em Recebíveis quanto no Simulador e em "Minhas Bases") marcava "achieved" reaproveitando o resultado de `pickAchievedTiers`, que em modo Faixa devolve só o Degrau mais alto batido (correto pra CALCULAR o pagamento) — fazendo Degraus abaixo do atual, já ultrapassados, aparecerem como não batidos, e o "próximo degrau não-batido" ser encontrado errado (gap negativo → 0 → "No Topo" indevido). Corrigido com `buildFullLadder` (nova função pura, testada com 4 casos novos em `bases-recebiveis.service.test.ts`), que marca "achieved" por comparação direta de limiar, usada nos 2 lugares que antes duplicavam a lógica com o bug (`simulateReceivablesBase` e `computeLiveReceivablesOutcome`) — corrige de brinde o mesmo problema no Simulador e em "Minhas Bases".

**Implementado**: `LiveReceivablesOutcome` ganhou `topTierPotentialPayout` (mesmo mecanismo já usado pro "próximo degrau", só trocando o limiar simulado pro do Degrau de maior `order` — respeita Faixa/Cumulativo automaticamente). `recebiveis.service.ts` passou a serializar `triggerMode` (já existia no tipo, faltava expor) e trocou `nextTierPotentialPayout` por `topTierPotentialPayout`. `GanhoPorMetaTable.tsx` ganhou navegação de linha (reaproveitando as 2 rotas de detalhe de Base já existentes, PASSOs 18-20, sem rota nova — resolve self vs Admin comparando `memberId` com o usuário logado) e a nova coluna "Ganho Potencial" com rótulo Acumulado/Na Faixa. `RecebiveisPage.tsx` renomeou o cabeçalho e passou `memberId` (já vinha pronto do backend, `overview.table.member.id`).

**Validação**: `tsc` (server+client) e `vitest` (112/112, +4 testes novos de `buildFullLadder`) limpos em cada task. Smoke real confirmando "Faltam X" correto no meio do ladder (não mais "No Topo" indevido), "Ganho Potencial" batendo com o cálculo manual do último Degrau + rótulo certo, navegação de linha abrindo o detalhe certo (self/Admin), e o mesmo ladder corrigido aparecendo no Simulador e em "Minhas Bases".

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
