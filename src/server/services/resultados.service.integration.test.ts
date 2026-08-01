import { beforeEach, describe, expect, it } from "vitest";
import { prismaTest, resetDatabase, runWithTenant, seedTwoTenants, type TwoTenantFixtures } from "../test/fixtures";
import { createResultEntry, createResultType, updateResultEntry } from "./resultados.service";
import { ForbiddenError, NotFoundError } from "../utils/http-errors";

describe("resultados.service — escrita e isolamento de tenant", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("Admin cria Tipo de Resultado e Membro lança Resultado dentro da própria empresa", async () => {
    const { tenantA } = fixtures;

    const type = await runWithTenant(tenantA.companyId, () =>
      createResultType(tenantA.companyId, tenantA.adminUser, { name: "Vendas", unit: "MOEDA" }),
    );

    const entry = await runWithTenant(tenantA.companyId, () =>
      createResultEntry(tenantA.companyId, tenantA.adminUser, {
        memberId: tenantA.memberId,
        typeId: type.id,
        date: "2026-07-15",
        value: 1000,
      }),
    );

    expect(entry.companyId).toBe(tenantA.companyId);
    expect(entry.memberId).toBe(tenantA.memberId);
  });

  it("Usuário Operacional sem permissão não consegue lançar Resultado para si mesmo", async () => {
    const { tenantA } = fixtures;

    const type = await runWithTenant(tenantA.companyId, () =>
      createResultType(tenantA.companyId, tenantA.adminUser, { name: "Vendas", unit: "MOEDA" }),
    );

    await expect(
      runWithTenant(tenantA.companyId, () =>
        createResultEntry(tenantA.companyId, tenantA.operationalUser, {
          memberId: tenantA.memberId,
          typeId: type.id,
          date: "2026-07-15",
          value: 500,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("teste de vazamento: Admin da Empresa A não consegue lançar Resultado para Membro da Empresa B", async () => {
    const { tenantA, tenantB } = fixtures;

    const type = await runWithTenant(tenantA.companyId, () =>
      createResultType(tenantA.companyId, tenantA.adminUser, { name: "Vendas", unit: "MOEDA" }),
    );

    // Contexto é o do requisitante real (A) — igual ao backend real, que só
    // conhece req.user.companyId, nunca aceita companyId do payload.
    await expect(
      runWithTenant(tenantA.companyId, () =>
        createResultEntry(tenantA.companyId, tenantA.adminUser, {
          memberId: tenantB.memberId,
          typeId: type.id,
          date: "2026-07-15",
          value: 500,
        }),
      ),
    ).rejects.toThrow();
  });

  it("teste de vazamento: Admin da Empresa A não consegue editar Resultado da Empresa B por id direto", async () => {
    const { tenantA, tenantB } = fixtures;

    const typeB = await runWithTenant(tenantB.companyId, () =>
      createResultType(tenantB.companyId, tenantB.adminUser, { name: "Vendas B", unit: "MOEDA" }),
    );

    const entryB = await runWithTenant(tenantB.companyId, () =>
      createResultEntry(tenantB.companyId, tenantB.adminUser, {
        memberId: tenantB.memberId,
        typeId: typeB.id,
        date: "2026-07-15",
        value: 999,
      }),
    );

    // Admin da empresa A tenta editar o registro de B usando o companyId de A
    // (simula um controller que só tem req.user.companyId disponível).
    await expect(
      runWithTenant(tenantA.companyId, () =>
        updateResultEntry(tenantA.companyId, tenantA.adminUser, entryB.id, {
          typeId: typeB.id,
          date: "2026-07-20",
          value: 1,
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    const unchanged = await prismaTest.resultEntry.findUniqueOrThrow({ where: { id: entryB.id } });
    expect(unchanged.value.toNumber()).toBe(999);
  });

  it("não permite Tipo de Resultado duplicado dentro da mesma empresa", async () => {
    const { tenantA } = fixtures;

    await runWithTenant(tenantA.companyId, () =>
      createResultType(tenantA.companyId, tenantA.adminUser, { name: "Vendas", unit: "MOEDA" }),
    );

    await expect(
      runWithTenant(tenantA.companyId, () =>
        createResultType(tenantA.companyId, tenantA.adminUser, { name: "Vendas", unit: "MOEDA" }),
      ),
    ).rejects.toThrow();
  });

  it("permite o mesmo nome de Tipo de Resultado em empresas diferentes", async () => {
    const { tenantA, tenantB } = fixtures;

    const typeA = await runWithTenant(tenantA.companyId, () =>
      createResultType(tenantA.companyId, tenantA.adminUser, { name: "Vendas", unit: "MOEDA" }),
    );
    const typeB = await runWithTenant(tenantB.companyId, () =>
      createResultType(tenantB.companyId, tenantB.adminUser, { name: "Vendas", unit: "MOEDA" }),
    );

    expect(typeA.id).not.toBe(typeB.id);
  });

  it("teste de vazamento REAL de RLS: escrita direta via Prisma restrito, ignorando o guard de aplicação, ainda é bloqueada pelo banco", async () => {
    const { tenantA, tenantB } = fixtures;

    const typeB = await runWithTenant(tenantB.companyId, () =>
      createResultType(tenantB.companyId, tenantB.adminUser, { name: "Vendas B", unit: "MOEDA" }),
    );
    const entryB = await runWithTenant(tenantB.companyId, () =>
      createResultEntry(tenantB.companyId, tenantB.adminUser, {
        memberId: tenantB.memberId,
        typeId: typeB.id,
        date: "2026-07-15",
        value: 999,
      }),
    );

    const { writeWithTenant } = await import("../config/prisma");
    await expect(
      runWithTenant(tenantA.companyId, () =>
        writeWithTenant((tx) => tx.resultEntry.update({ where: { id: entryB.id }, data: { value: 1 } })),
      ),
    ).rejects.toThrow();

    const unchanged = await prismaTest.resultEntry.findUniqueOrThrow({ where: { id: entryB.id } });
    expect(unchanged.value.toNumber()).toBe(999);
  });
});
