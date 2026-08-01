import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

interface JwtPayload {
  userId: string;
  companyId: string;
  role: string;
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
    req.user = { id: payload.userId, companyId: payload.companyId, role: payload.role };
    next();
  } catch {
    res.status(401).json({ message: "Token inválido ou expirado" });
  }
}
