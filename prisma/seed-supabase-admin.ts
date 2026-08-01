import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";
import { supabaseAdmin } from "../src/server/config/supabase";

// Cria (ou reaproveita) uma Empresa + Admin real, utilizável para teste
// manual do app apontado para o Supabase — diferente de prisma/seed.ts,
// que ainda grava um passwordHash bcrypt local que deixou de ser a fonte
// de autenticação a partir da Fase 3. Aqui a identidade nasce no Supabase
// Auth (supabaseAdmin.auth.admin.createUser) e o User.passwordHash fica
// vazio (placeholder, mesmo padrão de acceptInvite em permissoes.service.ts).
const COMPANY_NAME = "Empresa Teste Manual";
const CARGO_NAME = "Administrador";
const ADMIN_EMAIL = "admin@rossinvendas.com";
const ADMIN_PASSWORD = "TesteManual123!";

async function main() {
  let company = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (!company) {
    company = await prisma.company.create({ data: { name: COMPANY_NAME } });
  }

  let cargo = await prisma.cargo.findFirst({ where: { companyId: company.id, name: CARGO_NAME } });
  if (!cargo) {
    cargo = await prisma.cargo.create({
      data: {
        companyId: company.id,
        name: CARGO_NAME,
        defaultFixedSalary: 0,
        permissionLevel: "ADMINISTRADOR",
      },
    });
  }

  let existingUser = await prisma.user.findFirst({ where: { companyId: company.id, email: ADMIN_EMAIL } });

  let authUserId: string;
  if (existingUser?.authUserId) {
    authUserId = existingUser.authUserId;
    // Garante que a senha é sempre a conhecida, mesmo em reruns.
    await supabaseAdmin.auth.admin.updateUserById(authUserId, { password: ADMIN_PASSWORD });
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Falha ao criar identidade Supabase: ${error?.message}`);
    }
    authUserId = data.user.id;
  }

  if (!existingUser) {
    existingUser = await prisma.user.create({
      data: {
        companyId: company.id,
        email: ADMIN_EMAIL,
        passwordHash: "",
        authUserId,
        role: "ADMINISTRADOR",
      },
    });
  } else if (!existingUser.authUserId) {
    existingUser = await prisma.user.update({ where: { id: existingUser.id }, data: { authUserId } });
  }

  await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    app_metadata: {
      memberships: [{ userId: existingUser.id, companyId: company.id, role: "ADMINISTRADOR" }],
    },
  });

  console.log("Pronto para login manual:");
  console.log(`  Empresa: ${company.name} (${company.id})`);
  console.log(`  E-mail:  ${ADMIN_EMAIL}`);
  console.log(`  Senha:   ${ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
