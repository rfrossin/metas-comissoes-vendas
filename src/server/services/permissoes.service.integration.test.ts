import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, runWithTenant, seedTwoTenants, linkSupabaseIdentity, prismaTest, type TwoTenantFixtures } from "../test/fixtures";
import { acceptInvite, changeMyPassword, createInvite } from "./permissoes.service";
import { login } from "./auth.service";
import { supabaseAdmin } from "../config/supabase";
import { NotFoundError, UnauthorizedError } from "../utils/http-errors";

// createInvite chama inviteUserByEmail (envia e-mail de verdade), que está
// sujeito ao rate limit do provedor de e-mail — mesmo no Supabase local
// (Mailpit). Para não depender disso, os testes criam a identidade
// manualmente com createUser ANTES do convite, simulando o cenário real de
// "a pessoa já tem conta" ou testando só a parte de negócio (Invite +
// vínculo em acceptInvite), que é o que create/acceptInvite garantem —
// createInvite engolir erro de e-mail (linha `.catch(() => undefined)`) é
// intencional e não deve derrubar o registro do convite.
async function createIdentityWithPassword(email: string, password: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Falha ao criar identidade de teste: ${error?.message}`);
  return data.user.id;
}

describe("permissoes.service — convite via Supabase Auth", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("fluxo completo: convite + identidade pré-existente, aceite cria User com authUserId e membership", async () => {
    const { tenantA } = fixtures;

    const identityId = await createIdentityWithPassword("novo-colega@teste.local", "senha-nova-123");

    const invite = await runWithTenant(tenantA.companyId, () =>
      createInvite(tenantA.companyId, tenantA.adminUser, {
        name: "Novo Colega",
        email: "novo-colega@teste.local",
      }),
    );
    expect(invite.status).toBe("PENDENTE");

    const accepted = await acceptInvite(invite.token, identityId);
    expect(accepted.role).toBe("OPERACIONAL");

    const user = await prismaTest.user.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(user.authUserId).toBe(identityId);
    expect(user.companyId).toBe(tenantA.companyId);

    // A membership gravada em app_metadata precisa bater com o User criado,
    // senão o login não encontraria a empresa certa.
    const { data: updated } = await supabaseAdmin.auth.admin.getUserById(identityId);
    const memberships = (updated.user!.app_metadata as { memberships?: unknown[] }).memberships;
    expect(memberships).toEqual([{ userId: accepted.id, companyId: tenantA.companyId, role: "OPERACIONAL" }]);

    // E o login de ponta a ponta com a senha definida deve funcionar.
    const loginResult = await login({ email: "novo-colega@teste.local", password: "senha-nova-123" });
    expect(loginResult.status).toBe("OK");
    if (loginResult.status !== "OK") throw new Error("esperado OK");
    expect(loginResult.user.companyId).toBe(tenantA.companyId);
  });

  it("aceitar o mesmo convite duas vezes falha na segunda tentativa", async () => {
    const { tenantA } = fixtures;
    const identityId = await createIdentityWithPassword("novo-colega-2@teste.local", "senha-123");

    const invite = await runWithTenant(tenantA.companyId, () =>
      createInvite(tenantA.companyId, tenantA.adminUser, {
        name: "Novo Colega",
        email: "novo-colega-2@teste.local",
      }),
    );

    await acceptInvite(invite.token, identityId);
    await expect(acceptInvite(invite.token, identityId)).rejects.toThrow(NotFoundError);
  });

  it("identidade que já pertence a outra empresa ganha uma segunda membership ao aceitar novo convite", async () => {
    const { tenantA, tenantB } = fixtures;

    // Identidade já existente com uma membership em B (simula consultor com
    // acesso a mais de uma empresa).
    const identityId = await linkSupabaseIdentity("multi@teste.local", "senha-123", [
      { userId: tenantB.operationalUser.id, companyId: tenantB.companyId, role: "OPERACIONAL" },
    ]);

    const invite = await runWithTenant(tenantA.companyId, () =>
      createInvite(tenantA.companyId, tenantA.adminUser, {
        name: "Consultor",
        email: "multi@teste.local",
      }),
    );

    const accepted = await acceptInvite(invite.token, identityId);

    const { data: updated } = await supabaseAdmin.auth.admin.getUserById(identityId);
    const memberships = (updated.user!.app_metadata as { memberships?: { companyId: string }[] }).memberships ?? [];
    expect(memberships.map((m) => m.companyId).sort()).toEqual([tenantA.companyId, tenantB.companyId].sort());
    expect(accepted.role).toBe("OPERACIONAL");
  });
});

describe("permissoes.service — troca de senha via Supabase Auth", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("changeMyPassword exige a senha atual correta antes de trocar", async () => {
    const { tenantA } = fixtures;
    await linkSupabaseIdentity("admin-a@teste.local", "senha-antiga-123", [
      { userId: tenantA.adminUser.id, companyId: tenantA.companyId, role: "ADMINISTRADOR" },
    ]);

    await expect(
      changeMyPassword(tenantA.companyId, tenantA.adminUser, "senha-errada", "senha-nova-999"),
    ).rejects.toThrow(UnauthorizedError);

    await changeMyPassword(tenantA.companyId, tenantA.adminUser, "senha-antiga-123", "senha-nova-999");
    const result = await login({ email: "admin-a@teste.local", password: "senha-nova-999" });
    expect(result.status).toBe("OK");
  });
});
