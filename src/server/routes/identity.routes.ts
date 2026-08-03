import { Router } from "express";
import { getIdentityStateHandler, signUpIdentityHandler } from "../controllers/identity.controller";
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

// Entrar numa empresa existente pelo código que o Admin divulgou.
identityRoutes.get("/empresa", asyncHandler(peekCompanyHandler));
identityRoutes.post("/solicitar-acesso", asyncHandler(requestCompanyAccessHandler));
identityRoutes.get("/meus-pedidos", asyncHandler(listMyAccessRequestsHandler));

// Cadastrar uma empresa nova estando logado — substitui o botão "Nova
// Empresa" da tela de login (ver company-signup.service.ts).
identityRoutes.post("/cadastrar-empresa", asyncHandler(submitCompanySignupFromIdentityHandler));
