import type { Request, Response, NextFunction } from "express";

export function errorMiddleware(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  res.status(500).json({ message: "Erro interno do servidor" });
}
