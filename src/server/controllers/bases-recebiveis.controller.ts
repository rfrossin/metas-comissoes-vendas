import type { Request, Response } from "express";
import { z } from "zod";
import {
  createReceivablesBase,
  deleteReceivablesBase,
  duplicateReceivablesBase,
  getMyReceivablesBaseDetail,
  getReceivablesBaseDetail,
  getReceivablesBaseDetailForBeneficiary,
  listMyReceivablesBases,
  listReceivablesBases,
  setBeneficiaries,
  setConditionalTriggers,
  setReceivablesBaseStatus,
  setTierLadder,
  simulateReceivablesBase,
  updateReceivablesBase,
} from "../services/bases-recebiveis.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { toDate } from "../services/resultados.service";

const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD");

const baseSchema = z.object({
  name: z.string().min(1),
  indicatorType: z.enum(["META", "RESULTADO"]),
  primaryGoalCampaignId: z.string().min(1).nullable(),
  resultTypeId: z.string().min(1).nullable(),
  periodicity: z.enum(["DIARIO", "SEMANAL", "MENSAL", "TRIMESTRAL", "ANUAL"]),
  triggerMode: z.enum(["FAIXA", "CUMULATIVO"]),
  // null = Final Aberto.
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
});

const statusSchema = z.object({
  status: z.enum(["ATIVO", "DESATIVADO", "ENCERRADO"]),
});

const beneficiariesSchema = z.object({
  beneficiaries: z.array(
    z.object({
      memberId: z.string().min(1),
      entityType: scopeTypeSchema,
      entityId: z.string().min(1),
    }),
  ),
});

const conditionalTriggersSchema = z.object({
  triggers: z.array(
    z.object({
      verificationLevel: scopeTypeSchema,
      indicatorType: z.enum(["META", "RESULTADO"]),
      conditionalGoalCampaignId: z.string().min(1).nullable(),
      resultTypeId: z.string().min(1).nullable(),
      minAttainmentPercentage: z.number().positive().nullable(),
      minResultValue: z.number().positive().nullable(),
      applicableMemberIds: z.array(z.string().min(1)),
    }),
  ),
});

const rewardTypeSchema = z.enum(["PERCENT_FIXO", "PERCENT_RESULTADO", "VALOR_FIXO", "PREMIO_FISICO"]);

const tierLadderSchema = z.object({
  rungs: z.array(
    z.object({
      order: z.number().int().positive(),
      threshold: z.number().positive(),
      rewardType: rewardTypeSchema,
      rewardResultTypeId: z.string().min(1).nullable(),
      rewardPercentage: z.number().positive().nullable(),
      rewardFixedValue: z.number().positive().nullable(),
      rewardDescription: z.string().nullable(),
    }),
  ),
});

const simulationSchema = z.object({
  memberId: z.string().min(1),
  simulatedMainRealized: z.number(),
  conditionalSimulations: z.array(
    z.object({
      conditionalTriggerId: z.string().min(1),
      simulatedRealized: z.number(),
    }),
  ),
  // Data de referência para resolver a janela do Período de Fechamento
  // (hoje, se omitida) — parametrizável para quando o Fechamento (PASSO 3)
  // precisar simular/fechar uma data específica.
  referenceDate: isoDate.optional(),
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

export async function listReceivablesBasesHandler(req: Request, res: Response) {
  try {
    const bases = await listReceivablesBases(req.user!.companyId, req.user!);
    res.json(bases);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listMyReceivablesBasesHandler(req: Request, res: Response) {
  try {
    const bases = await listMyReceivablesBases(req.user!.companyId, req.user!);
    res.json(bases);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getMyReceivablesBaseDetailHandler(req: Request, res: Response) {
  const page = req.query.page ? Number(req.query.page) : 0;
  try {
    const detail = await getMyReceivablesBaseDetail(req.user!.companyId, req.user!, req.params.id, Number.isFinite(page) ? page : 0);
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getReceivablesBaseDetailForBeneficiaryHandler(req: Request, res: Response) {
  const page = req.query.page ? Number(req.query.page) : 0;
  try {
    const detail = await getReceivablesBaseDetailForBeneficiary(
      req.user!.companyId,
      req.user!,
      req.params.id,
      req.params.memberId,
      Number.isFinite(page) ? page : 0,
    );
    res.json(detail);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getReceivablesBaseDetailHandler(req: Request, res: Response) {
  try {
    const base = await getReceivablesBaseDetail(req.user!.companyId, req.user!, req.params.id);
    res.json(base);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createReceivablesBaseHandler(req: Request, res: Response) {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const base = await createReceivablesBase(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(base);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateReceivablesBaseHandler(req: Request, res: Response) {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const base = await updateReceivablesBase(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(base);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setReceivablesBaseStatusHandler(req: Request, res: Response) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const base = await setReceivablesBaseStatus(req.user!.companyId, req.user!, req.params.id, parsed.data.status);
    res.json(base);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteReceivablesBaseHandler(req: Request, res: Response) {
  try {
    await deleteReceivablesBase(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function duplicateReceivablesBaseHandler(req: Request, res: Response) {
  try {
    const clone = await duplicateReceivablesBase(req.user!.companyId, req.user!, req.params.id);
    res.status(201).json(clone);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setBeneficiariesHandler(req: Request, res: Response) {
  const parsed = beneficiariesSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const beneficiaries = await setBeneficiaries(req.user!.companyId, req.user!, req.params.id, parsed.data.beneficiaries);
    res.json(beneficiaries);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setConditionalTriggersHandler(req: Request, res: Response) {
  const parsed = conditionalTriggersSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const triggers = await setConditionalTriggers(req.user!.companyId, req.user!, req.params.id, parsed.data.triggers);
    res.json(triggers);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setTierLadderHandler(req: Request, res: Response) {
  const parsed = tierLadderSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const tierRules = await setTierLadder(req.user!.companyId, req.user!, req.params.id, parsed.data.rungs);
    res.json(tierRules);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function simulateReceivablesBaseHandler(req: Request, res: Response) {
  const parsed = simulationSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const result = await simulateReceivablesBase(
      req.user!.companyId,
      req.user!,
      req.params.id,
      parsed.data.memberId,
      parsed.data.simulatedMainRealized,
      parsed.data.conditionalSimulations,
      parsed.data.referenceDate ? toDate(parsed.data.referenceDate) : undefined,
    );
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}
