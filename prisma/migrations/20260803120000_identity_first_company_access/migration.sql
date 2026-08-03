-- Fluxo "identidade primeiro": o usuário cria um login sem empresa e depois
-- entra numa (por convite direto do Admin ou pedindo acesso com o código da
-- empresa). Ver src/server/services/company-access.service.ts.

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- Company.inviteCode é NOT NULL + UNIQUE, mas já existem empresas em
-- produção. Adicionar direto como NOT NULL falharia nas linhas existentes,
-- então: cria nullable -> preenche cada linha com um código único ->
-- só então aplica NOT NULL e a unique.
ALTER TABLE "companies" ADD COLUMN "inviteCode" TEXT;

-- Mesmo alfabeto de gerarInviteCode() no backend (invite-code.util.ts):
-- sem O/0/I/1 para não confundir na hora de ditar ou digitar o código.
-- gen_random_uuid() vem do pgcrypto, já disponível no Postgres 13+ do
-- Supabase. O loop garante unicidade mesmo em colisão (improvável, mas o
-- índice unique abaixo não perdoaria).
DO $$
DECLARE
  alfabeto CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  empresa RECORD;
  codigo TEXT;
  i INT;
BEGIN
  FOR empresa IN SELECT "id" FROM "companies" WHERE "inviteCode" IS NULL LOOP
    LOOP
      codigo := '';
      FOR i IN 1..10 LOOP
        codigo := codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::INT, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "companies" WHERE "inviteCode" = codigo);
    END LOOP;
    UPDATE "companies" SET "inviteCode" = codigo WHERE "id" = empresa."id";
  END LOOP;
END $$;

ALTER TABLE "companies" ALTER COLUMN "inviteCode" SET NOT NULL;
CREATE UNIQUE INDEX "companies_inviteCode_key" ON "companies"("inviteCode");

-- Data de saída da empresa. Null = vínculo ativo. Todas as linhas
-- existentes são de gente ativa hoje, então o default null já está certo.
ALTER TABLE "users" ADD COLUMN "leftAt" TIMESTAMP(3);

-- Identidade de quem pediu a criação da empresa. Nullable de propósito:
-- os pedidos já existentes vieram da tela de login, de gente sem conta, e
-- continuam sendo atendidos pelo fluxo antigo (convite por e-mail).
ALTER TABLE "company_signup_requests" ADD COLUMN "requesterAuthUserId" TEXT;

-- CreateTable
CREATE TABLE "company_access_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDENTE',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_access_requests_companyId_status_idx" ON "company_access_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "company_access_requests_authUserId_idx" ON "company_access_requests"("authUserId");

-- AddForeignKey
ALTER TABLE "company_access_requests" ADD CONSTRAINT "company_access_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios e RLS para o role restrito do backend (app_backend, criado
-- em 20260731160000_tenant_write_rls). Envolto em IF EXISTS porque nem
-- todo ambiente tem essa infraestrutura: o banco de desenvolvimento local
-- parou antes daquela migration, e sem a guarda esta migration falharia
-- ali com "role app_backend does not exist", deixando o schema pela
-- metade. Em produção (onde o role existe) o bloco roda por inteiro.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    -- Sem este GRANT todo INSERT/SELECT falharia com "permission denied":
    -- o ALTER DEFAULT PRIVILEGES daquela migration só alcança tabelas
    -- criadas pelo mesmo usuário que o executou, então uma tabela nova
    -- não herda privilégio de forma garantida.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "company_access_requests" TO app_backend;

    ALTER TABLE "company_access_requests" ENABLE ROW LEVEL SECURITY;

    -- DELIBERADAMENTE DIFERENTE da política tenant_write das demais
    -- tabelas. O padrão compara "companyId" = app.current_company_id() e é
    -- fail-closed quando o GUC não está setado — aqui isso bloquearia o
    -- caso de uso central: quem INSERE a linha é o SOLICITANTE, que por
    -- definição ainda NÃO pertence ao tenant e roda fora de withTenant,
    -- sem GUC nenhum. Com a política padrão, pedir acesso seria impossível.
    --
    -- Modelo de acesso desta tabela:
    --   INSERT (solicitante, sem tenant) — liberado; o WITH CHECK exige que
    --     a empresa referenciada exista de fato, então não dá para gravar
    --     pedido apontando para companyId inventado.
    --   SELECT/UPDATE (Admin revisando, dentro de withTenant) — a cláusula
    --     do GUC restringe à própria empresa.
    -- O isolamento entre empresas aqui é garantido no serviço
    -- (company-access.service.ts), que filtra por companyId explicitamente.
    CREATE POLICY access_request_write ON "company_access_requests" FOR ALL TO app_backend
      USING (
        app.current_company_id() IS NULL
        OR "companyId" = app.current_company_id()
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = "companyId")
      );
  END IF;
END $$;
