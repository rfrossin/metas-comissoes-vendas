-- Fase 4 do plano de migração Supabase: RLS real nas ESCRITAS.
--
-- A Fase 2 já ligou FORCE ROW LEVEL SECURITY nas 30 tabelas, mas sem
-- nenhuma política — o backend, conectado como usuário privilegiado
-- (postgres/service_role), ignora RLS por ser owner das tabelas. Esta
-- migration cria um segundo role, SEM esse privilégio, para as escritas do
-- backend passarem a depender do banco (não só do companyId manual em
-- cada query) para não vazar dado entre empresas.
--
-- Escopo deliberado: só ESCRITAS (insert/update/delete). Leituras seguem
-- via role privilegiado, protegidas pelo filtro companyId manual como
-- hoje. Estender às leituras exigiria refatorar scope.util.ts (22
-- consultas no cliente Prisma global, chamado dentro e fora de
-- transações) para receber o contexto de transação, e faria toda leitura
-- virar transação interativa — risco real de exaustão do pool no free
-- tier durante imports em massa (bulk-import.service.ts,
-- resultados-bulk-import.service.ts), que já usam timeout de 30s.
--
-- Nota: as colunas Prisma são camelCase sem @map (ex.: "companyId"), não
-- snake_case — todas as referências abaixo usam aspas duplas por isso.

-- ============================================================
-- 1. Role restrito para o backend
-- ============================================================
-- LOGIN mas sem BYPASSRLS, sem SUPERUSER, sem privilégio de DDL — migrations
-- continuam rodando com o usuário atual (postgres), via DIRECT_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    CREATE ROLE app_backend LOGIN PASSWORD '__APP_BACKEND_PASSWORD__';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_backend;

-- ============================================================
-- 2. Função de contexto de tenant
-- ============================================================
-- Schema próprio para não poluir "public" (schema exposto pela Data API)
-- com uma função interna de infraestrutura.
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO app_backend;

-- current_setting(..., true) com segundo argumento true não lança erro
-- quando o GUC não foi setado — retorna NULL. Uma política comparando
-- "companyId" = app.current_company_id() com NULL nunca casa (NULL = x é
-- sempre NULL, tratado como falso), então a ausência de contexto nega por
-- padrão (fail-closed), nunca abre.
CREATE OR REPLACE FUNCTION app.current_company_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')
$$;

GRANT EXECUTE ON FUNCTION app.current_company_id() TO app_backend;

-- ============================================================
-- 3. Políticas de escrita — uma por tabela com companyId (28 no total)
-- ============================================================
-- FOR ALL cobre INSERT/UPDATE/DELETE (e SELECT, mas leituras continuam
-- pelo role privilegiado — esta política nunca é avaliada nesse caminho).
-- WITH CHECK é o que impede um INSERT/UPDATE gravar companyId de outra
-- empresa; sem ele um payload malicioso passaria pela política de leitura
-- e ainda assim escreveria a linha errada.

CREATE POLICY tenant_write ON "users" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "user_scope_assignments" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "invites" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "channels" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "departments" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "teams" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "members" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "node_responsibles" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "cargos" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "result_types" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "result_entries" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "operational_adjustments" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "import_mappings" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "commercial_periods" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "seasonality_bases" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "seasonality_weights" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "goal_campaigns" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "goal_triggers" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "goal_lines" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "goal_line_group_sources" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "goal_daily_values" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "receivables_bases" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "receivables_value_tiers" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "receivables_beneficiaries" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "receivables_conditional_triggers" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "receivables_tier_rules" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "member_closings" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "snapshot_periodo_financeiro" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

CREATE POLICY tenant_write ON "closure_audit_logs" FOR ALL TO app_backend
  USING ("companyId" = app.current_company_id())
  WITH CHECK ("companyId" = app.current_company_id());

-- companies não tem "companyId" (é a própria raiz do tenant) — a política
-- usa id diretamente. app_backend só escreve nela via updateCompany
-- (permissoes.service.ts), nunca cria/deleta empresas (isso é operação de
-- plataforma, fora do escopo desta migração).
CREATE POLICY tenant_write ON "companies" FOR ALL TO app_backend
  USING (id = app.current_company_id())
  WITH CHECK (id = app.current_company_id());

-- platform_users é a única tabela de negócio sem qualquer relação com
-- tenant — app_backend nunca deve tocar nela (é escopo de
-- Super Admin/Suporte da plataforma, não implementado ainda). Sem
-- política = nega tudo para este role, correto por padrão.
