import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { prismaTest, resetDatabase, runWithTenant, seedTwoTenants, type TwoTenantFixtures } from "../test/fixtures";
import { createNotification, listMyNotifications } from "./notifications.service";
import { env } from "../config/env";

// A tabela notifications é o único ponto da Fase 5 onde a Data API volta
// a ser aberta para authenticated (Fase 2 fechou tudo por padrão). Este
// arquivo cobre dois níveis: o backend (writeWithTenant/prisma, igual às
// demais tabelas) e o isolamento real de RLS authenticated via
// auth.uid() — a garantia de que um usuário só vê a própria notificação
// mesmo com acesso direto à Data API, sem depender de nenhum código do
// backend.
describe("notifications.service — escrita e listagem", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("cria notificação para um usuário e ele consegue listá-la", async () => {
    const { tenantA } = fixtures;
    await prismaTest.user.update({
      where: { id: tenantA.adminUser.id },
      data: { authUserId: "11111111-1111-1111-1111-111111111111" },
    });

    await runWithTenant(tenantA.companyId, () =>
      createNotification(tenantA.companyId, tenantA.adminUser.id, "Gatilho liberado", "Meta X atingiu 100%."),
    );

    const list = await listMyNotifications(tenantA.companyId, tenantA.adminUser);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Gatilho liberado");
  });

  it("teste de vazamento: notificação de um usuário não aparece na listagem de outro", async () => {
    const { tenantA } = fixtures;
    await prismaTest.user.update({
      where: { id: tenantA.adminUser.id },
      data: { authUserId: "22222222-2222-2222-2222-222222222222" },
    });
    await prismaTest.user.update({
      where: { id: tenantA.managerUser.id },
      data: { authUserId: "33333333-3333-3333-3333-333333333333" },
    });

    await runWithTenant(tenantA.companyId, () =>
      createNotification(tenantA.companyId, tenantA.adminUser.id, "Só para o Admin", "..."),
    );

    const managerList = await listMyNotifications(tenantA.companyId, tenantA.managerUser);
    expect(managerList).toHaveLength(0);
  });
});

describe("notifications.service — RLS real (Data API authenticated)", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  it("teste de vazamento REAL de RLS: acesso direto via Data API com sessão de outro usuário não vê a notificação", async () => {
    const { tenantA } = fixtures;

    const admin = await createRealSupabaseUser("admin-notif@teste.local", "senha-123");
    const manager = await createRealSupabaseUser("gestor-notif@teste.local", "senha-123");

    await prismaTest.user.update({ where: { id: tenantA.adminUser.id }, data: { authUserId: admin.id } });
    await prismaTest.user.update({ where: { id: tenantA.managerUser.id }, data: { authUserId: manager.id } });

    await runWithTenant(tenantA.companyId, () =>
      createNotification(tenantA.companyId, tenantA.adminUser.id, "Confidencial do Admin", "..."),
    );

    // Cliente Supabase "de verdade" (anon key), autenticado como o Gestor —
    // exatamente o caminho que o Realtime usa no frontend, sem nenhum
    // código do backend no meio.
    const anonClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket as never },
    });
    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email: "gestor-notif@teste.local",
      password: "senha-123",
    });
    expect(signInError).toBeNull();

    const { data: rows, error: selectError } = await anonClient.from("notifications").select("*");
    expect(selectError).toBeNull();
    expect(rows).toEqual([]);
  });

  it("usuário autenticado via Data API vê a própria notificação", async () => {
    const { tenantA } = fixtures;
    const admin = await createRealSupabaseUser("admin-notif-2@teste.local", "senha-123");
    await prismaTest.user.update({ where: { id: tenantA.adminUser.id }, data: { authUserId: admin.id } });

    await runWithTenant(tenantA.companyId, () =>
      createNotification(tenantA.companyId, tenantA.adminUser.id, "Para mim mesmo", "..."),
    );

    const anonClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket as never },
    });
    await anonClient.auth.signInWithPassword({ email: "admin-notif-2@teste.local", password: "senha-123" });

    const { data: rows } = await anonClient.from("notifications").select("*");
    expect(rows).toHaveLength(1);
    expect(rows![0].title).toBe("Para mim mesmo");
  });
});

async function createRealSupabaseUser(email: string, password: string): Promise<{ id: string }> {
  const { supabaseAdmin } = await import("../config/supabase");
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Falha ao criar usuário Supabase de teste: ${error?.message}`);
  return { id: data.user.id };
}
