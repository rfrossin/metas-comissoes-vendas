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
  deleteCompanyPermanently,
  getCompanyName,
  listCompaniesWithUsers,
  listOrphanIdentities,
  platformAddUserToCompany,
  platformDeleteIdentity,
  platformRemoveUserFromCompany,
  setCompanyStatus,
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

const companyStatusSchema = z.object({
  status: z.enum(["ATIVA", "BLOQUEADA_INADIMPLENCIA"]),
});

// Pausa/reativa o acesso à empresa. Login continua funcionando; o que para
// é operar dentro dela (companyStatusGuard).
export async function setCompanyStatusHandler(req: Request, res: Response) {
  const parsed = companyStatusSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    res.json(await setCompanyStatus(req.platformUser!, req.params.id, parsed.data.status));
  } catch (error) {
    respondToError(error, res);
  }
}

const deleteCompanySchema = z.object({
  // Confirmação por digitação do nome: esta ação apaga o histórico
  // financeiro inteiro da empresa e não tem desfazer. Um clique errado na
  // lista não pode bastar.
  confirmName: z.string().min(1),
});

export async function deleteCompanyHandler(req: Request, res: Response) {
  const parsed = deleteCompanySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Confirme digitando o nome da empresa.");

  try {
    const company = await getCompanyName(req.params.id);
    if (!company) {
      res.status(404).json({ message: "Empresa não encontrada." });
      return;
    }
    if (parsed.data.confirmName.trim() !== company.name) {
      res.status(400).json({ message: "O nome digitado não confere com o da empresa." });
      return;
    }

    res.json(await deleteCompanyPermanently(req.platformUser!, req.params.id));
  } catch (error) {
    respondToError(error, res);
  }
}

const addUserToCompanySchema = z.object({
  authUserId: z.string().min(1),
  companyId: z.string().min(1),
  role: z.enum(["OPERACIONAL", "LIDERANCA_NO", "ADMINISTRADOR"]),
});

// Vincula uma identidade existente a uma empresa, sem passar por convite.
export async function platformAddUserToCompanyHandler(req: Request, res: Response) {
  const parsed = addUserToCompanySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);

  try {
    res.status(201).json(await platformAddUserToCompany(req.platformUser!, parsed.data));
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
