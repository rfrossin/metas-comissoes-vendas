import type { Request, Response } from "express";
import { z } from "zod";
import {
  buildResultsPreview,
  commitResultsImport,
  parseResultsWorkbookRows,
  validateResultRowFields,
  type ParsedResultRow,
} from "../services/resultados-bulk-import.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

export async function resultsBulkImportPreviewHandler(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({ message: "Nenhum arquivo enviado (campo 'file')." });
    return;
  }

  let rows;

  try {
    rows = parseResultsWorkbookRows(req.file.buffer);
  } catch {
    res.status(400).json({ message: "Não foi possível ler o arquivo. Confirme se é um CSV ou Excel válido." });
    return;
  }

  if (rows.length === 0) {
    res.status(400).json({ message: "A planilha não tem nenhuma linha de dados." });
    return;
  }

  const preview = await buildResultsPreview(req.user!.companyId, rows);
  res.json(preview);
}

const commitRowSchema = z.object({
  rowNumber: z.number(),
  memberName: z.string().min(1),
  typeName: z.string().min(1),
  date: z.string(),
  value: z.number(),
  reason: z.string().nullable(),
});

const commitSchema = z.object({ rows: z.array(commitRowSchema).min(1) });

export async function resultsBulkImportCommitHandler(req: Request, res: Response) {
  const parsed = commitSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  // Não confia cegamente no que veio do preview: reconstrói e revalida antes
  // de gravar qualquer coisa.
  const rows: ParsedResultRow[] = parsed.data.rows.map((row) => {
    const date = new Date(`${row.date}T00:00:00.000Z`);
    const fields = {
      memberName: row.memberName,
      typeName: row.typeName,
      date,
      value: row.value,
      reason: row.reason,
    };

    return {
      rowNumber: row.rowNumber,
      errors: validateResultRowFields(fields),
      memberName: row.memberName,
      typeName: row.typeName,
      date,
      value: row.value,
      reason: row.reason,
      kind: row.value < 0 ? "desagio" : "resultado",
    };
  });

  try {
    const result = await commitResultsImport(req.user!.companyId, req.user!, rows);
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
