import { createClient } from "@supabase/supabase-js";

// Chave anon/publishable — segura para expor no navegador por design.
// Usado só no fluxo de convite (verificar o link do e-mail e definir
// senha); o login do dia a dia continua indo pelo backend (POST
// /auth/login), que emite o token próprio da aplicação.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);
