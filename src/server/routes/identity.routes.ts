import { Router } from "express";
import {
  acceptInviteAsIdentityHandler,
  getIdentityStateHandler,
  listMyPendingInvitesHandler,
  signUpIdentityHandler,
  updateMyIdentityHandler,
} from "../controllers/identity.controller";
import {
  listMyAccessRequestsHandler,
  peekCompanyHandler,
  requestCompanyAccessHandler,
} from "../controllers/company-access.controller";
import { submitCompanySignupFromIdentityHandler } from "../controllers/platform.controller";
import { identityAuthMiddleware } from "../middlewares/identity-auth.middleware";
import { authRateLimiter } from "../middlewares/rate-limit.middleware";
import { asyncHandler } from "../utils/async-handler";

// Montado em /api/identidade, FORA do authMiddleware/tenantMiddleware — o
// dono deste token pode não ter empresa nenhuma, então nada aqui pode
// depender de companyId (nem alcançar o GUC de RLS).
export const identityRoutes = Router();

// Pública e com rate limit: cria conta no Supabase Auth, então é alvo
// natural de abuso automatizado.
identityRoutes.post("/cadastrar", authRateLimiter, asyncHandler(signUpIdentityHandler));

identityRoutes.use(identityAuthMiddleware);
identityRoutes.get("/eu", asyncHandler(getIdentityStateHandler));
// Dados da pessoa (nome + celular), válidos em todas as empresas dela.
identityRoutes.patch("/eu", asyncHandler(updateMyIdentityHandler));

// Entrar numa empresa existente pelo código que o Admin divulgou.
identityRoutes.get("/empresa", asyncHandler(peekCompanyHandler));
identityRoutes.post("/solicitar-acesso", asyncHandler(requestCompanyAccessHandler));
identityRoutes.get("/meus-pedidos", asyncHandler(listMyAccessRequestsHandler));

// Convites que um Admin enviou para o e-mail desta identidade, e o aceite
// direto pelo painel (sem passar pela tela de senha do link de e-mail).
identityRoutes.get("/meus-convites", asyncHandler(listMyPendingInvitesHandler));
identityRoutes.post("/aceitar-convite", asyncHandler(acceptInviteAsIdentityHandler));

// Cadastrar uma empresa nova estando logado — substitui o botão "Nova
// Empresa" da tela de login (ver company-signup.service.ts).
identityRoutes.post("/cadastrar-empresa", asyncHandler(submitCompanySignupFromIdentityHandler));
