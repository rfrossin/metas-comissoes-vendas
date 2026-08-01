import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Client privilegiado (mesma conexão usada pelo Prisma Migrate), só para
// scripts standalone fora do ciclo HTTP: seed, backfills. Esses scripts
// não passam por tenantMiddleware/withTenant, então não têm o GUC
// app.company_id setado — se conectassem com o app_backend restrito (Fase
// 4), toda escrita afetaria zero linhas silenciosamente, sem erro.
//
// Nunca importar este módulo do código de request HTTP (src/server/app.ts,
// controllers, services chamados por rota) — só de scripts em prisma/*.ts.
export const prismaAdmin = new PrismaClient({
  datasources: { db: { url: env.directUrl } },
});
