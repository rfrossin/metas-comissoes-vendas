import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { env } from "./env";

// Client com service_role — bypassa RLS e tem acesso à Admin API
// (auth.admin.*). Nunca importar este módulo em código que roda no
// navegador; existe só para uso do servidor Express.
//
// O construtor do SupabaseClient sempre instancia um RealtimeClient (mesmo
// sem uso de Realtime aqui), que exige WebSocket nativo — indisponível no
// Node 20 desta máquina (só a partir do Node 22). O pacote `ws` supre isso.
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: WebSocket as never,
  },
});

// Client com a chave pública (anon), usado só para validar e-mail/senha via
// signInWithPassword — a Admin API não verifica senha, só a GoTrueClient
// "normal" faz. Sem persistência de sessão: o backend não mantém sessão
// Supabase entre requests, cada login é uma chamada isolada.
export const supabaseAuth = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: WebSocket as never,
  },
});
