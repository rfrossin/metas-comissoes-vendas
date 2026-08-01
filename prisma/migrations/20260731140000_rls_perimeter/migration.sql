-- Fase 2 do plano de migração Supabase: fecha o perímetro da Data API
-- pública do Supabase (PostgREST), que por padrão expõe qualquer tabela do
-- schema public para os roles anon/authenticated usando a chave anon.
--
-- O backend Express continua conectando com um usuário privilegiado
-- (postgres) nesta fase — FORCE RLS não afeta o dono da tabela, então o
-- caminho de aplicação atual (companyId manual em cada query) segue
-- funcionando sem nenhuma mudança de comportamento. A Fase 4 do plano é
-- quem cria um role restrito e faz o RLS proteger de fato o caminho de
-- escrita do backend; até lá, esta migration só fecha o acesso via
-- anon/authenticated (Data API / clientes diretos com a chave pública).

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_scope_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_scope_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channels" FORCE ROW LEVEL SECURITY;
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "node_responsibles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "node_responsibles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "cargos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cargos" FORCE ROW LEVEL SECURITY;
ALTER TABLE "result_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_types" FORCE ROW LEVEL SECURITY;
ALTER TABLE "result_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "operational_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operational_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_mappings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "commercial_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "seasonality_bases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seasonality_bases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "seasonality_weights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seasonality_weights" FORCE ROW LEVEL SECURITY;
ALTER TABLE "goal_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_campaigns" FORCE ROW LEVEL SECURITY;
ALTER TABLE "goal_triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_triggers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "goal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "goal_line_group_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_line_group_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "goal_daily_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_daily_values" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receivables_bases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables_bases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receivables_value_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables_value_tiers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receivables_beneficiaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables_beneficiaries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receivables_conditional_triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables_conditional_triggers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receivables_tier_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables_tier_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "member_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_closings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "snapshot_periodo_financeiro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "snapshot_periodo_financeiro" FORCE ROW LEVEL SECURITY;
ALTER TABLE "closure_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "closure_audit_logs" FORCE ROW LEVEL SECURITY;

-- Nenhuma política é criada para anon/authenticated propositalmente: sem
-- nenhuma política permissiva, RLS nega tudo por padrão (fail-closed) para
-- esses dois roles. O backend (postgres/service_role) ignora RLS por ser
-- owner das tabelas, então seu acesso não é afetado.
