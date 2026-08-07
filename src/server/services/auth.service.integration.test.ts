import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { resetDatabase, seedTwoTenants, linkSupabaseIdentity, prismaTest, type TwoTenantFixtures } from "../test/fixtures";
import { chooseCompany, login, switchCompany } from "./auth.service";
import { UnauthorizedError } from "../utils/http-errors";
import { env } from "../config/env";

describe("auth.service — login via Supabase Auth", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("autentica com credenciais corretas e emite token com companyId da empresa certa (uma única membership)", async () => {
    const { tenantA } = fixtures;
    await linkSupabaseIdentity("admin-a@teste.local", "senha-supabase-123", [
      { userId: tenantA.adminUser.id, companyId: tenantA.companyId, role: "ADMINISTRADOR" },
    ]);

    const result = await login({ email: "admin-a@teste.local", password: "senha-supabase-123" });

    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("esperado status OK");
    expect(result.user.companyId).toBe(tenantA.companyId);
    expect(result.user.role).toBe("ADMINISTRADOR");

    const payload = jwt.verify(result.token, env.jwtSecret) as { companyId: string };
    expect(payload.companyId).toBe(tenantA.companyId);
  });

  // Regressão: o papel do token vinha do app_metadata da identidade, que NÃO
  // é reescrito quando um Admin troca o papel de alguém (updateUserRole mexe
  // só na tabela users). Quem era promovido a Administrador continuava
  // navegando com o papel antigo — e como o objeto `user` do login já vinha
  // do banco (papel novo), a tela liberava seções que o backend negava.
  it("token usa o papel do BANCO, não o do app_metadata desatualizado", async () => {
    const { tenantA } = fixtures;

    // Identidade gravada com o papel ANTIGO, como ficaria após uma promoção
    // feita depois do aceite do convite.
    await linkSupabaseIdentity("admin-a@teste.local", "senha-supabase-123", [
      { userId: tenantA.adminUser.id, companyId: tenantA.companyId, role: "OPERACIONAL" },
    ]);
    await prismaTest.user.update({ where: { id: tenantA.adminUser.id }, data: { role: "ADMINISTRADOR" } });

    const result = await login({ email: "admin-a@teste.local", password: "senha-supabase-123" });

    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("esperado status OK");

    const payload = jwt.verify(result.token, env.jwtSecret) as { role: string };
    expect(payload.role).toBe("ADMINISTRADOR");
    // Token e resposta têm de concordar — a divergência entre os dois era o
    // que fazia a UI e o backend discordarem sobre o que liberar.
    expect(result.user.role).toBe("ADMINISTRADOR");
  });

  it("rejeita senha incorreta", async () => {
    const { tenantA } = fixtures;
    await linkSupabaseIdentity("admin-a@teste.local", "senha-correta-123", [
      { userId: tenantA.adminUser.id, companyId: tenantA.companyId, role: "ADMINISTRADOR" },
    ]);

    await expect(login({ email: "admin-a@teste.local", password: "senha-errada-123" })).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejeita e-mail inexistente", async () => {
    await expect(login({ email: "ninguem@teste.local", password: "qualquer-senha-123" })).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("identidade com múltiplas empresas retorna CHOOSE_COMPANY, e escolher-empresa emite o token correto", async () => {
    const { tenantA, tenantB } = fixtures;

    // Mesma identidade Supabase (mesmo e-mail) vinculada a um User em cada
    // empresa — o cenário de membership multi-empresa que a Fase 3
    // corrige, substituindo o bug de e-mail duplicado do JWT próprio.
    await linkSupabaseIdentity("consultor@teste.local", "senha-multi-123", [
      { userId: tenantA.operationalUser.id, companyId: tenantA.companyId, role: "OPERACIONAL" },
      { userId: tenantB.managerUser.id, companyId: tenantB.companyId, role: "LIDERANCA_NO" },
    ]);

    const loginResult = await login({ email: "consultor@teste.local", password: "senha-multi-123" });
    expect(loginResult.status).toBe("CHOOSE_COMPANY");
    if (loginResult.status !== "CHOOSE_COMPANY") throw new Error("esperado status CHOOSE_COMPANY");
    expect(loginResult.companies).toHaveLength(2);
    expect(loginResult.companies.map((c) => c.companyId).sort()).toEqual(
      [tenantA.companyId, tenantB.companyId].sort(),
    );

    const chosen = await chooseCompany(loginResult.preAuthToken, tenantB.companyId);
    expect(chosen.status).toBe("OK");
    if (chosen.status !== "OK") throw new Error("esperado status OK");
    expect(chosen.user.companyId).toBe(tenantB.companyId);
    expect(chosen.user.role).toBe("LIDERANCA_NO");
  });

  it("teste de vazamento: escolher-empresa rejeita companyId fora das memberships da identidade", async () => {
    const { tenantA, tenantB } = fixtures;
    await linkSupabaseIdentity("admin-a@teste.local", "senha-supabase-123", [
      { userId: tenantA.adminUser.id, companyId: tenantA.companyId, role: "ADMINISTRADOR" },
    ]);

    const loginResult = await login({ email: "admin-a@teste.local", password: "senha-supabase-123" });
    // Só uma membership: login já retorna OK direto. Simulamos a tentativa
    // de chooseCompany mesmo assim, usando um preAuthToken forjado só para
    // provar que o companyId de outra empresa nunca é aceito.
    expect(loginResult.status).toBe("OK");

    const forgedPreAuthToken = jwt.sign(
      { authUserId: (await prismaTest.user.findFirstOrThrow({ where: { id: tenantA.adminUser.id } })).authUserId, purpose: "choose-company" },
      env.jwtSecret,
      { expiresIn: "5m" },
    );

    await expect(chooseCompany(forgedPreAuthToken, tenantB.companyId)).rejects.toThrow(UnauthorizedError);
  });

  it("switchCompany troca a empresa ativa de um usuário já logado com múltiplas memberships", async () => {
    const { tenantA, tenantB } = fixtures;
    await linkSupabaseIdentity("consultor@teste.local", "senha-multi-123", [
      { userId: tenantA.operationalUser.id, companyId: tenantA.companyId, role: "OPERACIONAL" },
      { userId: tenantB.managerUser.id, companyId: tenantB.companyId, role: "LIDERANCA_NO" },
    ]);

    const switched = await switchCompany(tenantA.operationalUser.id, tenantB.companyId);
    expect(switched.status).toBe("OK");
    if (switched.status !== "OK") throw new Error("esperado status OK");
    expect(switched.user.companyId).toBe(tenantB.companyId);
    expect(switched.user.id).toBe(tenantB.managerUser.id);
  });

  it("switchCompany rejeita empresa fora das memberships do usuário", async () => {
    const { tenantA, tenantB } = fixtures;
    await linkSupabaseIdentity("admin-a@teste.local", "senha-supabase-123", [
      { userId: tenantA.adminUser.id, companyId: tenantA.companyId, role: "ADMINISTRADOR" },
    ]);

    await expect(switchCompany(tenantA.adminUser.id, tenantB.companyId)).rejects.toThrow(UnauthorizedError);
  });
});
