import { Router } from "express";
import {
  adminSetUserEmailHandler,
  issueIdentityTokenHandler,
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
import {
  approveAccessRequestHandler,
  getCompanyInviteCodeHandler,
  listCompanyAccessRequestsHandler,
  regenerateCompanyInviteCodeHandler,
  rejectAccessRequestHandler,
  removeUserFromCompanyHandler,
} from "../controllers/company-access.controller";
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
// Troca a sessao de tenant por um token de identidade, para abrir o painel
// de conta ("Entrar em outra empresa") sem exigir novo login.
permissoesRoutes.post("/token-identidade", asyncHandler(issueIdentityTokenHandler));

// Código de convite da empresa e pedidos de acesso feitos com ele. Todos
// exigem ADMINISTRADOR — a checagem fica no serviço (assertAdmin), como no
// restante deste módulo.
permissoesRoutes.get("/codigo-convite", asyncHandler(getCompanyInviteCodeHandler));
permissoesRoutes.post("/codigo-convite/regenerar", asyncHandler(regenerateCompanyInviteCodeHandler));
permissoesRoutes.get("/pedidos-acesso", asyncHandler(listCompanyAccessRequestsHandler));
permissoesRoutes.post("/pedidos-acesso/:id/aprovar", asyncHandler(approveAccessRequestHandler));
permissoesRoutes.post("/pedidos-acesso/:id/recusar", asyncHandler(rejectAccessRequestHandler));
// Saída da empresa (soft delete via leftAt) — diferente de DELETE
// /usuarios/:userId, que remove o Login. Aqui o histórico é preservado.
permissoesRoutes.post("/usuarios/:id/remover-da-empresa", asyncHandler(removeUserFromCompanyHandler));
