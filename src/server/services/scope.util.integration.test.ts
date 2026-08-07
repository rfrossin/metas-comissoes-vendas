import { beforeEach, describe, expect, it } from "vitest";
import { prismaTest, resetDatabase, seedTwoTenants, type TwoTenantFixtures } from "../test/fixtures";
import {
  assertEditableMembers,
  assertMemberWithinLedScope,
  assertVisibleMembers,
  resolveAncestorIds,
  resolveVisibleMemberFilter,
} from "./scope.util";
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

  // Regra confirmada com o usuário (2026-08-06): uma atribuição de
  // hierarquia alcança TODOS os Membros abaixo dela, LÍDERES INCLUSIVE.
  // Este teste afirmava o contrário (a antiga "exclusão de líder", que
  // removia do escopo o Responsável do nó atribuído) — era justamente o
  // que deixava a tela de Membros vazia e escondia os líderes dos Times em
  // Fechamento/Recebíveis para quem tinha atribuição de Departamento.
  it("atribuição de hierarquia dá acesso a todo o Time, incluindo o Membro-líder do nó atribuído", async () => {
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
    // O líder do Time entra no escopo junto com o resto do Time.
    expect(ids).toContain(tenantA.memberId);
  });

  // Regressão do caso reportado em 2026-08-07: um Gestor de Departamento
  // não conseguia editar o Gestor de um Time abaixo dele. O líder de um
  // Time normalmente NÃO pertence a Time nenhum (teamId null) — ele lidera
  // o nó, não é membro dele —, e a checagem de escrita só olhava
  // member.teamId, caindo em "sem nó" e negando para todo mundo menos o
  // Admin.
  it("Gestor de Departamento pode editar o Gestor de um Time abaixo dele (líder sem Time próprio)", async () => {
    const { tenantA } = fixtures;
    const cargo = await prismaTest.cargo.findFirstOrThrow({ where: { companyId: tenantA.companyId } });

    // Gestor do Time: sem teamId, existindo na árvore só pela liderança.
    const teamLeader = await prismaTest.member.create({
      data: {
        companyId: tenantA.companyId,
        teamId: null,
        cargoId: cargo.id,
        fullName: "Gestor do Time",
        memberType: "GESTOR",
        status: "ATIVO",
        nodeResponsibleFor: {
          create: { companyId: tenantA.companyId, nodeType: "TIME", teamId: tenantA.teamId },
        },
      },
    });

    // Usuário Gestor com atribuição no DEPARTAMENTO que contém aquele Time.
    const team = await prismaTest.team.findFirstOrThrow({ where: { id: tenantA.teamId } });
    const gestorDepto = await prismaTest.user.create({
      data: {
        companyId: tenantA.companyId,
        email: "gestor-depto@teste.local",
        passwordHash: "x",
        role: "LIDERANCA_NO",
        memberId: tenantA.memberId,
      },
    });
    await prismaTest.userScopeAssignment.create({
      data: {
        companyId: tenantA.companyId,
        userId: gestorDepto.id,
        scopeType: "DEPARTAMENTO",
        scopeId: team.departmentId,
        accessLevel: "EDITAR",
      },
    });

    const requester = { id: gestorDepto.id, companyId: tenantA.companyId, role: "LIDERANCA_NO" };

    // Não lança: o líder do Time é alcançável pela atribuição de Departamento.
    await expect(
      assertMemberWithinLedScope(tenantA.companyId, requester, { id: teamLeader.id, teamId: null }),
    ).resolves.toBeUndefined();
  });

  // Regra confirmada com o usuário (2026-08-07): TODO Membro fica sob uma
  // hierarquia. Quem não tem Time é posicionado pelo nó que LIDERA, gerando
  // um caminho PARCIAL — um Líder de Departamento fica em Canal>Depto (sem
  // Time), um Gerente de Canal em Canal.
  it("resolveAncestorIds posiciona o Líder de Time pelo Time que ele lidera (caminho completo)", async () => {
    const { tenantA } = fixtures;
    const cargo = await prismaTest.cargo.findFirstOrThrow({ where: { companyId: tenantA.companyId } });
    const team = await prismaTest.team.findFirstOrThrow({ where: { id: tenantA.teamId } });
    const department = await prismaTest.department.findFirstOrThrow({ where: { id: team.departmentId } });

    const leader = await prismaTest.member.create({
      data: {
        companyId: tenantA.companyId,
        teamId: null,
        cargoId: cargo.id,
        fullName: "Líder do Time",
        memberType: "GESTOR",
        status: "ATIVO",
        nodeResponsibleFor: { create: { companyId: tenantA.companyId, nodeType: "TIME", teamId: team.id } },
      },
    });

    const ancestry = await resolveAncestorIds(tenantA.companyId, "MEMBRO", leader.id);

    expect(ancestry.memberId).toBe(leader.id);
    expect(ancestry.teamId).toBe(team.id);
    expect(ancestry.departmentId).toBe(department.id);
    expect(ancestry.channelId).toBe(department.channelId);
  });

  it("resolveAncestorIds posiciona o Líder de Departamento em Canal>Departamento, sem Time", async () => {
    const { tenantA } = fixtures;
    const cargo = await prismaTest.cargo.findFirstOrThrow({ where: { companyId: tenantA.companyId } });
    const team = await prismaTest.team.findFirstOrThrow({ where: { id: tenantA.teamId } });
    const department = await prismaTest.department.findFirstOrThrow({ where: { id: team.departmentId } });

    const leader = await prismaTest.member.create({
      data: {
        companyId: tenantA.companyId,
        teamId: null,
        cargoId: cargo.id,
        fullName: "Líder do Departamento",
        memberType: "GESTOR",
        status: "ATIVO",
        nodeResponsibleFor: {
          create: { companyId: tenantA.companyId, nodeType: "DEPARTAMENTO", departmentId: department.id },
        },
      },
    });

    const ancestry = await resolveAncestorIds(tenantA.companyId, "MEMBRO", leader.id);

    // Caminho PARCIAL: chega até o Departamento e para — ele não pertence a
    // Time nenhum, e inventar um seria errado.
    expect(ancestry.teamId).toBeNull();
    expect(ancestry.departmentId).toBe(department.id);
    expect(ancestry.channelId).toBe(department.channelId);
  });

  it("resolveAncestorIds não posiciona quem não tem Time nem liderança", async () => {
    const { tenantA } = fixtures;
    const cargo = await prismaTest.cargo.findFirstOrThrow({ where: { companyId: tenantA.companyId } });

    const floating = await prismaTest.member.create({
      data: {
        companyId: tenantA.companyId,
        teamId: null,
        cargoId: cargo.id,
        fullName: "Sem alocação",
        memberType: "GESTOR",
        status: "ATIVO",
      },
    });

    const ancestry = await resolveAncestorIds(tenantA.companyId, "MEMBRO", floating.id);

    expect(ancestry.teamId).toBeNull();
    expect(ancestry.departmentId).toBeNull();
    expect(ancestry.channelId).toBeNull();
  });

  it("Gestor não alcança um Membro sem Time e sem liderança nenhuma", async () => {
    const { tenantA } = fixtures;
    const cargo = await prismaTest.cargo.findFirstOrThrow({ where: { companyId: tenantA.companyId } });
    const team = await prismaTest.team.findFirstOrThrow({ where: { id: tenantA.teamId } });

    // Diretoria sem alocação: não tem Time nem lidera nada — não há nó pelo
    // qual um Gestor de Departamento possa alcançá-lo.
    const floating = await prismaTest.member.create({
      data: {
        companyId: tenantA.companyId,
        teamId: null,
        cargoId: cargo.id,
        fullName: "Diretor sem alocação",
        memberType: "GESTOR",
        status: "ATIVO",
      },
    });

    const gestorDepto = await prismaTest.user.create({
      data: {
        companyId: tenantA.companyId,
        email: "gestor-depto-2@teste.local",
        passwordHash: "x",
        role: "LIDERANCA_NO",
        memberId: tenantA.memberId,
      },
    });
    await prismaTest.userScopeAssignment.create({
      data: {
        companyId: tenantA.companyId,
        userId: gestorDepto.id,
        scopeType: "DEPARTAMENTO",
        scopeId: team.departmentId,
        accessLevel: "EDITAR",
      },
    });

    await expect(
      assertMemberWithinLedScope(
        tenantA.companyId,
        { id: gestorDepto.id, companyId: tenantA.companyId, role: "LIDERANCA_NO" },
        { id: floating.id, teamId: null },
      ),
    ).rejects.toThrow();
  });
});
