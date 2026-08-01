import type { Request, Response } from "express";
import { z } from "zod";
import {
  createSeasonalityBase,
  deleteSeasonalityBase,
  listSeasonalityBases,
  previewSeasonality,
  updateSeasonalityBase,
} from "../services/bases-metas.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD");
const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);
const analysisTypeSchema = z.enum([
  "DIAS_SEMANA",
  "DIAS_ANO",
  "DIAS_MES",
  "MESES_ANO",
  "MESES_DIAS_SEMANA",
  "MESES_DIAS_MES",
  "TRIMESTRES",
]);

const previewSchema = z.object({
  resultTypeId: z.string().min(1),
  analysisType: analysisTypeSchema,
  scopeType: scopeTypeSchema,
  scopeId: z.string().min(1).nullable(),
  startDate: isoDate,
  endDate: isoDate,
});

const manualWeightSchema = z.object({
  referenceKey: z.number().int().min(1).max(365),
  percentage: z.number(),
});

const createSchema = z.object({
  name: z.string().min(1),
  resultTypeId: z.string().min(1),
  analysisType: analysisTypeSchema,
  scopeType: scopeTypeSchema,
  scopeId: z.string().min(1).nullable(),
  isManual: z.boolean(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  manualWeights: z.array(manualWeightSchema).optional(),
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

export async function listSeasonalityBasesHandler(req: Request, res: Response) {
  try {
    const bases = await listSeasonalityBases(req.user!.companyId, req.user!);
    res.json(bases);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function previewSeasonalityHandler(req: Request, res: Response) {
  const parsed = previewSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const weights = await previewSeasonality(req.user!.companyId, req.user!, parsed.data);
    res.json(weights);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createSeasonalityBaseHandler(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const base = await createSeasonalityBase(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(base);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateSeasonalityBaseHandler(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const base = await updateSeasonalityBase(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(base);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteSeasonalityBaseHandler(req: Request, res: Response) {
  try {
    await deleteSeasonalityBase(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}
