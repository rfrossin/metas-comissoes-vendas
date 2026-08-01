import { beforeEach, describe, expect, it } from "vitest";
import { prismaTest, resetDatabase, runWithTenant, seedTwoTenants, type TwoTenantFixtures } from "../test/fixtures";
import { createCargo, deleteCargo, updateCargo } from "./cargos.service";
import { NotFoundError } from "../utils/http-errors";

// cargos.service.ts é o padrão de referência do "check-then-act" usado em
// ~25 mutações do backend: findFirst({id, companyId}) antes de um
// update/delete({where:{id}}) que sozinho não filtra tenant. A partir da
// Fase 4, a proteção não depende só desse padrão em código — o role
// app_backend só escreve dentro do companyId setado via runWithTenant
// (que simula o tenantMiddleware real), reforçado por RLS no banco.
//
// runWithTenant SEMPRE usa o companyId do REQUISITANTE (nunca o da vítima)
// — é isso que replica corretamente um ataque real: o backend só conhece
// req.user.companyId, nunca aceita companyId vindo do payload.
describe("cargos.service — escrita e isolamento de tenant", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("Admin cria e edita Cargo dentro da própria empresa", async () => {
    const { tenantA } = fixtures;

    const cargo = await runWithTenant(tenantA.companyId, () =>
      createCargo(tenantA.companyId, tenantA.adminUser, {
        name: "Vendedor Sênior",
        defaultFixedSalary: 300000,
        permissionLevel: "OPERACIONAL",
      }),
    );

    const updated = await runWithTenant(tenantA.companyId, () =>
      updateCargo(tenantA.companyId, tenantA.adminUser, cargo.id, {
        name: "Vendedor Sênior II",
        defaultFixedSalary: 350000,
        permissionLevel: "OPERACIONAL",
      }),
    );

    expect(updated.name).toBe("Vendedor Sênior II");
    expect(updated.companyId).toBe(tenantA.companyId);
  });

  it("teste de vazamento: Admin da Empresa A não consegue editar Cargo da Empresa B por id direto", async () => {
    const { tenantA, tenantB } = fixtures;

    const cargoB = await runWithTenant(tenantB.companyId, () =>
      createCargo(tenantB.companyId, tenantB.adminUser, {
        name: "Cargo B",
        defaultFixedSalary: 100000,
        permissionLevel: "OPERACIONAL",
      }),
    );

    // Contexto de tenant é o de A (o requisitante real) — mesmo que o
    // código do serviço tivesse um bug e tentasse escrever em cargoB.id,
    // o RLS do banco rejeitaria por estar fora do companyId do GUC.
    await expect(
      runWithTenant(tenantA.companyId, () =>
        updateCargo(tenantA.companyId, tenantA.adminUser, cargoB.id, {
          name: "Sequestrado pela Empresa A",
          defaultFixedSalary: 1,
          permissionLevel: "OPERACIONAL",
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    const unchanged = await prismaTest.cargo.findUniqueOrThrow({ where: { id: cargoB.id } });
    expect(unchanged.name).toBe("Cargo B");
    expect(unchanged.defaultFixedSalary.toNumber()).toBe(100000);
  });

  it("teste de vazamento: Admin da Empresa A não consegue excluir Cargo da Empresa B por id direto", async () => {
    const { tenantA, tenantB } = fixtures;

    const cargoB = await runWithTenant(tenantB.companyId, () =>
      createCargo(tenantB.companyId, tenantB.adminUser, {
        name: "Cargo B",
        defaultFixedSalary: 100000,
        permissionLevel: "OPERACIONAL",
      }),
    );

    await expect(
      runWithTenant(tenantA.companyId, () => deleteCargo(tenantA.companyId, tenantA.adminUser, cargoB.id)),
    ).rejects.toThrow(NotFoundError);

    const stillExists = await prismaTest.cargo.findUnique({ where: { id: cargoB.id } });
    expect(stillExists).not.toBeNull();
  });

  it("teste de vazamento REAL de RLS: escrita direta via Prisma restrito, ignorando o guard de aplicação, ainda é bloqueada pelo banco", async () => {
    const { tenantA, tenantB } = fixtures;

    const cargoB = await runWithTenant(tenantB.companyId, () =>
      createCargo(tenantB.companyId, tenantB.adminUser, {
        name: "Cargo B Original",
        defaultFixedSalary: 100000,
        permissionLevel: "OPERACIONAL",
      }),
    );

    // Simula um bug hipotético que pulasse o findFirst/check-then-act e
    // tentasse o update direto por id, sob o contexto de tenant de A — é
    // exatamente o cenário que RLS (não o código) precisa impedir.
    const { writeWithTenant } = await import("../config/prisma");
    await expect(
      runWithTenant(tenantA.companyId, () =>
        writeWithTenant((tx) => tx.cargo.update({ where: { id: cargoB.id }, data: { name: "HACKEADO" } })),
      ),
    ).rejects.toThrow();

    const unchanged = await prismaTest.cargo.findUniqueOrThrow({ where: { id: cargoB.id } });
    expect(unchanged.name).toBe("Cargo B Original");
  });

  it("Gestor (LIDERANCA_NO) não pode criar Cargo", async () => {
    const { tenantA } = fixtures;

    await expect(
      runWithTenant(tenantA.companyId, () =>
        createCargo(tenantA.companyId, tenantA.managerUser, {
          name: "Cargo Indevido",
          defaultFixedSalary: 100000,
          permissionLevel: "OPERACIONAL",
        }),
      ),
    ).rejects.toThrow();
  });
});
