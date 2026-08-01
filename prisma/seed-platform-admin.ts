import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";
import { supabaseAdmin } from "../src/server/config/supabase";

// Cria (ou reaproveita) o PlatformUser SUPER_ADMIN utilizável para login em
// /admin-plataforma — mesmo padrão de seed-supabase-admin.ts: a identidade
// nasce no Supabase Auth (createUser), não em passwordHash local.
const ADMIN_NAME = "Rossin";
const ADMIN_EMAIL = "rossin@rossinvendas.com";
const ADMIN_PASSWORD = process.argv[2];

if (!ADMIN_PASSWORD) {
  console.error("Uso: tsx prisma/seed-platform-admin.ts <senha>");
  process.exit(1);
}

// createUser falha com "already been registered" se a identidade já existir
// no Supabase (ex.: mesmo e-mail já usado como User de alguma Company de
// teste) — a Admin API não tem um "getUserByEmail" direto, então é preciso
// paginar listUsers e filtrar localmente antes de decidir criar vs. reusar.
async function findAuthUserByEmail(email: string): Promise<string | null> {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Falha ao listar usuários Supabase: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function main() {
  let platformUser = await prisma.platformUser.findUnique({ where: { email: ADMIN_EMAIL } });

  let authUserId: string;
  if (platformUser?.authUserId) {
    authUserId = platformUser.authUserId;
    await supabaseAdmin.auth.admin.updateUserById(authUserId, { password: ADMIN_PASSWORD });
  } else {
    const existingAuthUserId = await findAuthUserByEmail(ADMIN_EMAIL);
    if (existingAuthUserId) {
      // Identidade já existe (ex.: era User de uma Company de teste) —
      // reaproveita, só garantindo a senha conhecida.
      authUserId = existingAuthUserId;
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
  }

  if (!platformUser) {
    platformUser = await prisma.platformUser.create({
      data: {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        passwordHash: "",
        authUserId,
        role: "SUPER_ADMIN",
      },
    });
  } else if (!platformUser.authUserId) {
    platformUser = await prisma.platformUser.update({ where: { id: platformUser.id }, data: { authUserId } });
  }

  console.log("Pronto para login em /admin-plataforma:");
  console.log(`  E-mail: ${platformUser.email}`);
  console.log(`  Role:   ${platformUser.role}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
