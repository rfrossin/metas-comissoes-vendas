import { config } from "dotenv";
import path from "path";

// Testes de integração rodam contra o Postgres local do Supabase
// (supabase start), nunca contra o banco apontado em .env — por isso
// carregam um arquivo dedicado em vez de depender de dotenv/config.
config({ path: path.resolve(__dirname, "../../../.env.test") });
