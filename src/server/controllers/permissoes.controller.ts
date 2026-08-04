import type { Request, Response } from "express";
import { z } from "zod";
import {
  acceptInvite,
  getInvitePublicInfo,
  adminSetUserEmail,
  cancelInvite,
  changeMyPassword,
  createInvite,
  deleteUser,
  getMyProfile,
  getMyScopeAssignments,
  linkUserMember,
  listCompanyUsers,
  listPendingInvites,
  listUserScopeAssignments,
  replaceUserScopeAssignments,
  setUserActive,
  setUserResultsToggle,
  updateCompany,
  updateUserRole,
} from "../services/permissoes.service";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../utils/http-errors";
import { issueIdentityTokenForUser } from "../services/identity.service";
import { phoneSchema } from "../utils/phone.schema";

const scopeTypeSchema = z.enum(["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"]);
const accessLevelSchema = z.enum(["VISUALIZAR", "EDITAR"]);
const permissionLevelSchema = z.enum(["OPERACIONAL", "LIDERANCA_NO", "ADMINISTRADOR"]);

const createInviteSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const linkUserMemberSchema = z.object({
  memberId: z.string().min(1).nullable(),
});

const resultsToggleSchema = z.object({
  canLaunchOwnMemberResults: z.boolean(),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  // authUserId vem da sessão Supabase já estabelecida no frontend (o
  // usuário já definiu a senha pelo link do e-mail antes de chegar aqui).
  authUserId: z.string().min(1),
  // Nome e celular só chegam quando a identidade está NASCENDO aqui (o
  // convidado não tinha conta). Quem já tem conta entra em mais uma empresa
  // e mantém os dados que já cadastrou — por isso opcionais no schema; o
  // service é quem cobra a presença deles no caso de identidade nova.
  name: z.string().trim().min(2, "Informe seu nome").optional(),
  phone: phoneSchema.optional(),
});

const setUserActiveSchema = z.object({ isActive: z.boolean() });

const updateCompanySchema = z.object({ name: z.string().min(1) });

const updateUserRoleSchema = z.object({ role: permissionLevelSchema });

const scopeAssignmentSchema = z.object({
  scopeType: scopeTypeSchema,
  scopeId: z.string().min(1).nullable(),
  accessLevel: accessLevelSchema,
});

const replaceScopeAssignmentsSchema = z.object({
  assignments: z.array(scopeAssignmentSchema),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "A nova senha deve ter ao menos 8 caracteres."),
});

const adminSetEmailSchema = z.object({
  email: z.string().email(),
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
  if (error instanceof UnauthorizedError) {
    res.status(401).json({ message: error.message });
    return;
  }
  throw error;
}

function badRequest(res: Response, message = "Dados inválidos") {
  res.status(400).json({ message });
}

export async function listCompanyUsersHandler(req: Request, res: Response) {
  try {
    const users = await listCompanyUsers(req.user!.companyId, req.user!);
    res.json(users);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listPendingInvitesHandler(req: Request, res: Response) {
  try {
    const invites = await listPendingInvites(req.user!.companyId, req.user!);
    res.json(invites);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createInviteHandler(req: Request, res: Response) {
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const invite = await createInvite(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(invite);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function cancelInviteHandler(req: Request, res: Response) {
  try {
    await cancelInvite(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

// Pública — a tela de aceite consulta antes de renderizar, para decidir
// entre pedir uma senha nova (identidade não existe) ou a senha atual
// (identidade já existe, entrando em mais uma empresa).
export async function getInvitePublicInfoHandler(req: Request, res: Response) {
  try {
    res.json(await getInvitePublicInfo(req.params.token));
  } catch (error) {
    respondToError(error, res);
  }
}

// Pública (sem authMiddleware) — o convidado ainda não tem conta.
export async function acceptInviteHandler(req: Request, res: Response) {
  const parsed = acceptInviteSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors[0]?.message ?? "Dados inválidos");

  try {
    const user = await acceptInvite(parsed.data.token, parsed.data.authUserId, {
      name: parsed.data.name,
      phone: parsed.data.phone,
    });
    res.status(201).json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function issueIdentityTokenHandler(req: Request, res: Response) {
  res.json(await issueIdentityTokenForUser(req.user!.id));
}

export async function setUserActiveHandler(req: Request, res: Response) {
  const parsed = setUserActiveSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const user = await setUserActive(req.user!.companyId, req.user!, req.params.id, parsed.data.isActive);
    res.json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateCompanyHandler(req: Request, res: Response) {
  const parsed = updateCompanySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const company = await updateCompany(req.user!.companyId, req.user!, parsed.data.name);
    res.json(company);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateUserRoleHandler(req: Request, res: Response) {
  const parsed = updateUserRoleSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const user = await updateUserRole(req.user!.companyId, req.user!, req.params.userId, parsed.data.role);
    res.json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function adminSetUserEmailHandler(req: Request, res: Response) {
  const parsed = adminSetEmailSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const user = await adminSetUserEmail(req.user!.companyId, req.user!, req.params.userId, parsed.data.email);
    res.json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function linkUserMemberHandler(req: Request, res: Response) {
  const parsed = linkUserMemberSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const user = await linkUserMember(req.user!.companyId, req.user!, req.params.userId, parsed.data.memberId);
    res.json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function setUserResultsToggleHandler(req: Request, res: Response) {
  const parsed = resultsToggleSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const user = await setUserResultsToggle(
      req.user!.companyId,
      req.user!,
      req.params.userId,
      parsed.data.canLaunchOwnMemberResults,
    );
    res.json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteUserHandler(req: Request, res: Response) {
  try {
    await deleteUser(req.user!.companyId, req.user!, req.params.userId);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listUserScopeAssignmentsHandler(req: Request, res: Response) {
  try {
    const assignments = await listUserScopeAssignments(req.user!.companyId, req.user!, req.params.userId);
    res.json(assignments);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function replaceUserScopeAssignmentsHandler(req: Request, res: Response) {
  const parsed = replaceScopeAssignmentsSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const assignments = await replaceUserScopeAssignments(req.user!.companyId, req.user!, req.params.userId, parsed.data.assignments);
    res.json(assignments);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getMyScopeAssignmentsHandler(req: Request, res: Response) {
  try {
    const assignments = await getMyScopeAssignments(req.user!.companyId, req.user!);
    res.json(assignments);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getMyProfileHandler(req: Request, res: Response) {
  try {
    const profile = await getMyProfile(req.user!.companyId, req.user!);
    res.json(profile);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function changeMyPasswordHandler(req: Request, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors[0]?.message ?? "Dados inválidos");

  try {
    await changeMyPassword(req.user!.companyId, req.user!, parsed.data.currentPassword, parsed.data.newPassword);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}
