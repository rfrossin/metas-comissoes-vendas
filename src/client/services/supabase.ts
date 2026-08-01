import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias no build do frontend — confira as variáveis de ambiente.",
  );
}

// Chave anon/publishable — segura para expor no navegador por design.
// Usado só no fluxo de convite (verificar o link do e-mail e definir
// senha); o login do dia a dia continua indo pelo backend (POST
// /auth/login), que emite o token próprio da aplicação.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
