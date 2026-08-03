import { Router } from "express";
import {
  approveCompanySignupRequestHandler,
  createPlatformUserHandler,
  listCompaniesWithUsersHandler,
  listCompanySignupRequestsHandler,
  listOrphanIdentitiesHandler,
  listPlatformUsersHandler,
  platformDeleteIdentityHandler,
  platformLoginHandler,
  platformRemoveUserFromCompanyHandler,
  rejectCompanySignupRequestHandler,
} from "../controllers/platform.controller";
import { platformAuthMiddleware } from "../middlewares/platform-auth.middleware";
import { authRateLimiter } from "../middlewares/rate-limit.middleware";
import { asyncHandler } from "../utils/async-handler";

// Montado em /api/plataforma, fora do tenantMiddleware — o Super Admin não
// pertence a nenhuma Company. platformLogin é a única rota pública daqui;
// todo o resto exige platformAuthMiddleware.
export const platformRoutes = Router();

platformRoutes.post("/login", authRateLimiter, asyncHandler(platformLoginHandler));

platformRoutes.use(platformAuthMiddleware);
platformRoutes.get("/pedidos-empresa", asyncHandler(listCompanySignupRequestsHandler));
platformRoutes.get("/empresas", asyncHandler(listCompaniesWithUsersHandler));
platformRoutes.post("/pedidos-empresa/:id/aprovar", asyncHandler(approveCompanySignupRequestHandler));
platformRoutes.post("/pedidos-empresa/:id/rejeitar", asyncHandler(rejectCompanySignupRequestHandler));
platformRoutes.get("/usuarios", asyncHandler(listPlatformUsersHandler));
platformRoutes.post("/usuarios", asyncHandler(createPlatformUserHandler));

// Identidades sem empresa e remoção de acessos (só SUPER_ADMIN — checado
// nos serviços).
platformRoutes.get("/usuarios-sem-empresa", asyncHandler(listOrphanIdentitiesHandler));
platformRoutes.delete("/vinculos/:userId", asyncHandler(platformRemoveUserFromCompanyHandler));
platformRoutes.delete("/identidades/:authUserId", asyncHandler(platformDeleteIdentityHandler));
