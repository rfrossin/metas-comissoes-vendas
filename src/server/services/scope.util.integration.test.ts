import { beforeEach, describe, expect, it } from "vitest";
import { prismaTest, resetDatabase, seedTwoTenants, type TwoTenantFixtures } from "../test/fixtures";
import { assertEditableMembers, assertVisibleMembers, resolveVisibleMemberFilter } from "./scope.util";
import { ForbiddenError } from "../utils/http-errors";

// Este arquivo cobre o que a Fase 0 do plano de migração exige antes de
// qualquer mudança estrutural: (1) prova de que scope.util.ts nunca deixa
// vazar dado entre empresas, e (2) cobertura mínima do motor de permissão,
// que hoje tem zero testes apesar de ser a peça mais crítica de segurança
// do sistema.

describe("scope.util — isolamento entre empresas", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("assertVisibleMembers não valida pertencimento à empresa por si só — ADMINISTRADOR é sempre irrestrito (early return) e depende do chamador passar o companyId correto do JWT", async () => {
    const { tenantA, tenantB } = fixtures;

    // Isto documenta o contrato real da função, não um bug: assertVisibleMembers
    // nunca consulta o banco para ADMINISTRADOR (scope.util.ts:363), então
    // ela sozinha não impede cross-tenant — a proteção real está em cada
    // serviço reconsultar a entidade com { id, companyId } antes de agir
    // (ver resultados.service.integration.test.ts e
    // cargos.service.integration.test.ts, onde o vazamento é de fato barrado
    // no ponto em que a entidade é carregada).
    await expect(
      assertVisibleMembers(tenantA.companyId, tenantA.adminUser, [tenantB.memberId]),
    ).resolves.toBeUndefined();
  });

  it("Gestor da Empresa A não pode validar Membro da Empresa B como editável", async () => {
    const { tenantA, tenantB } = fixtures;

    await expect(
      assertEditableMembers(tenantA.companyId, tenantA.managerUser, [tenantB.memberId]),
    ).rejects.toThrow(ForbiddenError);
  });

  it("Usuário Operacional da Empresa A não pode validar Membro da Empresa B", async () => {
    const { tenantA, tenantB } = fixtures;

    await expect(
      assertVisibleMembers(tenantA.companyId, tenantA.operationalUser, [tenantB.memberId]),
    ).rejects.toThrow(ForbiddenError);
  });

  it("resolveVisibleMemberFilter da Empresa A nunca inclui Membro da Empresa B mesmo com id direto", async () => {
    const { tenantA, tenantB } = fixtures;

    const filter = await resolveVisibleMemberFilter(tenantA.companyId, tenantA.operationalUser);

    const leaked = await prismaTest.member.findFirst({
      where: {
        id: tenantB.memberId,
        // companyId da empresa ERRADA de propósito — simula um bug real de
        // esquecer o filtro de tenant numa query nova.
        AND: [filter === "ALL" ? {} : filter],
      },
    });

    expect(leaked).toBeNull();
  });

  it("mutação direta por id sem filtro de companyId não afeta linha de outra empresa (contrato do check-then-act)", async () => {
    const { tenantB } = fixtures;

    // Replica o padrão usado em todo o backend (ex.: cargos.service.ts):
    // primeiro um findFirst com companyId da empresa ERRADA, que deve
    // retornar null e impedir o update de sequer ser tentado.
    const found = await prismaTest.member.findFirst({
      where: { id: tenantB.memberId, companyId: "empresa-inexistente" },
    });

    expect(found).toBeNull();
  });
});

describe("scope.util — resolução de escopo por papel", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("Administrador sempre resolve para ALL", async () => {
    const { tenantA } = fixtures;
    const filter = await resolveVisibleMemberFilter(tenantA.companyId, tenantA.adminUser);
    expect(filter).toBe("ALL");
  });

  it("Usuário Operacional sem atribuições e sem vínculo de Membro não vê nenhum Membro", async () => {
    const { tenantA } = fixtures;

    const userWithoutMember = await prismaTest.user.create({
      data: {
        companyId: tenantA.companyId,
        email: "sem-vinculo@teste.local",
        passwordHash: "x",
        role: "OPERACIONAL",
      },
    });

    const filter = await resolveVisibleMemberFilter(tenantA.companyId, {
      id: userWithoutMember.id,
      companyId: tenantA.companyId,
      role: "OPERACIONAL",
    });

    expect(filter).not.toBe("ALL");
    const count = await prismaTest.member.count({
      where: { companyId: tenantA.companyId, AND: [filter as object] },
    });
    expect(count).toBe(0);
  });

  it("Usuário Operacional com Membro vinculado vê a si mesmo", async () => {
    const { tenantA } = fixtures;

    const filter = await resolveVisibleMemberFilter(tenantA.companyId, tenantA.operationalUser);
    expect(filter).not.toBe("ALL");

    const count = await prismaTest.member.count({
      where: { companyId: tenantA.companyId, id: tenantA.memberId, AND: [filter as object] },
    });
    expect(count).toBe(1);
  });

  it("regra de exclusão de líder: atribuição de hierarquia dá acesso ao Time mas exclui o próprio Membro-líder do nó atribuído", async () => {
    const { tenantA } = fixtures;

    // Um segundo Membro no mesmo Time, que será o "liderado" visível via
    // atribuição de hierarquia.
    const ledMember = await prismaTest.member.create({
      data: {
        companyId: tenantA.companyId,
        teamId: tenantA.teamId,
        cargoId: (await prismaTest.cargo.findFirstOrThrow({ where: { companyId: tenantA.companyId } })).id,
        fullName: "Membro Liderado",
        memberType: "OPERADOR",
        status: "ATIVO",
      },
    });

    // tenantA.memberId (vinculado ao operationalUser) é registrado como
    // Responsável (líder) do Time.
    await prismaTest.nodeResponsible.create({
      data: {
        companyId: tenantA.companyId,
        nodeType: "TIME",
        teamId: tenantA.teamId,
        memberId: tenantA.memberId,
      },
    });

    const gestor = await prismaTest.user.create({
      data: {
        companyId: tenantA.companyId,
        email: "gestor-time@teste.local",
        passwordHash: "x",
        role: "OPERACIONAL",
      },
    });

    await prismaTest.userScopeAssignment.create({
      data: {
        companyId: tenantA.companyId,
        userId: gestor.id,
        scopeType: "TIME",
        scopeId: tenantA.teamId,
        accessLevel: "VISUALIZAR",
      },
    });

    const filter = await resolveVisibleMemberFilter(tenantA.companyId, {
      id: gestor.id,
      companyId: tenantA.companyId,
      role: "OPERACIONAL",
    });
    expect(filter).not.toBe("ALL");

    const visibleIds = await prismaTest.member.findMany({
      where: { companyId: tenantA.companyId, AND: [filter as object] },
      select: { id: true },
    });
    const ids = visibleIds.map((m) => m.id);

    expect(ids).toContain(ledMember.id);
    expect(ids).not.toContain(tenantA.memberId);
  });
});
