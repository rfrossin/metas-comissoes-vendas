import type { Request, Response } from "express";
import { z } from "zod";
import { createPlatformUser, listPlatformUsers, platformLogin } from "../services/platform-auth.service";
import {
  approveCompanySignupRequest,
  listCompanySignupRequests,
  rejectCompanySignupRequest,
  submitCompanySignupRequest,
} from "../services/company-signup.service";
import {
  listCompaniesWithUsers,
  listOrphanIdentities,
  platformDeleteIdentity,
  platformRemoveUserFromCompany,
} from "../services/platform-companies.service";
import { getIdentityState } from "../services/identity.service";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../utils/http-errors";

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

const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Pública — login do Super Admin/Suporte da plataforma.
export async function platformLoginHandler(req: Request, res: Response) {
  const parsed = platformLoginSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const result = await platformLogin(parsed.data);
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}

const signupRequestSchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().min(1),
  contactEmail: z.string().email(),
});

// Pública — botão "Nova Empresa" na tela de login.
export async function submitCompanySignupRequestHandler(req: Request, res: Response) {
  const parsed = signupRequestSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const request = await submitCompanySignupRequest(parsed.data);
    res.status(201).json(request);
  } catch (error) {
    respondToError(error, res);
  }
}

const signupFromIdentitySchema = z.object({
  companyName: z.string().trim().min(2, "Informe o nome da empresa"),
});

// Pedido de nova empresa feito por quem JÁ está logado (rota
// /api/identidade/cadastrar-empresa). Nome e e-mail de contato vêm da
// identidade autenticada, não do corpo — assim o vínculo de Administrador
// criado na aprovação aponta necessariamente para quem pediu.
export async function submitCompanySignupFromIdentityHandler(req: Request, res: Response) {
  const parsed = signupFromIdentitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Dados inválidos" });
    return;
  }

  const identity = await getIdentityState(req.identity!.authUserId);

  try {
    const request = await submitCompanySignupRequest({
      companyName: parsed.data.companyName,
      contactName: identity.name || identity.email,
      contactEmail: identity.email,
      requesterAuthUserId: req.identity!.authUserId,
    });
    res.status(201).json({ id: request.id });
  } catch (error) {
    respondToError(error, res);
  }
}

const statusQuerySchema = z.enum(["PENDENTE", "APROVADO", "REJEITADO"]);

// Protegida por platformAuthMiddleware.
export async function listCompanySignupRequestsHandler(req: Request, res: Response) {
  const parsedStatus = statusQuerySchema.safeParse(req.query.status);
  try {
    const requests = await listCompanySignupRequests(parsedStatus.success ? parsedStatus.data : undefined);
    res.json(requests);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function approveCompanySignupRequestHandler(req: Request, res: Response) {
  try {
    const result = await approveCompanySignupRequest(req.params.id, req.platformUser!);
    res.json(result);
  } catch (error) {
    respondToError(error, res);
  }
}

// Protegida por platformAuthMiddleware — visão de todas as empresas e seus
// usuários, para o Super Admin acompanhar quem foi adicionado em cada uma.
export async function listCompaniesWithUsersHandler(_req: Request, res: Response) {
  try {
    const companies = await listCompaniesWithUsers();
    res.json(companies);
  } catch (error) {
    respondToError(error, res);
  }
}

// Identidades sem nenhuma empresa ativa — quem se cadastrou e ainda não
// entrou em nenhuma, e quem saiu da última.
export async function listOrphanIdentitiesHandler(_req: Request, res: Response) {
  try {
    res.json(await listOrphanIdentities());
  } catch (error) {
    respondToError(error, res);
  }
}

// Tira o usuário de UMA empresa; a identidade continua existindo.
export async function platformRemoveUserFromCompanyHandler(req: Request, res: Response) {
  try {
    await platformRemoveUserFromCompany(req.platformUser!, req.params.userId);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

// Exclui a identidade do sistema inteiro (Supabase Auth).
export async function platformDeleteIdentityHandler(req: Request, res: Response) {
  try {
    await platformDeleteIdentity(req.platformUser!, req.params.authUserId);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

const createPlatformUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["SUPER_ADMIN", "SUPORTE"]),
});

export async function listPlatformUsersHandler(_req: Request, res: Response) {
  try {
    const users = await listPlatformUsers();
    res.json(users);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createPlatformUserHandler(req: Request, res: Response) {
  const parsed = createPlatformUserSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    const user = await createPlatformUser(req.platformUser!, parsed.data);
    res.status(201).json(user);
  } catch (error) {
    respondToError(error, res);
  }
}

const rejectSchema = z.object({
  reason: z.string().default(""),
});

export async function rejectCompanySignupRequestHandler(req: Request, res: Response) {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    await rejectCompanySignupRequest(req.params.id, req.platformUser!, parsed.data.reason);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}
