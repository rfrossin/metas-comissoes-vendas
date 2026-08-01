import type { Request, Response } from "express";
import { z } from "zod";
import {
  applyDailySeasonality,
  applyGoalLine,
  applyGroupedGoalLine,
  applyRecalculatedGoalLine,
  createGoalCampaign,
  deleteGoalCampaign,
  deleteGoalLine,
  duplicateGoalCampaign,
  getGoalLineDetail,
  getHistoricalResultValue,
  getPreviousPeriodMonthlyValues,
  listGoalCampaigns,
  listGoalLines,
  listGoalTriggers,
  listMyGoalLines,
  previewGoalLine,
  previewGroupedGoalLine,
  previewReforecast,
  saveManualGoalLine,
  setGoalCampaignActiveStatus,
  setGoalLineActiveStatus,
  setGoalTriggers,
  updateGoalCampaign,
  updateGoalCampaignStatus,
} from "../services/metas.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD");

const campaignSchema = z
  .object({
    name: z.string().min(1),
    startDate: isoDate,
    endDate: isoDate,
    resultTypeId: z.string().min(1),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: "A Data Inicial deve ser anterior (ou igual) à Data Final.",
    path: ["endDate"],
  });

const statusSchema = z.object({
  status: z.enum(["ATIVA", "INATIVA", "ENCERRADA"]),
});

// Gatilhos ficam dormentes na UI de Metas (ReceivablesTierRule do módulo
// futuro de Bases de Recebível já depende deles no schema) — os endpoints
// continuam funcionais, só não são mais chamados pelo client de Metas.
const triggersSchema = z.object({
  triggers: z.array(
    z.object({
      percentage: z.number().positive(),
      colorFlag: z.string().min(1),
    }),
  ),
});

const goalLineCalcSchema = z.object({
  entityType: scopeTypeSchema,
  entityId: z.string().min(1),
  engineType: z.enum(["VALOR_ALVO_ANUAL", "CRESCIMENTO_MENSAL", "CRESCIMENTO_TRIMESTRAL"]),
  // null = modo "Sem Sazonalidade" (pesos iguais entre todos os meses).
  seasonalityBaseId: z.string().min(1).nullable(),
  initialValue: z.number(),
  growthRate: z.number(),
});

const manualGoalLineSchema = z.object({
  entityType: scopeTypeSchema,
  entityId: z.string().min(1),
  dailyValues: z.array(
    z.object({
      date: isoDate,
      value: z.number(),
    }),
  ),
});

const groupSourceSchema = z.object({
  goalCampaignId: z.string().min(1),
  entityType: scopeTypeSchema,
  entityId: z.string().min(1),
});

const groupedGoalLineSchema = z.object({
  entityType: scopeTypeSchema,
  entityId: z.string().min(1),
  sources: z.array(groupSourceSchema),
  discountPercentage: z.number().min(0).max(100),
});

const reforecastSchema = z.object({
  referenceDate: isoDate,
});

const dailySeasonalitySchema = z.object({
  dailySeasonalityBaseId: z.string().min(1).nullable(),
});

const activeStatusSchema = z.object({
  effectiveDate: isoDate.nullable(),
});

const historicalValueSchema = z.object({
  entityType: scopeTypeSchema,
  entityId: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
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

export async function listGoalCampaignsHandler(req: Request, res: Response) {
  const campaigns = await listGoalCampaigns(req.user!.companyId, req.user!);
  res.json(campaigns);
}

export async function listMyGoalLinesHandler(req: Request, res: Response) {
  const lines = await listMyGoalLines(req.user!.companyId, req.user!);
  res.json(lines);
}

export async function createGoalCampaignHandler(req: Request, res: Response) {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const campaign = await createGoalCampaign(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(campaign);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateGoalCampaignHandler(req: Request, res: Response) {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const campaign = await updateGoalCampaign(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(campaign);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateGoalCampaignStatusHandler(req: Request, res: Response) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const campaign = await updateGoalCampaignStatus(req.user!.companyId, req.user!, req.params.id, parsed.data.status);
    res.json(campaign);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteGoalCampaignHandler(req: Request, res: Response) {
  try {
    await deleteGoalCampaign(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function duplicateGoalCampaignHandler(req: Request, res: Response) {
  try {
    const campaign = await duplicateGoalCampaign(req.user!.companyId, req.user!, req.params.id);
    res.status(201).json(campaign);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listGoalTriggersHandler(req: Request, res: Response) {
  try {
    const triggers = await listGoalTriggers(req.user!.companyId, req.params.campaignId);
    res.json(triggers);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setGoalTriggersHandler(req: Request, res: Response) {
  const parsed = triggersSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const triggers = await setGoalTriggers(req.user!.companyId, req.user!, req.params.campaignId, parsed.data.triggers);
    res.json(triggers);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function previewGoalLineHandler(req: Request, res: Response) {
  const parsed = goalLineCalcSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const preview = await previewGoalLine(req.user!.companyId, req.user!, req.params.campaignId, parsed.data);
    res.json(preview);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function applyGoalLineHandler(req: Request, res: Response) {
  const parsed = goalLineCalcSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const line = await applyGoalLine(req.user!.companyId, req.user!, req.params.campaignId, parsed.data);
    res.status(201).json(line);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function saveManualGoalLineHandler(req: Request, res: Response) {
  const parsed = manualGoalLineSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const line = await saveManualGoalLine(req.user!.companyId, req.user!, req.params.campaignId, parsed.data);
    res.status(201).json(line);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function previewGroupedGoalLineHandler(req: Request, res: Response) {
  const parsed = groupedGoalLineSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const preview = await previewGroupedGoalLine(req.user!.companyId, req.user!, req.params.campaignId, parsed.data);
    res.json(preview);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function applyGroupedGoalLineHandler(req: Request, res: Response) {
  const parsed = groupedGoalLineSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const line = await applyGroupedGoalLine(req.user!.companyId, req.user!, req.params.campaignId, parsed.data);
    res.status(201).json(line);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listGoalLinesHandler(req: Request, res: Response) {
  try {
    // PASSO 9.7: { lines, totalCount } — totalCount conta todas as Linhas
    // da Campanha, sem filtro de escopo, pro client montar "vendo X de Y".
    const result = await listGoalLines(req.user!.companyId, req.user!, req.params.campaignId);
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getGoalLineDetailHandler(req: Request, res: Response) {
  const levelParsed = scopeTypeSchema.safeParse(req.params.entityType);
  const lineIdParsed = z.string().min(1).optional().safeParse(req.query.lineId);
  if (!levelParsed.success || !lineIdParsed.success) return badRequest(res);

  try {
    const detail = await getGoalLineDetail(
      req.user!.companyId,
      req.user!,
      req.params.campaignId,
      levelParsed.data,
      req.params.entityId,
      lineIdParsed.data,
    );
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setGoalCampaignActiveStatusHandler(req: Request, res: Response) {
  const parsed = activeStatusSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const campaign = await setGoalCampaignActiveStatus(req.user!.companyId, req.user!, req.params.id, parsed.data.effectiveDate);
    res.json(campaign);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setGoalLineActiveStatusHandler(req: Request, res: Response) {
  const parsed = activeStatusSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const line = await setGoalLineActiveStatus(req.user!.companyId, req.user!, req.params.id, parsed.data.effectiveDate);
    res.json(line);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getHistoricalResultValueHandler(req: Request, res: Response) {
  const parsed = historicalValueSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const value = await getHistoricalResultValue(
      req.user!.companyId,
      req.params.campaignId,
      parsed.data.entityType,
      parsed.data.entityId,
      parsed.data.startDate,
      parsed.data.endDate,
    );
    res.json({ value });
  } catch (error) {
    respondToError(error, res);
  }
}

const previousPeriodValuesQuerySchema = z.object({
  entityType: scopeTypeSchema,
  entityId: z.string().min(1),
});

export async function getPreviousPeriodMonthlyValuesHandler(req: Request, res: Response) {
  const parsed = previousPeriodValuesQuerySchema.safeParse(req.query);
  if (!parsed.success) return badRequest(res);

  try {
    const values = await getPreviousPeriodMonthlyValues(
      req.user!.companyId,
      req.params.campaignId,
      parsed.data.entityType,
      parsed.data.entityId,
    );
    res.json(values);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function applyRecalculatedGoalLineHandler(req: Request, res: Response) {
  const parsed = reforecastSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const detail = await applyRecalculatedGoalLine(req.user!.companyId, req.user!, req.params.lineId, parsed.data.referenceDate);
    res.status(201).json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function applyDailySeasonalityHandler(req: Request, res: Response) {
  const parsed = dailySeasonalitySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const detail = await applyDailySeasonality(
      req.user!.companyId,
      req.user!,
      req.params.lineId,
      parsed.data.dailySeasonalityBaseId,
    );
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteGoalLineHandler(req: Request, res: Response) {
  try {
    await deleteGoalLine(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function previewReforecastHandler(req: Request, res: Response) {
  const parsed = reforecastSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const result = await previewReforecast(req.user!.companyId, req.user!, req.params.lineId, parsed.data.referenceDate);
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}
