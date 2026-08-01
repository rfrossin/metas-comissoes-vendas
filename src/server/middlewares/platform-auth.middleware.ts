import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { PlatformTokenPayload } from "../services/platform-auth.service";

declare global {
  namespace Express {
    interface Request {
      platformUser?: { id: string; role: "SUPER_ADMIN" | "SUPORTE" };
    }
  }
}

// Separado de authMiddleware (tenant) de propósito: um token de tenant
// nunca deve autorizar rotas de plataforma, e vice-versa — o campo `scope`
// no payload é o que impede a confusão entre os dois JWTs.
export function platformAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ message: "Token não informado" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as PlatformTokenPayload;
    if (payload.scope !== "platform") {
      throw new Error("scope inválido");
    }
    req.platformUser = { id: payload.platformUserId, role: payload.role };
    next();
  } catch {
    res.status(401).json({ message: "Token inválido ou expirado" });
  }
}
