import type { Request } from "express";
import type { FileFilterCallback } from "multer";
import { ConflictError } from "./http-errors";

// Aceita só os mimetypes de planilha esperados pelos fluxos de bulk-import
// (Resultados e Estrutura Organizacional) — rejeita qualquer outro tipo
// antes de chegar ao parser xlsx. Camada adicional, não a única defesa: o
// mimetype é declarado pelo cliente e pode ser falsificado, mas filtra o
// caso comum (upload acidental ou malicioso de um tipo de arquivo errado).
// ConflictError (não Error genérico) para o errorMiddleware devolver 409
// com mensagem clara, em vez de 500 — o multer chama next(err) antes do
// handler da rota rodar, fora do try/catch de qualquer controller.
const ALLOWED_MIMETYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
  "application/csv",
]);

export function spreadsheetFileFilter(_req: Request, file: Express.Multer.File, callback: FileFilterCallback): void {
  if (ALLOWED_MIMETYPES.has(file.mimetype)) {
    callback(null, true);
    return;
  }
  callback(new ConflictError("Arquivo inválido — envie uma planilha .xlsx, .xls ou .csv."));
}
