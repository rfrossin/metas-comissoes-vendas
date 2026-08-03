import { Router } from "express";
import { chooseCompanyHandler, loginHandler } from "../controllers/auth.controller";
import { acceptInviteHandler, getInvitePublicInfoHandler } from "../controllers/permissoes.controller";
import { submitCompanySignupRequestHandler } from "../controllers/platform.controller";
import { authRateLimiter } from "../middlewares/rate-limit.middleware";
import { asyncHandler } from "../utils/async-handler";

export const authRoutes = Router();

authRoutes.post("/login", authRateLimiter, asyncHandler(loginHandler));
// Pública: usa o preAuthToken de 5min emitido pelo /login quando a
// identidade tem mais de uma empresa — o usuário ainda não tem o token
// completo da aplicação neste passo.
authRoutes.post("/escolher-empresa", authRateLimiter, asyncHandler(chooseCompanyHandler));
// Pública (o convidado ainda não tem conta/token) — por isso vive aqui e
// não em permissoes.routes.ts, que é montado atrás do authMiddleware.
authRoutes.post("/aceitar-convite", asyncHandler(acceptInviteHandler));
// Consultada pela tela de aceite antes de renderizar o formulário: decide
// entre pedir senha nova ou a senha já existente da pessoa.
authRoutes.get("/convite/:token", asyncHandler(getInvitePublicInfoHandler));
// LEGADO — nenhuma tela chama mais. O fluxo atual é
// POST /api/identidade/cadastrar-empresa, feito por quem já está logado, o
// que permite vincular a empresa ao solicitante como Administrador já na
// aprovação. Mantida para não quebrar pedidos em trânsito e integrações
// externas; a aprovação desses pedidos (sem requesterAuthUserId) segue
// pelo caminho de convite por e-mail em company-signup.service.ts.
authRoutes.post("/cadastrar-empresa", authRateLimiter, asyncHandler(submitCompanySignupRequestHandler));
