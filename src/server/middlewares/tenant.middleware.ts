import type { Request, Response, NextFunction } from "express";
import { tenantContext } from "../config/tenant-context";

// Roda depois de authMiddleware (que já validou o token e populou
// req.user). Popula o AsyncLocalStorage com a empresa da requisição atual
// — é esse valor que withTenant (prisma.ts) grava no GUC app.company_id
// dentro da transação, para as políticas de RLS de escrita (Fase 4)
// filtrarem por tenant.
export function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next();
    return;
  }

  tenantContext.run({ companyId: req.user.companyId }, next);
}
