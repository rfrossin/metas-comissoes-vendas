import type { Request, Response } from "express";
import { z } from "zod";
import {
  buildPreview,
  commitBulkImport,
  parseWorkbookRows,
  validateRowFields,
  type ParsedRow,
} from "../services/bulk-import.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

export async function bulkImportPreviewHandler(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({ message: "Nenhum arquivo enviado (campo 'file')." });
    return;
  }

  let rows;

  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    res.status(400).json({ message: "Não foi possível ler o arquivo. Confirme se é um CSV ou Excel válido." });
    return;
  }

  if (rows.length === 0) {
    res.status(400).json({ message: "A planilha não tem nenhuma linha de dados." });
    return;
  }

  const preview = await buildPreview(req.user!.companyId, rows);
  res.json(preview);
}

const responsibleLevelSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME"]);

const commitRowSchema = z.object({
  rowNumber: z.number(),
  channelName: z.string().nullable(),
  departmentName: z.string().nullable(),
  teamName: z.string().nullable(),
  memberName: z.string(),
  cargoName: z.string(),
  customFixedSalary: z.number().nullable(),
  isResponsible: z.boolean(),
  responsibleLevel: responsibleLevelSchema.nullable(),
});

const commitSchema = z.object({
  rows: z.array(commitRowSchema).min(1),
});

export async function bulkImportCommitHandler(req: Request, res: Response) {
  const parsed = commitSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  // Não confia cegamente no que veio do preview: reaplica as mesmas regras
  // de negócio antes de gravar qualquer coisa.
  const rows: ParsedRow[] = parsed.data.rows.map((row) => ({
    ...row,
    errors: validateRowFields(row),
  }));

  try {
    const result = await commitBulkImport(req.user!.companyId, req.user!, rows);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ message: error.message });
      return;
    }

    if (error instanceof NotFoundError) {
      res.status(404).json({ message: error.message });
      return;
    }

    if (error instanceof ForbiddenError) {
      res.status(403).json({ message: error.message });
      return;
    }

    throw error;
  }
}
