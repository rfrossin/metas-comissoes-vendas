import { Router } from "express";
import { chooseCompanyHandler, loginHandler } from "../controllers/auth.controller";
import { acceptInviteHandler } from "../controllers/permissoes.controller";
import { submitCompanySignupRequestHandler } from "../controllers/platform.controller";
import { asyncHandler } from "../utils/async-handler";

export const authRoutes = Router();

authRoutes.post("/login", asyncHandler(loginHandler));
// Pública: usa o preAuthToken de 5min emitido pelo /login quando a
// identidade tem mais de uma empresa — o usuário ainda não tem o token
// completo da aplicação neste passo.
authRoutes.post("/escolher-empresa", asyncHandler(chooseCompanyHandler));
// Pública (o convidado ainda não tem conta/token) — por isso vive aqui e
// não em permissoes.routes.ts, que é montado atrás do authMiddleware.
authRoutes.post("/aceitar-convite", asyncHandler(acceptInviteHandler));
// Pública — botão "Nova Empresa" na tela de login. Só registra o pedido de
// liberação; a Company real só existe após aprovação do Super Admin.
authRoutes.post("/cadastrar-empresa", asyncHandler(submitCompanySignupRequestHandler));
