-- Correção da migration anterior (20260731170000): RLS por si só não
-- expõe uma tabela à Data API/Realtime — são dois controles independentes.
-- Sem GRANT explícito, PostgREST/Realtime respondem "permission denied for
-- schema public" antes mesmo de avaliar qualquer política. anon não
-- recebe nada (não há caso de uso deslogado); authenticated recebe só
-- SELECT/UPDATE, nunca INSERT/DELETE — criar/remover notificação continua
-- exclusivo do backend (role app_backend, via writeWithTenant).

-- authenticated não tinha nem USAGE no schema public (a Fase 2 fechou
-- tudo por padrão e nunca precisou reabrir nada até aqui) — sem isso, a
-- Data API/Realtime nega com "permission denied for schema public" antes
-- de sequer chegar na tabela.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON "notifications" TO authenticated;
