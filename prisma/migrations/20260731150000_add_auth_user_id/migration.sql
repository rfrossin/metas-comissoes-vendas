-- Fase 3 do plano de migração Supabase: liga cada linha de User a uma
-- identidade em auth.users (Supabase Auth). Nullable durante a transição —
-- authUserId só é preenchido pelo script de backfill e pelo novo fluxo de
-- convite/aceite.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "authUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_authUserId_key" ON "users"("authUserId");
