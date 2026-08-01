import { Router } from "express";
import {
  createSeasonalityBaseHandler,
  deleteSeasonalityBaseHandler,
  listSeasonalityBasesHandler,
  previewSeasonalityHandler,
  updateSeasonalityBaseHandler,
} from "../controllers/bases-metas.controller";
import { asyncHandler } from "../utils/async-handler";

export const basesMetasRoutes = Router();

basesMetasRoutes.get("/", asyncHandler(listSeasonalityBasesHandler));
basesMetasRoutes.post("/preview", asyncHandler(previewSeasonalityHandler));
basesMetasRoutes.post("/", asyncHandler(createSeasonalityBaseHandler));
basesMetasRoutes.put("/:id", asyncHandler(updateSeasonalityBaseHandler));
basesMetasRoutes.delete("/:id", asyncHandler(deleteSeasonalityBaseHandler));
