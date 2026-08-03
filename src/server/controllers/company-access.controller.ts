import type { Request, Response } from "express";
import { z } from "zod";
import {
  approveAccessRequest,
  getCompanyInviteCode,
  listCompanyAccessRequests,
  listMyAccessRequests,
  peekCompanyByInviteCode,
  regenerateCompanyInviteCode,
  rejectAccessRequest,
  removeUserFromCompany,
  requestCompanyAccess,
} from "../services/company-access.service";
import { getIdentityState } from "../services/identity.service";

// ---------- Lado do SOLICITANTE (token de identidade) ----------

const requestAccessSchema = z.object({
  inviteCode: z.string().trim().min(1, "Informe o código da empresa"),
});

export async function requestCompanyAccessHandler(req: Request, res: Response) {
  const parsed = requestAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Dados inválidos" });
    return;
  }

  // Nome e e-mail vêm da identidade autenticada, NUNCA do corpo — senão
  // daria para pedir acesso em nome de outra pessoa.
  const identity = await getIdentityState(req.identity!.authUserId);

  const result = await requestCompanyAccess({
    authUserId: req.identity!.authUserId,
    email: identity.email,
    name: identity.name || identity.email,
    inviteCode: parsed.data.inviteCode,
  });

  res.status(201).json(result);
}

const peekSchema = z.object({
  inviteCode: z.string().trim().min(1),
});

export async function peekCompanyHandler(req: Request, res: Response) {
  const parsed = peekSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Código inválido" });
    return;
  }
  res.json(await peekCompanyByInviteCode(parsed.data.inviteCode));
}

export async function listMyAccessRequestsHandler(req: Request, res: Response) {
  res.json(await listMyAccessRequests(req.identity!.authUserId));
}

// ---------- Lado do ADMIN da empresa (token de tenant) ----------

export async function listCompanyAccessRequestsHandler(req: Request, res: Response) {
  res.json(await listCompanyAccessRequests(req.user!.companyId, req.user!));
}

export async function approveAccessRequestHandler(req: Request, res: Response) {
  const result = await approveAccessRequest(req.user!.companyId, req.user!, req.params.id);
  res.json(result);
}

const rejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function rejectAccessRequestHandler(req: Request, res: Response) {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }
  await rejectAccessRequest(req.user!.companyId, req.user!, req.params.id, parsed.data.reason ?? "");
  res.status(204).send();
}

export async function getCompanyInviteCodeHandler(req: Request, res: Response) {
  res.json(await getCompanyInviteCode(req.user!.companyId, req.user!));
}

export async function regenerateCompanyInviteCodeHandler(req: Request, res: Response) {
  res.json(await regenerateCompanyInviteCode(req.user!.companyId, req.user!));
}

export async function removeUserFromCompanyHandler(req: Request, res: Response) {
  await removeUserFromCompany(req.user!.companyId, req.user!, req.params.id);
  res.status(204).send();
}
