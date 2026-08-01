-- Correção de desenho na migration anterior (20260731150000): authUserId
-- não pode ser globalmente único, porque uma identidade Supabase pode ter
-- N linhas de User — uma por empresa (membership). A unicidade correta é
-- por (authUserId, companyId): a mesma identidade não pode ter duas linhas
-- na mesma empresa, mas pode ter uma por empresa diferente.

-- DropIndex
DROP INDEX "users_authUserId_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_authUserId_companyId_key" ON "users"("authUserId", "companyId");
