import "dotenv/config";
import bcrypt from "bcryptjs";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";

const SEED_COMPANY_ID = "seed-company";
const SEED_CARGO_ID = "seed-cargo-admin";
const SEED_ADMIN_EMAIL = "admin@demo.com";
const SEED_ADMIN_PASSWORD = "admin123";

async function main() {
  const company = await prisma.company.upsert({
    where: { id: SEED_COMPANY_ID },
    update: {},
    create: {
      id: SEED_COMPANY_ID,
      name: "Empresa Demo",
    },
  });

  await prisma.cargo.upsert({
    where: { id: SEED_CARGO_ID },
    update: {},
    create: {
      id: SEED_CARGO_ID,
      companyId: company.id,
      name: "Administrador",
      defaultFixedSalary: 0,
      permissionLevel: "ADMINISTRADOR",
    },
  });

  const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);

  await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: SEED_ADMIN_EMAIL } },
    update: { passwordHash },
    create: {
      companyId: company.id,
      email: SEED_ADMIN_EMAIL,
      passwordHash,
      role: "ADMINISTRADOR",
    },
  });

  console.log(`Seed concluído: ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
