import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { IdentityTokenPayload } from "../services/identity.service";

declare global {
  namespace Express {
    interface Request {
      identity?: { authUserId: string; email: string };
    }
  }
}

// Separado de authMiddleware (tenant) e de platformAuthMiddleware pela
// mesma razão que aqueles são separados entre si: o campo `scope` no
// payload impede que um token sirva para um caminho que não é o seu.
//
// Crucial aqui: um token de identidade NÃO abre rotas de tenant. Ele
// pertence a alguém que pode não ter empresa nenhuma, então jamais deve
// alcançar o tenantMiddleware nem, por consequência, o GUC de RLS.
export function identityAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ message: "Token não informado" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as IdentityTokenPayload;
    if (payload.scope !== "identity") {
      throw new Error("scope inválido");
    }
    req.identity = { authUserId: payload.authUserId, email: payload.email };
    next();
  } catch {
    res.status(401).json({ message: "Token inválido ou expirado" });
  }
}
