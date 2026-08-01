import type { Request, Response } from "express";
import { z } from "zod";
import { getMemberGanhoPorMeta, getReceivablesOverview } from "../services/recebiveis.service";
import { ForbiddenError, NotFoundError } from "../utils/http-errors";
import { isoDate } from "./resultados.controller";

const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);

const overviewSchema = z.object({
  entityType: scopeTypeSchema,
  entityIds: z.array(z.string().min(1)),
  periodStart: isoDate,
  periodEnd: isoDate,
});

const ganhoPorMetaSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
});

function respondToError(error: unknown, res: Response) {
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

function badRequest(res: Response) {
  res.status(400).json({ message: "Dados inválidos" });
}

export async function getReceivablesOverviewHandler(req: Request, res: Response) {
  const parsed = overviewSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const overview = await getReceivablesOverview(req.user!.companyId, req.user!, parsed.data);
    res.json(overview);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getMemberGanhoPorMetaHandler(req: Request, res: Response) {
  const parsed = ganhoPorMetaSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const result = await getMemberGanhoPorMeta(req.user!.companyId, req.user!, req.params.memberId, parsed.data.periodStart, parsed.data.periodEnd);
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}
