import type { Request, Response } from "express";
import { z } from "zod";
import {
  getClosingDetail,
  listClosings,
  listCommercialPeriods,
  reopenClosing,
  reopenClosingBulk,
  saveClosing,
  saveClosingBulk,
  setCommercialPeriodStatus,
} from "../services/fechamento.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { isoDate } from "./resultados.controller";

const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);
const closingStatusSchema = z.enum(["PREVISTO", "ABERTO", "FECHADO"]);
const approvalStatusSchema = z.enum(["APROVADO", "REPROVADO"]);
const periodStatusSchema = z.enum(["ABERTO", "FECHADO"]);

const listSchema = z.object({
  status: z.array(closingStatusSchema),
  entityType: scopeTypeSchema,
  entityIds: z.array(z.string().min(1)),
  cargoId: z.string().min(1).nullable(),
  search: z.string().nullable(),
  periodStart: isoDate,
  periodEnd: isoDate,
});

const saveSchema = z.object({
  approvals: z.array(z.object({ receivablesBaseId: z.string().min(1), periodStart: isoDate, approvalStatus: approvalStatusSchema })),
  comments: z.string().nullable(),
  manualAdjustmentValue: z.number().nullable(),
  manualAdjustmentReason: z.string().nullable(),
});

const periodStatusBodySchema = z.object({ status: periodStatusSchema });

const bulkSaveSchema = z.object({
  items: z.array(z.object({ memberId: z.string().min(1), referenceMonth: isoDate })).min(1),
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

export async function listClosingsHandler(req: Request, res: Response) {
  const parsed = listSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const rows = await listClosings(req.user!.companyId, req.user!, parsed.data);
    res.json(rows);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getClosingDetailHandler(req: Request, res: Response) {
  try {
    const detail = await getClosingDetail(req.user!.companyId, req.user!, req.params.memberId, req.params.referenceMonth);
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function saveClosingHandler(req: Request, res: Response) {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const closing = await saveClosing(req.user!.companyId, req.user!, req.params.memberId, req.params.referenceMonth, parsed.data);
    res.json(closing);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function saveClosingBulkHandler(req: Request, res: Response) {
  const parsed = bulkSaveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const results = await saveClosingBulk(req.user!.companyId, req.user!, parsed.data.items);
    res.json(results);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function reopenClosingBulkHandler(req: Request, res: Response) {
  const parsed = bulkSaveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const results = await reopenClosingBulk(req.user!.companyId, req.user!, parsed.data.items);
    res.json(results);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function reopenClosingHandler(req: Request, res: Response) {
  try {
    await reopenClosing(req.user!.companyId, req.user!, req.params.memberId, req.params.referenceMonth);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listCommercialPeriodsHandler(req: Request, res: Response) {
  try {
    const periods = await listCommercialPeriods(req.user!.companyId, req.user!);
    res.json(periods);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setCommercialPeriodStatusHandler(req: Request, res: Response) {
  const parsed = periodStatusBodySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const period = await setCommercialPeriodStatus(req.user!.companyId, req.user!, req.params.referenceMonth, parsed.data.status);
    res.json(period);
  } catch (error) {
    respondToError(error, res);
  }
}
