import { Prisma, PrismaClient } from "@prisma/client";
import { tenantContext } from "./tenant-context";
import { env } from "./env";

// Conexão privilegiada — usada por TODAS as leituras (findMany/findFirst/
// count/...) e pelos checks de "check-then-act" antes de uma escrita
// (ex.: cargos.service.ts:44). RLS de escrita (Fase 4) só se aplica ao
// role app_backend; este client nunca passa por ele, então o isolamento
// de leitura continua sendo só o filtro companyId manual, como antes da
// Fase 4 — decisão deliberada do plano para não arriscar exaustão de pool
// convertendo leituras em transações.
export const prisma = new PrismaClient();

// Conexão restrita (role app_backend, sem BYPASSRLS) — usada SÓ dentro de
// withTenant/writeWithTenant. Nunca importar prismaWrite diretamente fora
// deste arquivo.
const prismaWrite = new PrismaClient({
  datasources: { db: { url: env.databaseUrlRestricted } },
});

// Só é seguro chamar dentro de uma request autenticada (tenantMiddleware já
// rodou) — usado pelos scripts fora do ciclo HTTP (seed, backfill), que
// conectam como o usuário privilegiado e nunca passam pelas políticas de
// tenant, então não precisam (e não devem) chamar withTenant.
const COMPANY_ID_PATTERN = /^[a-z0-9]{20,32}$/;

// Envolve $transaction (na conexão restrita) e injeta o companyId como
// primeira instrução, via set_config — a forma parametrizada (aceita
// bind, diferente de SET LOCAL) evita interpolar string na query. As
// políticas RLS de escrita (Fase 4, migration tenant_write_rls) leem esse
// GUC via app.current_company_id(); sem ele, todo INSERT/UPDATE/DELETE
// afeta zero linhas — fail-closed por padrão.
//
// Substitui prisma.$transaction(...) em toda escrita multi-tabela;
// leituras continuam usando o singleton `prisma` privilegiado diretamente.
//
// explicitCompanyId é só para as ~2 rotas públicas do fluxo de convite
// (acceptInvite), que escrevem no tenant do Invite antes do requisitante
// ter um token de app — nesses casos não existe tenantContext (o
// tenantMiddleware só roda atrás de authMiddleware). Em todo o resto do
// backend, omitir o parâmetro e deixar vir do middleware é o correto.
export function withTenant<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number; explicitCompanyId?: string },
): Promise<T> {
  const companyId = options?.explicitCompanyId ?? tenantContext.getStore()?.companyId;
  if (!companyId) {
    throw new Error("withTenant chamado sem tenantContext e sem explicitCompanyId.");
  }
  if (!COMPANY_ID_PATTERN.test(companyId)) {
    throw new Error("companyId em formato inesperado — recusando abrir transação de escrita.");
  }

  return prismaWrite.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    return fn(tx);
  }, options);
}

// Mesmo mecanismo de withTenant, para uma única operação de escrita
// (create/update/delete/upsert/createMany/...) fora de $transaction — sem
// isso, o INSERT/UPDATE roda no role app_backend sem o GUC de tenant e a
// política RLS nega com "new row violates row-level security policy"
// (Postgres não propaga set_config(..., true) fora de uma transação
// explícita; daí abrir uma aqui mesmo para uma query só).
//
// Uso: em vez de `prisma.cargo.update(...)`, `writeWithTenant((tx) =>
// tx.cargo.update(...))`.
export function writeWithTenant<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withTenant(fn);
}
