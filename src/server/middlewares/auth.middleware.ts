import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

interface JwtPayload {
  userId: string;
  companyId: string;
  role: string;
  // Ausente no token de tenant (o payload nasceu sem esse campo). Os
  // outros escopos — "identity" e "platform" — sempre o preenchem, e é por
  // ele que eles são rejeitados aqui.
  scope?: string;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ message: "Token não informado" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;

    // Os três escopos do sistema são assinados com o MESMO segredo, então
    // a verificação de assinatura sozinha aceita qualquer um deles aqui.
    // Sem esta checagem, um token de identidade (de alguém que pode não ter
    // empresa nenhuma) passava e req.user.companyId virava undefined —
    // consultas que não filtram estritamente por companyId então devolviam
    // dados de outras empresas. Fail-closed: só o token SEM scope, que é o
    // de tenant, entra.
    if (payload.scope !== undefined) {
      res.status(401).json({ message: "Token inválido para esta operação" });
      return;
    }

    // companyId ausente/vazio nunca pode seguir: ele alimenta o
    // tenantMiddleware e o GUC app.company_id das políticas de RLS.
    if (!payload.companyId || !payload.userId) {
      res.status(401).json({ message: "Token inválido para esta operação" });
      return;
    }

    req.user = { id: payload.userId, companyId: payload.companyId, role: payload.role };
    next();
  } catch {
    res.status(401).json({ message: "Token inválido ou expirado" });
  }
}
