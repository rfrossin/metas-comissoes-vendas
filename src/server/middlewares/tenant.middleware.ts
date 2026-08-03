import type { Request, Response, NextFunction } from "express";
import { tenantContext } from "../config/tenant-context";

// Roda depois de authMiddleware (que já validou o token e populou
// req.user). Popula o AsyncLocalStorage com a empresa da requisição atual
// — é esse valor que withTenant (prisma.ts) grava no GUC app.company_id
// dentro da transação, para as políticas de RLS de escrita (Fase 4)
// filtrarem por tenant.
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    next();
    return;
  }

  // Defesa em profundidade: o authMiddleware já barra token sem companyId,
  // mas se algum caminho novo popular req.user sem ele, a requisição PARA
  // aqui em vez de seguir com contexto vazio. O motivo é concreto: no
  // Prisma, `where: { companyId: undefined }` não filtra nada — a condição
  // é descartada e a consulta devolve dados de TODAS as empresas. Um
  // companyId ausente é vazamento entre tenants, não um caso benigno.
  if (!req.user.companyId) {
    res.status(401).json({ message: "Token inválido para esta operação" });
    return;
  }

  tenantContext.run({ companyId: req.user.companyId }, next);
}
