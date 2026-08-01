-- Fase 5 do plano de migração Supabase: Realtime para o sino de
-- notificações. Único ponto onde a Data API volta a ser aberta para
-- anon/authenticated (Fase 2 fechou tudo por padrão) — e de forma
-- estreita: só SELECT, só a própria linha, só nesta tabela.

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- RLS: escrita continua exclusiva do backend (app_backend/postgres, via
-- writeWithTenant como as demais tabelas — Fase 4). O que muda aqui é
-- SELECT para o role "authenticated": cada usuário só vê as próprias
-- notificações, e só através da identidade Supabase real (auth.uid()),
-- nunca por qualquer valor que o cliente possa forjar.
-- ============================================================

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_write ON "notifications" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

-- auth.uid() é uma função nativa do Supabase (schema auth, já existe no
-- projeto) que lê o sub do JWT validado pelo GoTrue — não confundir com
-- app.current_company_id() (Fase 4), que lê um GUC de sessão setado pelo
-- backend. Aqui não há GUC nenhum: quem prova a identidade é o próprio
-- token do Supabase apresentado pelo client-side.
CREATE POLICY select_own ON "notifications" FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);

CREATE POLICY update_own_read_status ON "notifications" FOR UPDATE TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

-- ============================================================
-- Habilita Postgres Changes (Realtime) só para esta tabela — nenhuma
-- outra tabela do projeto expõe mudanças de linha via Realtime.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE "notifications";
