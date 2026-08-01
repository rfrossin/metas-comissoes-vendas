import { Router } from "express";
import {
  adminSetUserEmailHandler,
  cancelInviteHandler,
  createInviteHandler,
  changeMyPasswordHandler,
  deleteUserHandler,
  getMyProfileHandler,
  getMyScopeAssignmentsHandler,
  linkUserMemberHandler,
  listCompanyUsersHandler,
  listPendingInvitesHandler,
  listUserScopeAssignmentsHandler,
  replaceUserScopeAssignmentsHandler,
  setUserActiveHandler,
  setUserResultsToggleHandler,
  updateCompanyHandler,
  updateUserRoleHandler,
} from "../controllers/permissoes.controller";
import { myCompaniesHandler, switchCompanyHandler } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/async-handler";

export const permissoesRoutes = Router();

permissoesRoutes.get("/usuarios", asyncHandler(listCompanyUsersHandler));
permissoesRoutes.patch("/usuarios/:id/ativo", asyncHandler(setUserActiveHandler));
permissoesRoutes.patch("/usuarios/:userId/role", asyncHandler(updateUserRoleHandler));
permissoesRoutes.patch("/usuarios/:userId/membro", asyncHandler(linkUserMemberHandler));
permissoesRoutes.patch("/usuarios/:userId/email", asyncHandler(adminSetUserEmailHandler));
permissoesRoutes.patch("/usuarios/:userId/resultados-proprio", asyncHandler(setUserResultsToggleHandler));
permissoesRoutes.delete("/usuarios/:userId", asyncHandler(deleteUserHandler));
permissoesRoutes.get("/convites", asyncHandler(listPendingInvitesHandler));
permissoesRoutes.post("/convites", asyncHandler(createInviteHandler));
permissoesRoutes.delete("/convites/:id", asyncHandler(cancelInviteHandler));
permissoesRoutes.put("/empresa", asyncHandler(updateCompanyHandler));
permissoesRoutes.get("/usuarios/:userId/atribuicoes", asyncHandler(listUserScopeAssignmentsHandler));
permissoesRoutes.put("/usuarios/:userId/atribuicoes", asyncHandler(replaceUserScopeAssignmentsHandler));
permissoesRoutes.get("/meu-perfil", asyncHandler(getMyProfileHandler));
permissoesRoutes.get("/minhas-atribuicoes", asyncHandler(getMyScopeAssignmentsHandler));
permissoesRoutes.put("/minha-senha", asyncHandler(changeMyPasswordHandler));
permissoesRoutes.get("/minhas-empresas", asyncHandler(myCompaniesHandler));
permissoesRoutes.post("/trocar-empresa", asyncHandler(switchCompanyHandler));
