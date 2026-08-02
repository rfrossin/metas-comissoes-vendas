import type { Request, Response, NextFunction } from "express";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../utils/http-errors";

// Rede de segurança para erros que nascem FORA do try/catch de um
// controller (ex.: multer.fileFilter rejeitando um upload — o multer chama
// next(err) antes do handler da rota rodar, então nunca passa pelo
// respondToError local de cada controller). Cada controller continua
// tratando seus próprios erros de negócio primeiro; isso só cobre o que
// escapar.
export function errorMiddleware(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof NotFoundError) {
    res.status(404).json({ message: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ message: err.message });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ message: err.message });
    return;
  }
  if (err instanceof UnauthorizedError) {
    res.status(401).json({ message: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ message: "Erro interno do servidor" });
}
