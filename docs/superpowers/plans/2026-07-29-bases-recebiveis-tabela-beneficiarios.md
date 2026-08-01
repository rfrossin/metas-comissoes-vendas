# Tabela de Beneficiários na edição de Base de Recebível — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela de edição de uma Base de Recebível (Admin/Gestor), substituir o card "Simulador" (seletor genérico) por uma tabela com 1 linha por Beneficiário (Nome, 2 hierarquias, contagem de Gatilhos, botão Simulador na linha) — clicar na linha abre a mesma tela de detalhe de "Minhas Bases", agora reaproveitada para qualquer Beneficiário.

**Architecture:** O núcleo de cálculo de `getMyReceivablesBaseDetail` (tudo que depende só de `base`+`beneficiary`, não de "quem está logado") é extraído para uma função privada compartilhada, reaproveitada por uma nova função pública `getReceivablesBaseDetailForBeneficiary` (mesma checagem de escopo já usada no Simulador de gestão). No client, a UI de exibição de `MyReceivablesBaseDetailPage.tsx` é extraída para um componente de apresentação (`ReceivablesBaseDetailView.tsx`) reaproveitado por 2 wrappers finos: o de autoatendimento (existente, mantém o mesmo comportamento) e um novo para Admin/Gestor.

**Tech Stack:** TypeScript, Express, Prisma (server); React + TypeScript, TanStack Query, React Router (client).

## Global Constraints

- Multi-tenancy: toda query nova passa `companyId` explicitamente, mesmo padrão já usado no arquivo inteiro.
- Este projeto **não é um repositório git no momento** — nenhum passo deste plano inclui `git commit`.
- Nenhuma função pura nova precisa de teste unitário (a extração de `buildReceivablesBaseDetailForBeneficiary` é refatoração de código já coberto por smoke real nos PASSOs 18/19 — mesmo raciocínio já aplicado lá).
- Validação de cada task: `npm run tsc` limpo (cobre server+client) antes de passar para a próxima.

---

### Task 1: Backend — extrair função compartilhada + `canSimulate` + nova função para Admin/Gestor

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts` (interface `MyReceivablesBaseDetailResponse`, função `getMyReceivablesBaseDetail`, nova função `getReceivablesBaseDetailForBeneficiary`)

**Interfaces:**
- Consumes: `fetchReceivablesBaseDetail`, `resolveAncestorIds`, `buildHierarchyPath`, `triggerAppliesToMember`, `resolveReceivablesBasePage`, `computeRequiredValue`, `dailyMapOfActiveLine`, `sumDailyMapInWindow`, `resolveMemberLevelEntity`, `resolveReceivablesBaseAccess`, `resolveRequesterMemberId` (todas já existentes/importadas no arquivo).
- Produces: `MyReceivablesBaseDetailResponse.canSimulate: boolean` (consumido pelo Task 4 no tipo do client, e pelo Task 6 na UI); `getReceivablesBaseDetailForBeneficiary(companyId, requestingUser, baseId, memberId, page): Promise<MyReceivablesBaseDetailResponse>` (consumido pelo Task 3, controller).

- [ ] **Step 1: Adicionar `canSimulate` à interface `MyReceivablesBaseDetailResponse`**

Local atual (por volta da linha 1688-1691, mesma área tocada na Parte A):

```ts
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  hierarchyPath: string | null;
  conditionalTriggers: {
```

Trocar para:

```ts
  entityType: OrgScopeType;
  entityId: string;
  entityName: string;
  hierarchyPath: string | null;
  // false só quando um Gestor de acesso PARCIAL está vendo o detalhe de um
  // Beneficiário fora do seu escopo (getReceivablesBaseDetailForBeneficiary)
  // — autoatendimento (getMyReceivablesBaseDetail) é sempre true, já que
  // simular o próprio Recebível nunca é bloqueado por escopo.
  canSimulate: boolean;
  conditionalTriggers: {
```

- [ ] **Step 2: Extrair `buildReceivablesBaseDetailForBeneficiary` e reescrever `getMyReceivablesBaseDetail`**

Local atual (função inteira, a partir de `export async function getMyReceivablesBaseDetail`):

```ts
export async function getMyReceivablesBaseDetail(
  companyId: string,
  requestingUser: RequestingUser,
  baseId: string,
  page = 0,
): Promise<MyReceivablesBaseDetailResponse> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) throw new NotFoundError("Base de Recebível não encontrada");

  const base = await fetchReceivablesBaseDetail(companyId, baseId);
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Base de Recebível não encontrada");

  const beneficiaryAncestorIds = await resolveAncestorIds(companyId, beneficiary.entityType, beneficiary.entityId);
  const hierarchyPath = await buildHierarchyPath(companyId, beneficiary.entityType, beneficiaryAncestorIds);

  const goalOrResultLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");

  const applicableTriggers = base.conditionalTriggers.filter((trigger) => triggerAppliesToMember(trigger.applicableMemberIds, memberId));
  const conditionalTriggers = applicableTriggers.map((trigger) => ({
    id: trigger.id,
    label: trigger.indicatorType === "META" ? (trigger.conditionalGoal?.name ?? "—") : (trigger.resultType?.name ?? "—"),
    verificationLevel: trigger.verificationLevel,
    indicatorType: trigger.indicatorType,
    requiredMinimum:
      trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0)),
  }));

  const tierLadder = base.valueTiers.map((tier) => ({
    order: tier.order,
    thresholdValue: tier.thresholdValue,
    rules: base.tierRules
      .filter((rule) => rule.valueTierId === tier.id)
      .map((rule) => ({
        rewardType: rule.rewardType,
        rewardResultTypeName: rule.rewardResultType?.name ?? null,
        rewardPercentage: rule.rewardPercentage,
        rewardFixedValue: rule.rewardFixedValue,
        rewardDescription: rule.rewardDescription,
      })),
  }));

  const rangeStart = base.startDate ?? toUtcDateOnly(base.createdAt);
  const today = toUtcDateOnly(new Date());
  const tomorrow = addDaysUtc(today, 1);
  const vigenciaEndExclusive = base.endDate ? addDaysUtc(base.endDate, 1) : tomorrow;
  const rangeEndExclusive = vigenciaEndExclusive < tomorrow ? vigenciaEndExclusive : tomorrow;

  const { periodWindows, pagination } = resolveReceivablesBasePage(base.periodicity, rangeStart, rangeEndExclusive, page);

  const tierPeriods: MyReceivablesBaseDetailResponse["tierPeriods"] = [];
  const triggerPointsByTriggerId = new Map<string, MyReceivablesBaseDetailResponse["triggerSeries"][number]["points"]>(
    applicableTriggers.map((trigger) => [trigger.id, []]),
  );

  for (const window of periodWindows) {
    let metaTotal = new Prisma.Decimal(0);
    if (base.indicatorType === "META" && base.primaryGoalCampaignId) {
      const daily = await dailyMapOfActiveLine(companyId, base.primaryGoalCampaignId, beneficiary.entityType, beneficiary.entityId);
      metaTotal = sumDailyMapInWindow(daily, window);
    }
    const tiers = base.valueTiers.map((tier) => ({
      order: tier.order,
      requiredValue: computeRequiredValue(base.indicatorType, tier.thresholdValue, metaTotal),
    }));
    tierPeriods.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, tiers });

    for (const trigger of applicableTriggers) {
      let conditionalTotal = new Prisma.Decimal(0);
      if (trigger.indicatorType === "META" && trigger.conditionalGoalCampaignId) {
        const conditionEntityId = await resolveMemberLevelEntity(companyId, memberId, trigger.verificationLevel);
        if (conditionEntityId) {
          const daily = await dailyMapOfActiveLine(companyId, trigger.conditionalGoalCampaignId, trigger.verificationLevel, conditionEntityId);
          conditionalTotal = sumDailyMapInWindow(daily, window);
        }
      }
      const requiredMinimum =
        trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0));
      const requiredValue = computeRequiredValue(trigger.indicatorType, requiredMinimum, conditionalTotal);
      triggerPointsByTriggerId.get(trigger.id)?.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, requiredValue });
    }
  }

  const triggerSeries = conditionalTriggers.map((trigger) => ({
    triggerId: trigger.id,
    label: trigger.label,
    points: triggerPointsByTriggerId.get(trigger.id) ?? [],
  }));

  return {
    id: base.id,
    name: base.name,
    indicatorType: base.indicatorType,
    goalOrResultLabel,
    periodicity: base.periodicity,
    triggerMode: base.triggerMode,
    startDate: base.startDate,
    endDate: base.endDate,
    entityType: beneficiary.entityType,
    entityId: beneficiary.entityId,
    entityName: beneficiary.entityName,
    hierarchyPath,
    conditionalTriggers,
    tierLadder,
    tierPeriods,
    triggerSeries,
    pagination,
  };
}
```

Trocar por (extrai tudo que depende só de `base`+`beneficiary` para `buildReceivablesBaseDetailForBeneficiary`; `getMyReceivablesBaseDetail` fica só com a resolução de "quem sou eu"):

```ts
async function buildReceivablesBaseDetailForBeneficiary(
  companyId: string,
  base: Awaited<ReturnType<typeof fetchReceivablesBaseDetail>>,
  beneficiary: Awaited<ReturnType<typeof fetchReceivablesBaseDetail>>["beneficiaries"][number],
  canSimulate: boolean,
  page: number,
): Promise<MyReceivablesBaseDetailResponse> {
  const beneficiaryAncestorIds = await resolveAncestorIds(companyId, beneficiary.entityType, beneficiary.entityId);
  const hierarchyPath = await buildHierarchyPath(companyId, beneficiary.entityType, beneficiaryAncestorIds);

  const goalOrResultLabel = base.indicatorType === "META" ? (base.primaryGoal?.name ?? "—") : (base.resultType?.name ?? "—");

  const applicableTriggers = base.conditionalTriggers.filter((trigger) =>
    triggerAppliesToMember(trigger.applicableMemberIds, beneficiary.memberId),
  );
  const conditionalTriggers = applicableTriggers.map((trigger) => ({
    id: trigger.id,
    label: trigger.indicatorType === "META" ? (trigger.conditionalGoal?.name ?? "—") : (trigger.resultType?.name ?? "—"),
    verificationLevel: trigger.verificationLevel,
    indicatorType: trigger.indicatorType,
    requiredMinimum:
      trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0)),
  }));

  const tierLadder = base.valueTiers.map((tier) => ({
    order: tier.order,
    thresholdValue: tier.thresholdValue,
    rules: base.tierRules
      .filter((rule) => rule.valueTierId === tier.id)
      .map((rule) => ({
        rewardType: rule.rewardType,
        rewardResultTypeName: rule.rewardResultType?.name ?? null,
        rewardPercentage: rule.rewardPercentage,
        rewardFixedValue: rule.rewardFixedValue,
        rewardDescription: rule.rewardDescription,
      })),
  }));

  const rangeStart = base.startDate ?? toUtcDateOnly(base.createdAt);
  const today = toUtcDateOnly(new Date());
  const tomorrow = addDaysUtc(today, 1);
  const vigenciaEndExclusive = base.endDate ? addDaysUtc(base.endDate, 1) : tomorrow;
  const rangeEndExclusive = vigenciaEndExclusive < tomorrow ? vigenciaEndExclusive : tomorrow;

  const { periodWindows, pagination } = resolveReceivablesBasePage(base.periodicity, rangeStart, rangeEndExclusive, page);

  const tierPeriods: MyReceivablesBaseDetailResponse["tierPeriods"] = [];
  const triggerPointsByTriggerId = new Map<string, MyReceivablesBaseDetailResponse["triggerSeries"][number]["points"]>(
    applicableTriggers.map((trigger) => [trigger.id, []]),
  );

  for (const window of periodWindows) {
    let metaTotal = new Prisma.Decimal(0);
    if (base.indicatorType === "META" && base.primaryGoalCampaignId) {
      const daily = await dailyMapOfActiveLine(companyId, base.primaryGoalCampaignId, beneficiary.entityType, beneficiary.entityId);
      metaTotal = sumDailyMapInWindow(daily, window);
    }
    const tiers = base.valueTiers.map((tier) => ({
      order: tier.order,
      requiredValue: computeRequiredValue(base.indicatorType, tier.thresholdValue, metaTotal),
    }));
    tierPeriods.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, tiers });

    for (const trigger of applicableTriggers) {
      let conditionalTotal = new Prisma.Decimal(0);
      if (trigger.indicatorType === "META" && trigger.conditionalGoalCampaignId) {
        const conditionEntityId = await resolveMemberLevelEntity(companyId, beneficiary.memberId, trigger.verificationLevel);
        if (conditionEntityId) {
          const daily = await dailyMapOfActiveLine(companyId, trigger.conditionalGoalCampaignId, trigger.verificationLevel, conditionEntityId);
          conditionalTotal = sumDailyMapInWindow(daily, window);
        }
      }
      const requiredMinimum =
        trigger.indicatorType === "META" ? (trigger.minAttainmentPercentage ?? new Prisma.Decimal(0)) : (trigger.minResultValue ?? new Prisma.Decimal(0));
      const requiredValue = computeRequiredValue(trigger.indicatorType, requiredMinimum, conditionalTotal);
      triggerPointsByTriggerId.get(trigger.id)?.push({ periodStart: window.start, periodEndExclusive: window.endExclusive, requiredValue });
    }
  }

  const triggerSeries = conditionalTriggers.map((trigger) => ({
    triggerId: trigger.id,
    label: trigger.label,
    points: triggerPointsByTriggerId.get(trigger.id) ?? [],
  }));

  return {
    id: base.id,
    name: base.name,
    indicatorType: base.indicatorType,
    goalOrResultLabel,
    periodicity: base.periodicity,
    triggerMode: base.triggerMode,
    startDate: base.startDate,
    endDate: base.endDate,
    entityType: beneficiary.entityType,
    entityId: beneficiary.entityId,
    entityName: beneficiary.entityName,
    hierarchyPath,
    canSimulate,
    conditionalTriggers,
    tierLadder,
    tierPeriods,
    triggerSeries,
    pagination,
  };
}

export async function getMyReceivablesBaseDetail(
  companyId: string,
  requestingUser: RequestingUser,
  baseId: string,
  page = 0,
): Promise<MyReceivablesBaseDetailResponse> {
  const memberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (!memberId) throw new NotFoundError("Base de Recebível não encontrada");

  const base = await fetchReceivablesBaseDetail(companyId, baseId);
  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Base de Recebível não encontrada");

  return buildReceivablesBaseDetailForBeneficiary(companyId, base, beneficiary, true, page);
}

// Mesma tela de detalhe de "Minhas Bases", reaproveitada pelo Admin/Gestor
// pra ver o Recebível de QUALQUER Beneficiário da Base de forma objetiva —
// chamada pela tabela de Beneficiários em ReceivablesBaseDetailPage.tsx.
// Visualizar é liberado pra acesso PARCIAL também (mesma filosofia de
// getReceivablesBaseDetail: "abre a Base inteira pra contexto"); só
// `canSimulate` fica false se o Beneficiário estiver fora do escopo do
// Gestor PARCIAL — Simular continua restrito, mesma regra já aplicada em
// simulateReceivablesBase.
export async function getReceivablesBaseDetailForBeneficiary(
  companyId: string,
  requestingUser: RequestingUser,
  baseId: string,
  memberId: string,
  page = 0,
): Promise<MyReceivablesBaseDetailResponse> {
  const base = await fetchReceivablesBaseDetail(companyId, baseId);
  const access = await resolveReceivablesBaseAccess(
    companyId,
    requestingUser,
    base.beneficiaries.map((b) => b.memberId),
  );
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para consultar esta Base de Recebível.");
  }

  const beneficiary = base.beneficiaries.find((b) => b.memberId === memberId);
  if (!beneficiary) throw new NotFoundError("Beneficiário não encontrado nesta Base de Recebível.");

  const canSimulate = access.level === "FULL" || access.ownedMemberIds.has(memberId);
  return buildReceivablesBaseDetailForBeneficiary(companyId, base, beneficiary, canSimulate, page);
}
```

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 2: Backend — hierarquia dos Beneficiários em `getReceivablesBaseDetail`

**Files:**
- Modify: `src/server/services/bases-recebiveis.service.ts` (função `getReceivablesBaseDetail`, por volta da linha 269-291)

**Interfaces:**
- Consumes: `resolveAncestorIds`, `buildHierarchyPath` (já importados/usados na Task 1).
- Produces: `beneficiaries[].memberHierarchyPath: string | null` e `beneficiaries[].entityHierarchyPath: string | null` no retorno de `getReceivablesBaseDetail` — consumidos pelo Task 4 (tipo `BeneficiaryRow` no client) e Task 8 (`BeneficiariesSummaryTable.tsx`).

- [ ] **Step 1: Enriquecer `base.beneficiaries` com as 2 hierarquias antes de retornar**

Local atual:

```ts
export async function getReceivablesBaseDetail(companyId: string, requestingUser: RequestingUser, id: string) {
  const base = await fetchReceivablesBaseDetail(companyId, id);
  const access = await resolveReceivablesBaseAccess(
    companyId,
    requestingUser,
    base.beneficiaries.map((b) => b.memberId),
  );
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para consultar esta Base de Recebível.");
  }

  // Acesso PARCIAL (Gestor com só ALGUNS beneficiários no escopo): abre a
  // Base inteira (beneficiários/Gatilhos/Degraus de todos, para contexto),
  // mas o front usa `access` para travar edição do que não é dele — Degraus
  // sempre em modo leitura nesse caso (afetam todos os beneficiários),
  // Gatilhos só editáveis se `applicableMemberIds` for só de dentro de
  // `editableBeneficiaryMemberIds` (ver assertConditionalTriggerOwnership).
  return {
    ...base,
    access: access.level,
    editableBeneficiaryMemberIds: [...access.ownedMemberIds],
  };
}
```

Trocar para:

```ts
export async function getReceivablesBaseDetail(companyId: string, requestingUser: RequestingUser, id: string) {
  const base = await fetchReceivablesBaseDetail(companyId, id);
  const access = await resolveReceivablesBaseAccess(
    companyId,
    requestingUser,
    base.beneficiaries.map((b) => b.memberId),
  );
  if (access.level === "NONE") {
    throw new ForbiddenError("Você não tem permissão para consultar esta Base de Recebível.");
  }

  // Hierarquia completa de cada Beneficiário (do próprio Membro e da
  // Entidade Analisada) — só calculada aqui, na tela de configuração usada
  // por Admin/Gestor (N Beneficiários de uma vez); fetchReceivablesBaseDetail
  // fica sem isso de propósito, é hot-path compartilhado com autoatendimento
  // e simulação, que só precisam de 1 Beneficiário por vez.
  const beneficiariesWithHierarchy = await Promise.all(
    base.beneficiaries.map(async (beneficiary) => {
      const memberAncestorIds = await resolveAncestorIds(companyId, "MEMBRO", beneficiary.memberId);
      const entityAncestorIds = await resolveAncestorIds(companyId, beneficiary.entityType, beneficiary.entityId);
      return {
        ...beneficiary,
        memberHierarchyPath: await buildHierarchyPath(companyId, "MEMBRO", memberAncestorIds),
        entityHierarchyPath: await buildHierarchyPath(companyId, beneficiary.entityType, entityAncestorIds),
      };
    }),
  );

  // Acesso PARCIAL (Gestor com só ALGUNS beneficiários no escopo): abre a
  // Base inteira (beneficiários/Gatilhos/Degraus de todos, para contexto),
  // mas o front usa `access` para travar edição do que não é dele — Degraus
  // sempre em modo leitura nesse caso (afetam todos os beneficiários),
  // Gatilhos só editáveis se `applicableMemberIds` for só de dentro de
  // `editableBeneficiaryMemberIds` (ver assertConditionalTriggerOwnership).
  return {
    ...base,
    beneficiaries: beneficiariesWithHierarchy,
    access: access.level,
    editableBeneficiaryMemberIds: [...access.ownedMemberIds],
  };
}
```

- [ ] **Step 2: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 3: Backend — controller e rota para `getReceivablesBaseDetailForBeneficiary`

**Files:**
- Modify: `src/server/controllers/bases-recebiveis.controller.ts` (import + novo handler)
- Modify: `src/server/routes/bases-recebiveis.routes.ts` (import + nova rota)

**Interfaces:**
- Consumes: `getReceivablesBaseDetailForBeneficiary` (Task 1), `respondToError` (helper privado já existente no controller).
- Produces: rota `GET /bases-recebiveis/:id/beneficiario/:memberId/graficos` — consumida pelo Task 7 (hook do client).

- [ ] **Step 1: Adicionar o handler no controller**

Em `src/server/controllers/bases-recebiveis.controller.ts`, trocar o import (linhas 3-17):

```ts
import {
  createReceivablesBase,
  deleteReceivablesBase,
  duplicateReceivablesBase,
  getMyReceivablesBaseDetail,
  getReceivablesBaseDetail,
  listMyReceivablesBases,
  listReceivablesBases,
  setBeneficiaries,
  setConditionalTriggers,
  setReceivablesBaseStatus,
  setTierLadder,
  simulateReceivablesBase,
  updateReceivablesBase,
} from "../services/bases-recebiveis.service";
```

Para:

```ts
import {
  createReceivablesBase,
  deleteReceivablesBase,
  duplicateReceivablesBase,
  getMyReceivablesBaseDetail,
  getReceivablesBaseDetail,
  getReceivablesBaseDetailForBeneficiary,
  listMyReceivablesBases,
  listReceivablesBases,
  setBeneficiaries,
  setConditionalTriggers,
  setReceivablesBaseStatus,
  setTierLadder,
  simulateReceivablesBase,
  updateReceivablesBase,
} from "../services/bases-recebiveis.service";
```

Logo depois de `getMyReceivablesBaseDetailHandler` (que hoje é):

```ts
export async function getMyReceivablesBaseDetailHandler(req: Request, res: Response) {
  const page = req.query.page ? Number(req.query.page) : 0;
  try {
    const detail = await getMyReceivablesBaseDetail(req.user!.companyId, req.user!, req.params.id, Number.isFinite(page) ? page : 0);
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}
```

adicionar:

```ts
export async function getReceivablesBaseDetailForBeneficiaryHandler(req: Request, res: Response) {
  const page = req.query.page ? Number(req.query.page) : 0;
  try {
    const detail = await getReceivablesBaseDetailForBeneficiary(
      req.user!.companyId,
      req.user!,
      req.params.id,
      req.params.memberId,
      Number.isFinite(page) ? page : 0,
    );
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}
```

- [ ] **Step 2: Registrar a rota**

Em `src/server/routes/bases-recebiveis.routes.ts`, trocar o import (linhas 2-16):

```ts
import {
  createReceivablesBaseHandler,
  deleteReceivablesBaseHandler,
  duplicateReceivablesBaseHandler,
  getMyReceivablesBaseDetailHandler,
  getReceivablesBaseDetailHandler,
  listMyReceivablesBasesHandler,
  listReceivablesBasesHandler,
  setBeneficiariesHandler,
  setConditionalTriggersHandler,
  setReceivablesBaseStatusHandler,
  setTierLadderHandler,
  simulateReceivablesBaseHandler,
  updateReceivablesBaseHandler,
} from "../controllers/bases-recebiveis.controller";
```

Para:

```ts
import {
  createReceivablesBaseHandler,
  deleteReceivablesBaseHandler,
  duplicateReceivablesBaseHandler,
  getMyReceivablesBaseDetailHandler,
  getReceivablesBaseDetailForBeneficiaryHandler,
  getReceivablesBaseDetailHandler,
  listMyReceivablesBasesHandler,
  listReceivablesBasesHandler,
  setBeneficiariesHandler,
  setConditionalTriggersHandler,
  setReceivablesBaseStatusHandler,
  setTierLadderHandler,
  simulateReceivablesBaseHandler,
  updateReceivablesBaseHandler,
} from "../controllers/bases-recebiveis.controller";
```

E, logo abaixo de `basesRecebiveisRoutes.get("/:id", asyncHandler(getReceivablesBaseDetailHandler));`, adicionar:

```ts
basesRecebiveisRoutes.get("/:id/beneficiario/:memberId/graficos", asyncHandler(getReceivablesBaseDetailForBeneficiaryHandler));
```

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 4: Client — tipos novos (`canSimulate`, hierarquias do Beneficiário)

**Files:**
- Modify: `src/client/pages/bases-recebiveis/types.ts`

**Interfaces:**
- Produces: `BeneficiaryRow.memberHierarchyPath: string | null`, `BeneficiaryRow.entityHierarchyPath: string | null`, `MyReceivablesBaseDetail.canSimulate: boolean` — consumidos pelos Tasks 6 e 8.

- [ ] **Step 1: Adicionar os 2 campos de hierarquia a `BeneficiaryRow`**

Local atual:

```ts
export interface BeneficiaryRow {
  id: string;
  memberId: string;
  member: { id: string; fullName: string; cargo: { id: string; name: string } | null };
  entityType: ScopeType;
  entityId: string;
  entityName: string;
}
```

Trocar para:

```ts
export interface BeneficiaryRow {
  id: string;
  memberId: string;
  member: { id: string; fullName: string; cargo: { id: string; name: string } | null };
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  memberHierarchyPath: string | null;
  entityHierarchyPath: string | null;
}
```

- [ ] **Step 2: Adicionar `canSimulate` a `MyReceivablesBaseDetail`**

Local atual:

```ts
export interface MyReceivablesBaseDetail {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  goalOrResultLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: string | null;
  endDate: string | null;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  hierarchyPath: string | null;
  conditionalTriggers: MyConditionalTriggerInfo[];
  tierLadder: MyTierLadderRung[];
  tierPeriods: TierPeriodTarget[];
  triggerSeries: TriggerSeries[];
  pagination: ReceivablesBasePagination | null;
}
```

Trocar para:

```ts
export interface MyReceivablesBaseDetail {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  goalOrResultLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: string | null;
  endDate: string | null;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  hierarchyPath: string | null;
  canSimulate: boolean;
  conditionalTriggers: MyConditionalTriggerInfo[];
  tierLadder: MyTierLadderRung[];
  tierPeriods: TierPeriodTarget[];
  triggerSeries: TriggerSeries[];
  pagination: ReceivablesBasePagination | null;
}
```

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros (campos novos em interfaces já usadas não quebram consumidores existentes).

---

### Task 5: Client — extrair `hierarchy.ts` (deduplica `LEVEL_LABEL`/`formatFullHierarchy`)

**Files:**
- Create: `src/client/pages/bases-recebiveis/hierarchy.ts`
- Modify: `src/client/pages/bases-recebiveis/MyReceivablesBaseDetailPage.tsx`

**Interfaces:**
- Produces: `LEVEL_LABEL: Record<ScopeType, string>`, `formatFullHierarchy(hierarchyPath: string | null, entityType: ScopeType, entityName: string): string` — consumidos pelo Task 6 (`ReceivablesBaseDetailView.tsx`) e Task 8 (`BeneficiariesSummaryTable.tsx`).

- [ ] **Step 1: Criar `hierarchy.ts`**

```ts
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

export const LEVEL_LABEL: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

// hierarchyPath vem do backend como "ancestral imediato → topo" (ex.:
// "Hospitalar>Atacado" para um Time — mesmo formato usado em Metas/
// Fechamento). O formato de exibição em Bases de Recebível é o inverso, com
// o nome da própria Entidade e seu nível no final: "Atacado>Hospitalar>São
// Paulo (Time)".
export function formatFullHierarchy(hierarchyPath: string | null, entityType: ScopeType, entityName: string): string {
  const own = `${entityName} (${LEVEL_LABEL[entityType]})`;
  if (!hierarchyPath) return own;
  return [...hierarchyPath.split(">").reverse(), own].join(">");
}
```

- [ ] **Step 2: Remover a cópia local de `MyReceivablesBaseDetailPage.tsx` e importar do módulo novo**

Trocar o import atual:

```ts
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";
```

Para:

```ts
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { formatFullHierarchy } from "./hierarchy";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";
```

E remover as 2 declarações locais (`LEVEL_LABEL` e `formatFullHierarchy`) que hoje ficam entre `TRIGGER_MODE_EXPLANATION` e `formatValue`:

```ts
const LEVEL_LABEL: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

function formatValue(value: string, indicatorType: "META" | "RESULTADO"): string {
```

Para:

```ts
function formatValue(value: string, indicatorType: "META" | "RESULTADO"): string {
```

E, mais abaixo, remover a função local `formatFullHierarchy` (o bloco inteiro, comentário incluso) que fica entre `formatDate` e `periodLabel`:

```ts
// hierarchyPath vem do backend como "ancestral imediato → topo" (ex.:
// "Hospitalar>Atacado" para um Time — mesmo formato usado em Metas/
// Fechamento). Esta tela pediu o formato inverso, com o nome da própria
// Entidade e seu nível no final: "Atacado>Hospitalar>São Paulo (Time)".
function formatFullHierarchy(hierarchyPath: string | null, entityType: ScopeType, entityName: string): string {
  const own = `${entityName} (${LEVEL_LABEL[entityType]})`;
  if (!hierarchyPath) return own;
  return [...hierarchyPath.split(">").reverse(), own].join(">");
}

function periodLabel(iso: string, periodicity: string): string {
```

Vira só:

```ts
function periodLabel(iso: string, periodicity: string): string {
```

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 6: Client — extrair `ReceivablesBaseDetailView.tsx` e reduzir `MyReceivablesBaseDetailPage.tsx` a wrapper fino

**Files:**
- Create: `src/client/pages/bases-recebiveis/ReceivablesBaseDetailView.tsx`
- Modify: `src/client/pages/bases-recebiveis/MyReceivablesBaseDetailPage.tsx` (reescrita completa, fica pequeno)

**Interfaces:**
- Consumes: `formatFullHierarchy` (Task 5), `MyReceivablesBaseDetail` (Task 4), `MySimulatorModal`, `TierLadderChart`/`TriggerRequirementChart`, `PERIODICITY_LABELS`, `useMyReceivablesBaseDetail`.
- Produces: `ReceivablesBaseDetailView({ detail, page, onPageChange, memberId, onBack })` — consumido pelo próprio Task 6 (wrapper de autoatendimento) e pelo Task 7 (wrapper de Admin/Gestor).

- [ ] **Step 1: Criar `ReceivablesBaseDetailView.tsx`**

Todo o conteúdo de apresentação de `MyReceivablesBaseDetailPage.tsx` (funções auxiliares puras + JSX), adaptado pra receber `detail`/`page`/`memberId`/`onBack` por prop em vez de resolver via hooks/`useAuthStore`/`useParams` internamente:

```tsx
import { useMemo, useState } from "react";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { formatFullHierarchy } from "./hierarchy";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import type { MyReceivablesBaseDetail } from "./types";

const TRIGGER_MODE_EXPLANATION: Record<"FAIXA" | "CUMULATIVO", string> = {
  FAIXA: "Faixa: só o Degrau mais alto batido no período conta — a recompensa é a daquele Degrau específico.",
  CUMULATIVO: "Cumulativo: todos os Degraus batidos no período somam — as recompensas de cada um se acumulam.",
};

function formatValue(value: string, indicatorType: "META" | "RESULTADO"): string {
  const n = Number(value);
  return indicatorType === "META" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function periodLabel(iso: string, periodicity: string): string {
  const date = new Date(iso);
  if (periodicity === "TRIMESTRAL") {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `T${quarter}/${date.getUTCFullYear()}`;
  }
  if (periodicity === "ANUAL") {
    return `${date.getUTCFullYear()}`;
  }
  return date.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: periodicity === "MENSAL" ? undefined : "2-digit",
    month: "short",
    year: "numeric",
  });
}

const REWARD_LABELS: Record<string, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

function rewardText(rule: {
  rewardType: string;
  rewardResultTypeName: string | null;
  rewardPercentage: string | null;
  rewardFixedValue: string | null;
  rewardDescription: string | null;
}): string {
  const label = REWARD_LABELS[rule.rewardType] ?? rule.rewardType;
  if (rule.rewardType === "PREMIO_FISICO") return `${label}${rule.rewardDescription ? `: ${rule.rewardDescription}` : ""}`;
  if (rule.rewardType === "PERCENT_FIXO" || rule.rewardType === "PERCENT_RESULTADO") {
    const base = rule.rewardType === "PERCENT_RESULTADO" && rule.rewardResultTypeName ? ` de ${rule.rewardResultTypeName}` : "";
    return `${label}${base}: ${rule.rewardPercentage ?? "—"}%`;
  }
  return `${label}: ${rule.rewardFixedValue ?? "—"}`;
}

// UI de exibição extraída de MyReceivablesBaseDetailPage.tsx (PASSO 18/19) —
// somente-leitura e 100% SIMULADA (nunca usa Realizado). Reaproveitada por 2
// wrappers finos: autoatendimento ("Minhas Bases", memberId = o próprio
// usuário logado) e Admin/Gestor vendo o detalhe de QUALQUER Beneficiário da
// Base (memberId vem da URL, não do usuário logado).
export function ReceivablesBaseDetailView({
  detail,
  page,
  onPageChange,
  memberId,
  onBack,
}: {
  detail: MyReceivablesBaseDetail;
  page: number;
  onPageChange: (page: number) => void;
  memberId: string;
  onBack: () => void;
}) {
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  const tierSeries: TierLadderSeriesInfo[] = useMemo(
    () => detail.tierLadder.map((tier) => ({ key: `tier${tier.order}`, label: `Degrau ${tier.order}` })),
    [detail],
  );

  const tierChartData: TierLadderChartPoint[] = useMemo(() => {
    return detail.tierPeriods.map((period) => {
      const point: TierLadderChartPoint = { label: periodLabel(period.periodStart, detail.periodicity) };
      let previous = 0;
      const sorted = [...period.tiers].sort((a, b) => a.order - b.order);
      for (const tier of sorted) {
        const cumulative = Number(tier.requiredValue);
        point[`tier${tier.order}`] = Math.max(cumulative - previous, 0);
        previous = cumulative;
      }
      return point;
    });
  }, [detail]);

  const triggerCharts = useMemo(() => {
    return detail.triggerSeries.map((series) => ({
      triggerId: series.triggerId,
      label: series.label,
      data: series.points.map((point) => ({ label: periodLabel(point.periodStart, detail.periodicity), value: Number(point.requiredValue) })),
    }));
  }, [detail]);

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:underline">
        ← Voltar
      </button>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.indicatorType === "META" ? "Baseado na Meta" : "Baseado no Tipo de Resultado"}: {detail.goalOrResultLabel}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Período de Fechamento</p>
          <p className="text-sm font-medium text-foreground">{PERIODICITY_LABELS[detail.periodicity]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Modo</p>
          <p className="text-sm font-medium text-foreground">{detail.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"}</p>
          <p className="text-xs text-muted-foreground">{TRIGGER_MODE_EXPLANATION[detail.triggerMode]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Período de Vigência</p>
          <p className="text-sm font-medium text-foreground">
            {detail.startDate ? formatDate(detail.startDate) : "Início aberto"} até {detail.endDate ? formatDate(detail.endDate) : "sem data final"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Entidade de Análise</p>
          <p className="text-sm font-medium text-foreground">
            {formatFullHierarchy(detail.hierarchyPath, detail.entityType, detail.entityName)}
          </p>
        </div>
      </div>

      {detail.conditionalTriggers.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Gatilhos Condicionais</h3>
          <ul className="space-y-0.5 text-sm text-foreground">
            {detail.conditionalTriggers.map((trigger) => (
              <li key={trigger.id}>
                {trigger.indicatorType === "META" ? "Meta" : "Resultado"}: {trigger.label} — mínimo{" "}
                {formatValue(trigger.requiredMinimum, trigger.indicatorType)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.tierLadder.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Degraus de Recompensa — baseados {detail.indicatorType === "META" ? "na Meta" : "no Resultado"} "{detail.goalOrResultLabel}"
          </h3>
          <ul className="space-y-1 text-sm text-foreground">
            {detail.tierLadder.map((tier) => (
              <li key={tier.order}>
                Degrau #{tier.order} — limiar {formatValue(tier.thresholdValue, detail.indicatorType)}
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {tier.rules.map((rule, index) => (
                    <li key={index}>{rewardText(rule)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Quanto é preciso fazer — Degraus (simulado, por período)</h3>
        <TierLadderChart data={tierChartData} series={tierSeries} />
      </div>

      {triggerCharts.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Quanto é preciso fazer — Gatilhos Condicionais (simulado, por período)</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {triggerCharts.map((chart) => (
              <TriggerRequirementChart key={chart.triggerId} title={chart.label} data={chart.data} />
            ))}
          </div>
        </div>
      )}

      {detail.pagination && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={!detail.pagination.hasPrev}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            ← Anterior
          </button>
          <button
            type="button"
            disabled={!detail.pagination.hasNext}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Próximo →
          </button>
        </div>
      )}

      {detail.canSimulate && (
        <div>
          <button
            type="button"
            onClick={() => setSimulatorOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Simular
          </button>
        </div>
      )}

      {simulatorOpen && (
        <MySimulatorModal
          baseId={detail.id}
          indicatorType={detail.indicatorType}
          memberId={memberId}
          triggers={detail.conditionalTriggers.map((trigger) => ({
            triggerId: trigger.id,
            label: trigger.label,
            verificationLevel: trigger.verificationLevel,
            indicatorType: trigger.indicatorType,
          }))}
          onClose={() => setSimulatorOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Reescrever `MyReceivablesBaseDetailPage.tsx` como wrapper fino**

Conteúdo completo do arquivo:

```tsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { ReceivablesBaseDetailView } from "./ReceivablesBaseDetailView";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";

// Wrapper de autoatendimento ("Minhas Bases", PASSO 18/19) — resolve o
// próprio Membro logado e delega toda a UI para ReceivablesBaseDetailView
// (compartilhada com a visão de Admin/Gestor, ver BeneficiaryReceivablesBaseDetailPage.tsx).
export function MyReceivablesBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const [page, setPage] = useState(0);

  const { data: detail, isLoading } = useMyReceivablesBaseDetail(id ?? null, page);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <ReceivablesBaseDetailView
      detail={detail}
      page={page}
      onPageChange={setPage}
      memberId={ownMemberId ?? ""}
      onBack={() => navigate("/bases-recebiveis?tab=minhas")}
    />
  );
}
```

- [ ] **Step 3: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 7: Client — hook, wrapper e rota para o Admin/Gestor

**Files:**
- Modify: `src/client/pages/bases-recebiveis/useReceivablesQueries.ts` (novo hook)
- Create: `src/client/pages/bases-recebiveis/BeneficiaryReceivablesBaseDetailPage.tsx`
- Modify: `src/client/routes/index.tsx` (import + nova rota)

**Interfaces:**
- Consumes: `MyReceivablesBaseDetail` (Task 4), `ReceivablesBaseDetailView` (Task 6), rota `GET /bases-recebiveis/:id/beneficiario/:memberId/graficos` (Task 3).
- Produces: `useReceivablesBaseDetailForBeneficiary(baseId, memberId, page)` — consumido pelo próprio Task 7; componente `BeneficiaryReceivablesBaseDetailPage` — consumido pela rota nova; rota `/bases-recebiveis/:id/beneficiario/:memberId` — consumida pelo Task 8 (navegação da tabela).

- [ ] **Step 1: Adicionar o hook em `useReceivablesQueries.ts`**

Logo abaixo de `useMyReceivablesBaseDetail` (que hoje é):

```ts
export function useMyReceivablesBaseDetail(id: string | null, page: number) {
  return useQuery({
    queryKey: ["my-receivables-base-detail", id, page],
    queryFn: async () => {
      const { data } = await api.get<MyReceivablesBaseDetail>(`/bases-recebiveis/minhas/${id}/graficos`, { params: { page } });
      return data;
    },
    enabled: !!id,
  });
}
```

adicionar:

```ts
export function useReceivablesBaseDetailForBeneficiary(baseId: string | null, memberId: string | null, page: number) {
  return useQuery({
    queryKey: ["receivables-base-detail-for-beneficiary", baseId, memberId, page],
    queryFn: async () => {
      const { data } = await api.get<MyReceivablesBaseDetail>(`/bases-recebiveis/${baseId}/beneficiario/${memberId}/graficos`, { params: { page } });
      return data;
    },
    enabled: !!baseId && !!memberId,
  });
}
```

- [ ] **Step 2: Criar `BeneficiaryReceivablesBaseDetailPage.tsx`**

```tsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReceivablesBaseDetailView } from "./ReceivablesBaseDetailView";
import { useReceivablesBaseDetailForBeneficiary } from "./useReceivablesQueries";

// Mesma tela de detalhe de "Minhas Bases" (PASSO 18/19), reaproveitada pelo
// Admin/Gestor pra ver o Recebível de QUALQUER Beneficiário da Base de forma
// objetiva e independente — aberta a partir da tabela de Beneficiários em
// ReceivablesBaseDetailPage.tsx.
export function BeneficiaryReceivablesBaseDetailPage() {
  const { id, memberId } = useParams<{ id: string; memberId: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const { data: detail, isLoading } = useReceivablesBaseDetailForBeneficiary(id ?? null, memberId ?? null, page);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <ReceivablesBaseDetailView
      detail={detail}
      page={page}
      onPageChange={setPage}
      memberId={memberId ?? ""}
      onBack={() => navigate(`/bases-recebiveis/${id}`)}
    />
  );
}
```

- [ ] **Step 3: Registrar a rota**

Em `src/client/routes/index.tsx`, adicionar o import logo abaixo de `MyReceivablesBaseDetailPage`:

```tsx
import { MyReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/MyReceivablesBaseDetailPage";
```

Para:

```tsx
import { MyReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/MyReceivablesBaseDetailPage";
import { BeneficiaryReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/BeneficiaryReceivablesBaseDetailPage";
```

E, logo depois da rota `/bases-recebiveis/minhas/:id`:

```tsx
      <Route
        path="/bases-recebiveis/minhas/:id"
        element={
          <RequireAuth>
            <MyReceivablesBaseDetailPage />
          </RequireAuth>
        }
      />
```

adicionar:

```tsx
      <Route
        path="/bases-recebiveis/:id/beneficiario/:memberId"
        element={
          <RequireAuth>
            <RequireRole allow={["ADMINISTRADOR", "LIDERANCA_NO"]}>
              <BeneficiaryReceivablesBaseDetailPage />
            </RequireRole>
          </RequireAuth>
        }
      />
```

- [ ] **Step 4: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 8: Client — `BeneficiariesSummaryTable.tsx`

**Files:**
- Create: `src/client/pages/bases-recebiveis/BeneficiariesSummaryTable.tsx`

**Interfaces:**
- Consumes: `formatFullHierarchy` (Task 5), `BeneficiaryRow`/`ConditionalTriggerRow`/`IndicatorType` (Task 4 + já existentes), `MySimulatorModal`.
- Produces: `BeneficiariesSummaryTable({ baseId, indicatorType, beneficiaries, conditionalTriggers, access, editableBeneficiaryMemberIds })` — consumido pelo Task 9.

- [ ] **Step 1: Criar o componente**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatFullHierarchy } from "./hierarchy";
import { MySimulatorModal } from "./MySimulatorModal";
import type { BeneficiaryRow, ConditionalTriggerRow, IndicatorType } from "./types";

function applicableTriggerCount(triggers: ConditionalTriggerRow[], memberId: string): number {
  return triggers.filter((trigger) => trigger.applicableMemberIds.length === 0 || trigger.applicableMemberIds.includes(memberId)).length;
}

// Tabela de resumo por Beneficiário na tela de edição de Base (Admin/Gestor)
// — substitui o antigo card "Simulador" (seletor genérico): cada linha já
// sabe seu Beneficiário, então o botão Simulador da linha não precisa de
// seletor. Clicar na linha (fora do botão) abre ReceivablesBaseDetailView
// para aquele Beneficiário específico (BeneficiaryReceivablesBaseDetailPage.tsx).
export function BeneficiariesSummaryTable({
  baseId,
  indicatorType,
  beneficiaries,
  conditionalTriggers,
  access,
  editableBeneficiaryMemberIds,
}: {
  baseId: string;
  indicatorType: IndicatorType;
  beneficiaries: BeneficiaryRow[];
  conditionalTriggers: ConditionalTriggerRow[];
  access: "FULL" | "PARTIAL";
  editableBeneficiaryMemberIds: string[];
}) {
  const navigate = useNavigate();
  const [simulatorMemberId, setSimulatorMemberId] = useState<string | null>(null);

  const simulatorBeneficiary = beneficiaries.find((b) => b.memberId === simulatorMemberId) ?? null;

  if (beneficiaries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum Beneficiário cadastrado ainda.</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Beneficiários</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Hierarquia do Beneficiado</th>
              <th className="px-3 py-2 font-medium">Hierarquia da Entidade Analisada</th>
              <th className="px-3 py-2 font-medium">Gatilhos Condicionais</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {beneficiaries.map((beneficiary) => {
              const owned = access !== "PARTIAL" || editableBeneficiaryMemberIds.includes(beneficiary.memberId);
              return (
                <tr
                  key={beneficiary.memberId}
                  onClick={() => navigate(`/bases-recebiveis/${baseId}/beneficiario/${beneficiary.memberId}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/30"
                >
                  <td className="px-3 py-2 font-medium text-foreground">{beneficiary.member.fullName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatFullHierarchy(beneficiary.memberHierarchyPath, "MEMBRO", beneficiary.member.fullName)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatFullHierarchy(beneficiary.entityHierarchyPath, beneficiary.entityType, beneficiary.entityName)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{applicableTriggerCount(conditionalTriggers, beneficiary.memberId)} Gatilho(s)</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={!owned}
                      title={owned ? undefined : "Somente consulta"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSimulatorMemberId(beneficiary.memberId);
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50 disabled:opacity-50"
                    >
                      {owned ? "Simular" : "🔒 Simular"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {simulatorBeneficiary && (
        <MySimulatorModal
          baseId={baseId}
          indicatorType={indicatorType}
          memberId={simulatorBeneficiary.memberId}
          triggers={conditionalTriggers
            .filter((trigger) => trigger.applicableMemberIds.length === 0 || trigger.applicableMemberIds.includes(simulatorBeneficiary.memberId))
            .map((trigger) => ({
              triggerId: trigger.id,
              label: trigger.indicatorType === "META" ? (trigger.conditionalGoal?.name ?? "—") : (trigger.resultType?.name ?? "—"),
              verificationLevel: trigger.verificationLevel,
              indicatorType: trigger.indicatorType,
            }))}
          onClose={() => setSimulatorMemberId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros.

---

### Task 9: Client — remover o card "Simulador" de `ReceivablesBaseDetailPage.tsx`, adicionar a tabela, apagar `SimulatorModal.tsx`

**Files:**
- Modify: `src/client/pages/bases-recebiveis/ReceivablesBaseDetailPage.tsx`
- Delete: `src/client/pages/bases-recebiveis/SimulatorModal.tsx`

**Interfaces:**
- Consumes: `BeneficiariesSummaryTable` (Task 8).
- Produces: nada consumido por outra task deste plano — última task de código.

- [ ] **Step 1: Trocar o import de `SimulatorModal` por `BeneficiariesSummaryTable`**

Local atual (linhas 1-18):

```tsx
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { Modal } from "./Modal";
import { BaseFormFields } from "./BaseFormFields";
import { BeneficiariesModal } from "./BeneficiariesModal";
import { AnalyzedEntitiesModal } from "./AnalyzedEntitiesModal";
import { ConditionalTriggersModal } from "./ConditionalTriggersModal";
import { TierLadderModal } from "./TierLadderModal";
import { SimulatorModal } from "./SimulatorModal";
import {
  useDeleteReceivablesBase,
  useDuplicateReceivablesBase,
  useReceivablesBaseDetail,
  useSaveReceivablesBase,
  useSetReceivablesBaseStatus,
} from "./useReceivablesQueries";
import type { ReceivablesBaseInput, ReceivablesStatus } from "./types";
```

Trocar para:

```tsx
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { Modal } from "./Modal";
import { BaseFormFields } from "./BaseFormFields";
import { BeneficiariesModal } from "./BeneficiariesModal";
import { BeneficiariesSummaryTable } from "./BeneficiariesSummaryTable";
import { AnalyzedEntitiesModal } from "./AnalyzedEntitiesModal";
import { ConditionalTriggersModal } from "./ConditionalTriggersModal";
import { TierLadderModal } from "./TierLadderModal";
import {
  useDeleteReceivablesBase,
  useDuplicateReceivablesBase,
  useReceivablesBaseDetail,
  useSaveReceivablesBase,
  useSetReceivablesBaseStatus,
} from "./useReceivablesQueries";
import type { ReceivablesBaseInput, ReceivablesStatus } from "./types";
```

- [ ] **Step 2: Remover `"simulador"` do tipo `OpenModal`**

Local atual:

```tsx
type OpenModal = "editar" | "beneficiados" | "entidades" | "gatilhos" | "degraus" | "simulador" | null;
```

Trocar para:

```tsx
type OpenModal = "editar" | "beneficiados" | "entidades" | "gatilhos" | "degraus" | null;
```

- [ ] **Step 3: Remover o card "Simulador" do grid**

Local atual (o grid inteiro, pra dar contexto exato de onde o card "Simulador" fica — só o último `<button>` é removido):

```tsx
        <button
          type="button"
          onClick={() => setOpenModal("degraus")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Degraus e Recompensas</h3>
          <p className="mt-1 text-xs text-muted-foreground">{base.tierRules.length} Degrau(s)</p>
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("simulador")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Simulador</h3>
          <p className="mt-1 text-xs text-muted-foreground">Simule o ganho de um Beneficiário</p>
        </button>
      </div>
```

Trocar para:

```tsx
        <button
          type="button"
          onClick={() => setOpenModal("degraus")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Degraus e Recompensas</h3>
          <p className="mt-1 text-xs text-muted-foreground">{base.tierRules.length} Degrau(s)</p>
        </button>
      </div>

      <BeneficiariesSummaryTable
        baseId={base.id}
        indicatorType={base.indicatorType}
        beneficiaries={base.beneficiaries}
        conditionalTriggers={base.conditionalTriggers}
        access={base.access}
        editableBeneficiaryMemberIds={base.editableBeneficiaryMemberIds}
      />
```

- [ ] **Step 4: Remover o bloco `openModal === "degraus"`/`"simulador"` do fim do arquivo**

Local atual:

```tsx
      {openModal === "degraus" && <TierLadderModal base={base} readOnly={isPartial} onClose={() => setOpenModal(null)} />}

      {openModal === "simulador" && (
        <SimulatorModal
          base={base}
          restrictToMemberIds={isPartial ? base.editableBeneficiaryMemberIds : null}
          onClose={() => setOpenModal(null)}
        />
      )}
    </div>
  );
}
```

Trocar para:

```tsx
      {openModal === "degraus" && <TierLadderModal base={base} readOnly={isPartial} onClose={() => setOpenModal(null)} />}
    </div>
  );
}
```

- [ ] **Step 5: Apagar `SimulatorModal.tsx`**

O arquivo `src/client/pages/bases-recebiveis/SimulatorModal.tsx` não tem mais nenhum uso (só era referenciado por `ReceivablesBaseDetailPage.tsx`, removido no Step 1) — apagar o arquivo por completo.

- [ ] **Step 6: Rodar `tsc` e confirmar que compila limpo**

Run: `npm run tsc`
Expected: sem erros (nenhuma referência solta a `SimulatorModal`).

---

### Task 10: Verificação final e registro no `.planosistemametas`

**Files:**
- Modify: `.planosistemametas` (novo registro `### PASSO 20`)

**Interfaces:**
- Consumes: nada (task de validação/documentação).
- Produces: nada.

- [ ] **Step 1: Smoke test no navegador — acesso FULL (Admin)**

Usando `agent-browser` numa sessão isolada, logado como `admin@demo.com`, abrir a tela de edição de uma Base de Recebível com múltiplos Beneficiários em níveis de hierarquia diferentes (ex.: `Meta Coordenadores - Atacado`, usada no smoke do PASSO 19 — tem Beneficiários em Departamento e Time):

1. Confirmar que o card "Simulador" não aparece mais no grid (só Beneficiados/Entidades Analisadas/Gatilhos Condicionais/Degraus e Recompensas).
2. Confirmar a tabela "Beneficiários" abaixo do grid, com 1 linha por Beneficiário, hierarquias corretas nas 2 colunas e contagem de Gatilhos correta.
3. Clicar numa linha (fora do botão Simular) — confirmar que abre `/bases-recebiveis/:id/beneficiario/:memberId` com o mesmo layout do detalhe de "Minhas Bases" (hierarquia, Gatilhos, Degraus, gráficos), e que "← Voltar" retorna pra `/bases-recebiveis/:id`.
4. Voltar, clicar no botão "Simular" de 1 linha — confirmar que `MySimulatorModal` abre pré-filtrado pros Gatilhos daquele Beneficiário, sem pedir pra selecionar quem é o Beneficiário.

- [ ] **Step 2: Smoke test no navegador — acesso PARCIAL (Gestor)**

Login como um Gestor de teste com acesso PARCIAL a alguma Base (ou criar o cenário via API se não existir um pronto): confirmar que Beneficiários fora do escopo do Gestor aparecem com o botão Simular travado (🔒 "Somente consulta", desabilitado), mas a linha continua clicável (visualizar é liberado); confirmar que abrir o detalhe desse Beneficiário fora do escopo funciona normalmente (`canSimulate: false` na resposta) e que o botão "Simular" não aparece na tela de detalhe dele.

- [ ] **Step 3: Limpeza**

Excluir qualquer usuário descartável criado para o teste e fechar a sessão isolada do `agent-browser`.

- [ ] **Step 4: Registrar no `.planosistemametas`**

Adicionar, logo após o registro do `### PASSO 19`, um novo registro:

```markdown
### PASSO 20 (FEITO <data>) — Tabela de Beneficiários na edição de Base de Recebível

Pedido do usuário: parte B de 3 ajustes independentes. Na tela de edição de uma Base de Recebível (Admin/Gestor), trocar o card "Simulador" (seletor genérico de Beneficiário) por uma tabela com 1 linha por Beneficiário — Nome, Hierarquia Completa do Beneficiado, Hierarquia Completa da Entidade Analisada, quantos Gatilhos Condicionais se aplicam, botão Simulador na própria linha. Clicar na linha abre a mesma tela de detalhe que "Minhas Bases" usa (PASSO 18/19), agora reaproveitada pra Admin/Gestor ver o Recebível de qualquer Beneficiário de forma objetiva.

**Implementado**: o núcleo de cálculo de `getMyReceivablesBaseDetail` foi extraído pra `buildReceivablesBaseDetailForBeneficiary` (função privada, `bases-recebiveis.service.ts`), reaproveitada pela nova `getReceivablesBaseDetailForBeneficiary` — mesma checagem de escopo (`resolveReceivablesBaseAccess`) já usada no Simulador de gestão, com a decisão de que VISUALIZAR o detalhe é liberado pra qualquer Beneficiário da Base mesmo em acesso PARCIAL (mesma filosofia já documentada em `getReceivablesBaseDetail`: "abre a Base inteira pra contexto"), mas SIMULAR continua restrito ao escopo do Gestor (campo novo `canSimulate` na resposta). `getReceivablesBaseDetail` (tela de configuração) ganhou `memberHierarchyPath`/`entityHierarchyPath` por Beneficiário. No client, a UI de `MyReceivablesBaseDetailPage.tsx` foi extraída pra `ReceivablesBaseDetailView.tsx` (componente de apresentação puro), reaproveitado por 2 wrappers finos — o de autoatendimento (existente) e o novo `BeneficiaryReceivablesBaseDetailPage.tsx` (rota `/bases-recebiveis/:id/beneficiario/:memberId`, Admin/Gestor). `LEVEL_LABEL`/`formatFullHierarchy` (Parte A) viraram um módulo pequeno compartilhado (`hierarchy.ts`). `BeneficiariesSummaryTable.tsx` é a tabela nova — contagem de Gatilhos e a lista pro Simulador de cada linha são calculadas no client a partir do que a tela já carrega (`applicableMemberIds`), sem endpoint extra. `SimulatorModal.tsx` (o "botão geral") foi apagado — sem mais nenhum uso.

**Validação**: `tsc` (server+client) limpo em cada task. Smoke no navegador cobrindo acesso FULL (Admin: tabela com hierarquias corretas, navegação pra detalhe de qualquer Beneficiário, Simulador por linha funcionando sem seletor) e acesso PARCIAL (Gestor: Simulador travado pros Beneficiários fora do escopo, mas linha/detalhe ainda visualizáveis).

---
```

Substituir `<data>` pela data em que a task foi de fato executada.
