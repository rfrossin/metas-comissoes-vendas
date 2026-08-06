import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";
import { supabaseAdmin } from "../src/server/config/supabase";
import type { Membership } from "../src/server/services/auth.service";

// Backfill único da Fase 3 do plano de migração Supabase: cria uma
// identidade em auth.users para cada User ainda sem authUserId, e grava
// app_metadata.memberships com todas as linhas de User daquela mesma
// identidade (múltiplas empresas, se houver e-mails repetidos entre
// tenants).
//
// Não importa o passwordHash bcrypt existente — a API de importar hash
// (password_hash em createUser) é indocumentada e tem bug reportado. Em vez
// disso, cada usuário migrado recebe uma senha aleatória descartável e
// precisa clicar em "esqueci minha senha" no primeiro login pós-migração.
// Isso é aceitável porque o backfill roda uma vez, fora de horário de pico,
// com aviso prévio aos usuários (fora do escopo deste script).
//
// Idempotente: só processa User.authUserId === null. Uma identidade já
// criada nesta run para um e-mail é reaproveitada para as demais linhas do
// mesmo e-mail (evita criar duas identidades Supabase para o mesmo e-mail
// quando ele aparece em mais de uma empresa).

interface AppMetadataShape {
  memberships?: Membership[];
}

function randomDiscardablePassword(): string {
  // Só precisa satisfazer o mínimo de 8 caracteres do Supabase — nunca é
  // usada de verdade, o usuário sempre passa por "esqueci minha senha".
  return `migracao-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

async function findOrCreateIdentity(email: string, identityCache: Map<string, string>): Promise<string> {
  const cached = identityCache.get(email);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: randomDiscardablePassword(),
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar identidade Supabase para ${email}: ${error?.message}`);
  }

  identityCache.set(email, data.user.id);
  return data.user.id;
}

async function main() {
  const pending = await prisma.user.findMany({
    where: { authUserId: null },
    select: { id: true, email: true, companyId: true, role: true },
    orderBy: { email: "asc" },
  });

  console.log(`${pending.length} usuário(s) pendente(s) de migração para Supabase Auth`);

  const identityCache = new Map<string, string>();
  const membershipsByIdentity = new Map<string, Membership[]>();
  let created = 0;

  for (const user of pending) {
    const authUserId = await findOrCreateIdentity(user.email, identityCache);

    await prisma.user.update({ where: { id: user.id }, data: { authUserId } });

    const memberships = membershipsByIdentity.get(authUserId) ?? [];
    memberships.push({ userId: user.id, companyId: user.companyId, role: user.role });
    membershipsByIdentity.set(authUserId, memberships);

    created++;
    console.log(`  ${user.email} (${user.companyId}) → authUserId=${authUserId}`);
  }

  for (const [authUserId, memberships] of membershipsByIdentity) {
    const { data, error: getError } = await supabaseAdmin.auth.admin.getUserById(authUserId);
    if (getError || !data.user) {
      throw new Error(`Falha ao ler identidade recém-criada ${authUserId}: ${getError?.message}`);
    }

    const existing = (data.user.app_metadata as AppMetadataShape).memberships ?? [];
    const merged = [...existing.filter((m) => !memberships.some((n) => n.companyId === m.companyId)), ...memberships];

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      app_metadata: { memberships: merged },
    });
    if (updateError) {
      throw new Error(`Falha ao gravar app_metadata de ${authUserId}: ${updateError.message}`);
    }
  }

  console.log(`Backfill concluído: ${created} vínculo(s) de User, ${membershipsByIdentity.size} identidade(s) Supabase.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
