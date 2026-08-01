import type { Request, Response } from "express";
import { z } from "zod";
import {
  getAcompanhamentoOverview,
  getComparativoSeries,
  getCumulativeSeries,
  getHierarchyChildren,
  getRecalculatedMetaSeries,
  listAvailableCampaigns,
} from "../services/acompanhamento.service";
import { isoDate } from "./resultados.controller";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);

const csvIds = z
  .string()
  .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean));

const campanhasDisponiveisQuerySchema = z.object({
  resultTypeId: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  entityType: scopeTypeSchema,
  entityIds: csvIds,
});

const acompanhamentoFiltersSchema = z.object({
  resultTypeId: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  realizadoAte: isoDate,
  entityType: scopeTypeSchema,
  entityIds: z.array(z.string().min(1)),
  goalCampaignIds: z.array(z.string().min(1)),
});

const overviewSchema = acompanhamentoFiltersSchema.extend({
  granularity: z.enum(["DIA", "SEMANA", "MES", "TRIMESTRE"]),
  monthOffset: z.number().int().min(0).default(0),
});

const comparativoSchema = z.object({
  resultTypeId: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  entityType: scopeTypeSchema,
  entityIds: z.array(z.string().min(1)),
  goalCampaignIds: z.array(z.string().min(1)),
  year: z.number().int().min(2000).max(2100),
});

const hierarquiaFilhosSchema = z.object({
  resultTypeId: z.string().min(1),
  periodStart: isoDate,
  realizadoAte: isoDate,
  parent: z.object({ entityType: scopeTypeSchema, entityId: z.string().min(1) }),
  parentRealizado: z.string().min(1),
  rootTotal: z.string().min(1),
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

function badRequest(res: Response) {
  res.status(400).json({ message: "Dados inválidos" });
}

export async function listAvailableCampaignsHandler(req: Request, res: Response) {
  const parsed = campanhasDisponiveisQuerySchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res);

  try {
    const entities = parsed.data.entityIds.map((entityId) => ({
      entityType: parsed.data.entityType,
      entityId,
    }));

    const campaigns = await listAvailableCampaigns(req.user!.companyId, req.user!, {
      resultTypeId: parsed.data.resultTypeId,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      entities,
    });
    res.json(campaigns);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getOverviewHandler(req: Request, res: Response) {
  const parsed = overviewSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const { granularity, monthOffset, ...filters } = parsed.data;
    const overview = await getAcompanhamentoOverview(req.user!.companyId, req.user!, filters, granularity, monthOffset);
    res.json(overview);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getCumulativeSeriesHandler(req: Request, res: Response) {
  const parsed = acompanhamentoFiltersSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const series = await getCumulativeSeries(req.user!.companyId, req.user!, parsed.data);
    res.json(series);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getComparativoSeriesHandler(req: Request, res: Response) {
  const parsed = comparativoSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const { year, ...filters } = parsed.data;
    const series = await getComparativoSeries(req.user!.companyId, req.user!, filters, year);
    res.json(series);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getRecalculatedMetaSeriesHandler(req: Request, res: Response) {
  const parsed = acompanhamentoFiltersSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const series = await getRecalculatedMetaSeries(req.user!.companyId, req.user!, parsed.data);
    res.json(series);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getHierarchyChildrenHandler(req: Request, res: Response) {
  const parsed = hierarquiaFilhosSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const { parent, parentRealizado, rootTotal, ...filters } = parsed.data;
    const rows = await getHierarchyChildren(req.user!.companyId, req.user!, filters, parent, parentRealizado, rootTotal);
    res.json(rows);
  } catch (error) {
    respondToError(error, res);
  }
}
