import { Router } from "express";
import multer from "multer";
import {
  createChannelHandler,
  createDepartmentHandler,
  createMemberHandler,
  createTeamHandler,
  deleteChannelHandler,
  deleteDepartmentHandler,
  deleteMemberHandler,
  deleteTeamHandler,
  getScopedOrgOptionsHandler,
  getTreeHandler,
  listAllActiveMembersHandler,
  listMembersForManagementHandler,
  updateChannelHandler,
  updateDepartmentHandler,
  updateMemberHandler,
  updateTeamHandler,
} from "../controllers/estrutura-organizacional.controller";
import { bulkImportCommitHandler, bulkImportPreviewHandler } from "../controllers/bulk-import.controller";
import { asyncHandler } from "../utils/async-handler";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const estruturaOrganizacionalRoutes = Router();

estruturaOrganizacionalRoutes.get("/tree", asyncHandler(getTreeHandler));

estruturaOrganizacionalRoutes.post("/channels", asyncHandler(createChannelHandler));
estruturaOrganizacionalRoutes.put("/channels/:id", asyncHandler(updateChannelHandler));
estruturaOrganizacionalRoutes.delete("/channels/:id", asyncHandler(deleteChannelHandler));

estruturaOrganizacionalRoutes.post("/departments", asyncHandler(createDepartmentHandler));
estruturaOrganizacionalRoutes.put("/departments/:id", asyncHandler(updateDepartmentHandler));
estruturaOrganizacionalRoutes.delete("/departments/:id", asyncHandler(deleteDepartmentHandler));

estruturaOrganizacionalRoutes.post("/teams", asyncHandler(createTeamHandler));
estruturaOrganizacionalRoutes.put("/teams/:id", asyncHandler(updateTeamHandler));
estruturaOrganizacionalRoutes.delete("/teams/:id", asyncHandler(deleteTeamHandler));

estruturaOrganizacionalRoutes.get("/members/all", asyncHandler(listAllActiveMembersHandler));
estruturaOrganizacionalRoutes.get("/members/manage", asyncHandler(listMembersForManagementHandler));
estruturaOrganizacionalRoutes.get("/scoped-options", asyncHandler(getScopedOrgOptionsHandler));
estruturaOrganizacionalRoutes.post("/members", asyncHandler(createMemberHandler));
estruturaOrganizacionalRoutes.put("/members/:id", asyncHandler(updateMemberHandler));
estruturaOrganizacionalRoutes.delete("/members/:id", asyncHandler(deleteMemberHandler));

estruturaOrganizacionalRoutes.post(
  "/bulk-import/preview",
  upload.single("file"),
  asyncHandler(bulkImportPreviewHandler),
);
estruturaOrganizacionalRoutes.post("/bulk-import/commit", asyncHandler(bulkImportCommitHandler));
