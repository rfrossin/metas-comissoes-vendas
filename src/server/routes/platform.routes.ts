import { Router } from "express";
import {
  approveCompanySignupRequestHandler,
  listCompaniesWithUsersHandler,
  listCompanySignupRequestsHandler,
  platformLoginHandler,
  rejectCompanySignupRequestHandler,
} from "../controllers/platform.controller";
import { platformAuthMiddleware } from "../middlewares/platform-auth.middleware";
import { asyncHandler } from "../utils/async-handler";

// Montado em /api/plataforma, fora do tenantMiddleware — o Super Admin não
// pertence a nenhuma Company. platformLogin é a única rota pública daqui;
// todo o resto exige platformAuthMiddleware.
export const platformRoutes = Router();

platformRoutes.post("/login", asyncHandler(platformLoginHandler));

platformRoutes.use(platformAuthMiddleware);
platformRoutes.get("/pedidos-empresa", asyncHandler(listCompanySignupRequestsHandler));
platformRoutes.get("/empresas", asyncHandler(listCompaniesWithUsersHandler));
platformRoutes.post("/pedidos-empresa/:id/aprovar", asyncHandler(approveCompanySignupRequestHandler));
platformRoutes.post("/pedidos-empresa/:id/rejeitar", asyncHandler(rejectCompanySignupRequestHandler));
