import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  JWT_SECRET: z.string().min(1, "JWT_SECRET não pode ser vazio"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL não pode ser vazio"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL não pode ser vazio"),
  // Role restrito (app_backend, sem BYPASSRLS) — usado só dentro de
  // withTenant/writeWithTenant (src/server/config/prisma.ts). DATABASE_URL
  // continua privilegiada, para leituras e o padrão check-then-act.
  DATABASE_URL_RESTRICTED: z.string().min(1, "DATABASE_URL_RESTRICTED não pode ser vazio"),
  SUPABASE_URL: z.string().min(1, "SUPABASE_URL não pode ser vazio"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY não pode ser vazio"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY não pode ser vazio"),
  // URL pública do front-end (Vite em dev, domínio real em produção) — usada
  // para montar os links de convite/aprovação enviados por e-mail.
  FRONTEND_URL: z.string().min(1).default("http://localhost:5173"),
  // SMTP próprio (Resend ou similar) — o backend envia e-mail diretamente via
  // nodemailer em vez de depender do envio automático do Supabase Auth, que
  // tem rate limit baixo e não é suportado para produção.
  SMTP_HOST: z.string().min(1, "SMTP_HOST não pode ser vazio"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().min(1, "SMTP_USER não pode ser vazio"),
  SMTP_PASSWORD: z.string().min(1, "SMTP_PASSWORD não pode ser vazio"),
  SMTP_FROM: z.string().min(1, "SMTP_FROM não pode ser vazio"),
  // E-mail do Super Admin da plataforma que recebe os pedidos de liberação
  // de nova empresa.
  PLATFORM_ADMIN_EMAIL: z.string().email().default("rossin@rossinvendas.com"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Variáveis de ambiente inválidas: ${parsed.error.message}`);
}

export const env = {
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  directUrl: parsed.data.DIRECT_URL,
  databaseUrlRestricted: parsed.data.DATABASE_URL_RESTRICTED,
  jwtSecret: parsed.data.JWT_SECRET,
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
  frontendUrl: parsed.data.FRONTEND_URL,
  smtpHost: parsed.data.SMTP_HOST,
  smtpPort: parsed.data.SMTP_PORT,
  smtpUser: parsed.data.SMTP_USER,
  smtpPassword: parsed.data.SMTP_PASSWORD,
  smtpFrom: parsed.data.SMTP_FROM,
  platformAdminEmail: parsed.data.PLATFORM_ADMIN_EMAIL,
};
