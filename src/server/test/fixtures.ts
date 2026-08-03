import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { RequestingUser } from "../services/scope.util";
import { supabaseAdmin } from "../config/supabase";
import type { Membership } from "../services/auth.service";
import { tenantContext } from "../config/tenant-context";
import { generateInviteCode } from "../utils/invite-code.util";

// DIRECT_URL explicitamente: sempre a conexão privilegiada (mesma usada
// por Prisma Migrate), independente do que DATABASE_URL/DATABASE_URL_RESTRICTED
// apontarem — os fixtures precisam criar dados de teste livremente, sem
// depender de GUC de tenant nenhum.
export const prismaTest = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

// Fora de uma request Express real, tenantMiddleware nunca roda — funções
// de serviço que chamam withTenant (prisma.ts) precisam desse contexto
// simulado para exercitar o caminho de escrita real em teste, incluindo o
// SET_CONFIG que as políticas RLS de escrita (Fase 4) leem.
export function runWithTenant<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ companyId }, fn);
}

// Duas empresas completas e independentes (A e B), cada uma com uma
// estrutura Canal→Departamento→Time→Membro de 1 nó e um usuário por papel.
// Testes de vazamento entre tenants operam sempre com "A tenta acessar
// recurso de B" usando os ids retornados aqui.
export interface TenantFixture {
  companyId: string;
  channelId: string;
  departmentId: string;
  teamId: string;
  memberId: string;
  adminUser: RequestingUser;
  managerUser: RequestingUser;
  operationalUser: RequestingUser;
}

async function buildTenant(label: "A" | "B"): Promise<TenantFixture> {
  const company = await prismaTest.company.create({
    data: { name: `Empresa Teste ${label}`, inviteCode: generateInviteCode() },
  });

  const channel = await prismaTest.channel.create({
    data: { companyId: company.id, name: `Canal ${label}` },
  });

  const department = await prismaTest.department.create({
    data: { companyId: company.id, channelId: channel.id, name: `Depto ${label}` },
  });

  const team = await prismaTest.team.create({
    data: { companyId: company.id, departmentId: department.id, name: `Time ${label}` },
  });

  const cargo = await prismaTest.cargo.create({
    data: {
      companyId: company.id,
      name: `Cargo ${label}`,
      defaultFixedSalary: 0,
      permissionLevel: "OPERACIONAL",
    },
  });

  const member = await prismaTest.member.create({
    data: {
      companyId: company.id,
      teamId: team.id,
      cargoId: cargo.id,
      fullName: `Membro ${label}`,
      memberType: "OPERADOR",
      status: "ATIVO",
    },
  });

  const passwordHash = await bcrypt.hash("test1234", 4);

  const admin = await prismaTest.user.create({
    data: {
      companyId: company.id,
      email: `admin-${label.toLowerCase()}@teste.local`,
      passwordHash,
      role: "ADMINISTRADOR",
    },
  });

  const manager = await prismaTest.user.create({
    data: {
      companyId: company.id,
      email: `gestor-${label.toLowerCase()}@teste.local`,
      passwordHash,
      role: "LIDERANCA_NO",
    },
  });

  const operational = await prismaTest.user.create({
    data: {
      companyId: company.id,
      email: `usuario-${label.toLowerCase()}@teste.local`,
      passwordHash,
      role: "OPERACIONAL",
      memberId: member.id,
    },
  });

  return {
    companyId: company.id,
    channelId: channel.id,
    departmentId: department.id,
    teamId: team.id,
    memberId: member.id,
    adminUser: { id: admin.id, companyId: company.id, role: admin.role },
    managerUser: { id: manager.id, companyId: company.id, role: manager.role },
    operationalUser: { id: operational.id, companyId: company.id, role: operational.role },
  };
}

export interface TwoTenantFixtures {
  tenantA: TenantFixture;
  tenantB: TenantFixture;
}

export async function seedTwoTenants(): Promise<TwoTenantFixtures> {
  const tenantA = await buildTenant("A");
  const tenantB = await buildTenant("B");
  return { tenantA, tenantB };
}

// Cria uma identidade real no Supabase Auth local e vincula via authUserId
// ao User já existente (criado por seedTwoTenants/buildTenant), gravando o
// app_metadata.memberships no formato que auth.service.ts espera. Só usado
// pelos testes de login — os demais testes de integração seguem
// trabalhando direto com RequestingUser, sem precisar de identidade real.
export async function linkSupabaseIdentity(
  email: string,
  password: string,
  memberships: Membership[],
): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { memberships },
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar identidade Supabase de teste: ${error?.message}`);
  }

  await prismaTest.user.updateMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
    data: { authUserId: data.user.id },
  });

  return data.user.id;
}

// Remove tudo que os testes possam ter criado, na ordem que respeita FKs.
// Chamado em beforeEach/afterEach de cada suíte de integração — o schema é
// compartilhado entre arquivos (fileParallelism: false), então cada teste
// precisa começar de um estado limpo.
export async function resetDatabase(): Promise<void> {
  const tableNames = await prismaTest.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  const tables = tableNames
    .map((t) => `"${t.tablename}"`)
    .filter((t) => t !== '"_prisma_migrations"');

  if (tables.length > 0) {
    await prismaTest.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(", ")} CASCADE`);
  }

  await resetSupabaseAuthUsers();
}

// TRUNCATE não alcança auth.users (schema gerenciado pelo GoTrue, fora do
// public) — sem isto, identidades de um teste de login vazariam para o
// próximo e quebrariam a suposição de estado limpo.
async function resetSupabaseAuthUsers(): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return;
  await Promise.all(data.users.map((u) => supabaseAdmin.auth.admin.deleteUser(u.id)));
}
