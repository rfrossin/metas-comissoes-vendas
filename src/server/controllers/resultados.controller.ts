import type { Request, Response } from "express";
import { z } from "zod";
import {
  bulkDeleteResults,
  bulkUpdateResults,
  createOperationalAdjustment,
  createResultEntry,
  createResultType,
  deleteOperationalAdjustment,
  deleteResultEntry,
  deleteResultType,
  getRealizadoLiquidoSummary,
  listAllResults,
  listOperationalAdjustments,
  listResultEntries,
  listResultTypes,
  updateResultEntry,
  updateResultType,
} from "../services/resultados.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

const resultTypeSchema = z.object({
  name: z.string().min(1),
  unit: z.enum(["MOEDA", "NUMERAL"]),
});

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD");

const resultEntryCreateSchema = z.object({
  memberId: z.string().min(1),
  typeId: z.string().min(1),
  date: isoDate,
  value: z.number(),
});

const resultEntryUpdateSchema = z.object({
  typeId: z.string().min(1),
  date: isoDate,
  value: z.number(),
});

const operationalAdjustmentCreateSchema = z.object({
  memberId: z.string().min(1),
  typeId: z.string().min(1),
  dateReference: isoDate,
  value: z.number(),
  reason: z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
});

const memberIdQuerySchema = z.object({ memberId: z.string().min(1) });

const csvIds = z
  .string()
  .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean))
  .optional();

const listAllResultsQuerySchema = z.object({
  memberId: z.string().min(1).optional(),
  memberIds: csvIds,
  typeId: z.string().min(1).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  kind: z.enum(["resultado", "desagio"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// PASSO 11.1: Resumo (Realizado Líquido) migrou de "Lançamento por Membro"
// (1 Membro fixo) para "Todos os Resultados" — passou a aceitar os mesmos
// filtros de listAllResultsQuerySchema (memberId OU memberIds, typeId,
// período), exceto kind/paginação (não fazem sentido pra um agregado).
const realizadoLiquidoSummaryQuerySchema = z.object({
  memberId: z.string().min(1).optional(),
  memberIds: csvIds,
  typeId: z.string().min(1).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const bulkIdsSchema = z.object({
  entryIds: z.array(z.string()).default([]),
  adjustmentIds: z.array(z.string()).default([]),
});

const bulkUpdateSchema = bulkIdsSchema.extend({
  field: z.enum(["typeId", "date", "reason"]),
  value: z.string().min(1),
});

function respondToError(error: unknown, res: Response) {
  if (error instanceof NotFoundError) {
    res.status(404).json({ message: error.message });
    return;
  }

  if (error instanceof ConflictError) {
    res.status(409).json({ message: error.message });
    return;
  }

  if (error instanceof ForbiddenError) {
    res.status(403).json({ message: error.message });
    return;
  }

  throw error;
}

export async function listResultTypesHandler(req: Request, res: Response) {
  const types = await listResultTypes(req.user!.companyId);
  res.json(types);
}

export async function createResultTypeHandler(req: Request, res: Response) {
  const parsed = resultTypeSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const type = await createResultType(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(type);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateResultTypeHandler(req: Request, res: Response) {
  const parsed = resultTypeSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const type = await updateResultType(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(type);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteResultTypeHandler(req: Request, res: Response) {
  try {
    await deleteResultType(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listResultEntriesHandler(req: Request, res: Response) {
  const parsed = memberIdQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ message: "Parâmetro memberId é obrigatório." });
    return;
  }

  try {
    const entries = await listResultEntries(req.user!.companyId, req.user!, parsed.data.memberId);
    res.json(entries);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createResultEntryHandler(req: Request, res: Response) {
  const parsed = resultEntryCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const entry = await createResultEntry(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(entry);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateResultEntryHandler(req: Request, res: Response) {
  const parsed = resultEntryUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const entry = await updateResultEntry(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(entry);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteResultEntryHandler(req: Request, res: Response) {
  try {
    await deleteResultEntry(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listOperationalAdjustmentsHandler(req: Request, res: Response) {
  const parsed = memberIdQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ message: "Parâmetro memberId é obrigatório." });
    return;
  }

  try {
    const adjustments = await listOperationalAdjustments(req.user!.companyId, req.user!, parsed.data.memberId);
    res.json(adjustments);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createOperationalAdjustmentHandler(req: Request, res: Response) {
  const parsed = operationalAdjustmentCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const adjustment = await createOperationalAdjustment(
      req.user!.companyId,
      req.user!,
      parsed.data,
    );
    res.status(201).json(adjustment);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteOperationalAdjustmentHandler(req: Request, res: Response) {
  try {
    await deleteOperationalAdjustment(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getRealizadoLiquidoSummaryHandler(req: Request, res: Response) {
  const parsed = realizadoLiquidoSummaryQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const summary = await getRealizadoLiquidoSummary(req.user!.companyId, req.user!, parsed.data);
    res.json(summary);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listAllResultsHandler(req: Request, res: Response) {
  const parsed = listAllResultsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ message: "Filtros inválidos" });
    return;
  }

  const result = await listAllResults(req.user!.companyId, req.user!, parsed.data);
  res.json(result);
}

export async function bulkDeleteResultsHandler(req: Request, res: Response) {
  const parsed = bulkIdsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  if (parsed.data.entryIds.length === 0 && parsed.data.adjustmentIds.length === 0) {
    res.status(400).json({ message: "Nenhum item selecionado." });
    return;
  }

  try {
    await bulkDeleteResults(req.user!.companyId, req.user!, parsed.data);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function bulkUpdateResultsHandler(req: Request, res: Response) {
  const parsed = bulkUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  if (parsed.data.entryIds.length === 0 && parsed.data.adjustmentIds.length === 0) {
    res.status(400).json({ message: "Nenhum item selecionado." });
    return;
  }

  try {
    const result = await bulkUpdateResults(req.user!.companyId, req.user!, parsed.data);
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}
