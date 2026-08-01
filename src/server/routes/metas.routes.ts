import { Router } from "express";
import {
  applyDailySeasonalityHandler,
  applyGoalLineHandler,
  applyGroupedGoalLineHandler,
  applyRecalculatedGoalLineHandler,
  createGoalCampaignHandler,
  deleteGoalCampaignHandler,
  deleteGoalLineHandler,
  duplicateGoalCampaignHandler,
  getGoalLineDetailHandler,
  getHistoricalResultValueHandler,
  getPreviousPeriodMonthlyValuesHandler,
  listGoalCampaignsHandler,
  listGoalLinesHandler,
  listGoalTriggersHandler,
  listMyGoalLinesHandler,
  previewGoalLineHandler,
  previewGroupedGoalLineHandler,
  previewReforecastHandler,
  saveManualGoalLineHandler,
  setGoalCampaignActiveStatusHandler,
  setGoalLineActiveStatusHandler,
  setGoalTriggersHandler,
  updateGoalCampaignHandler,
  updateGoalCampaignStatusHandler,
} from "../controllers/metas.controller";
import { asyncHandler } from "../utils/async-handler";

export const metasRoutes = Router();

metasRoutes.get("/", asyncHandler(listGoalCampaignsHandler));
metasRoutes.get("/minhas", asyncHandler(listMyGoalLinesHandler));
metasRoutes.post("/", asyncHandler(createGoalCampaignHandler));
metasRoutes.put("/:id", asyncHandler(updateGoalCampaignHandler));
metasRoutes.patch("/:id/status", asyncHandler(updateGoalCampaignStatusHandler));
metasRoutes.put("/:id/active-status", asyncHandler(setGoalCampaignActiveStatusHandler));
metasRoutes.delete("/:id", asyncHandler(deleteGoalCampaignHandler));
metasRoutes.post("/:id/duplicar", asyncHandler(duplicateGoalCampaignHandler));

// Gatilhos ficam dormentes na UI de Metas — endpoints mantidos intactos.
metasRoutes.get("/:campaignId/triggers", asyncHandler(listGoalTriggersHandler));
metasRoutes.put("/:campaignId/triggers", asyncHandler(setGoalTriggersHandler));

metasRoutes.get("/:campaignId/lines", asyncHandler(listGoalLinesHandler));
metasRoutes.post("/:campaignId/lines/preview", asyncHandler(previewGoalLineHandler));
metasRoutes.post("/:campaignId/lines/apply", asyncHandler(applyGoalLineHandler));
metasRoutes.post("/:campaignId/lines/manual", asyncHandler(saveManualGoalLineHandler));
metasRoutes.post("/:campaignId/lines/group/preview", asyncHandler(previewGroupedGoalLineHandler));
metasRoutes.post("/:campaignId/lines/group/apply", asyncHandler(applyGroupedGoalLineHandler));
metasRoutes.post("/:campaignId/historical-value", asyncHandler(getHistoricalResultValueHandler));
metasRoutes.get("/:campaignId/previous-period-values", asyncHandler(getPreviousPeriodMonthlyValuesHandler));
metasRoutes.delete("/lines/:id", asyncHandler(deleteGoalLineHandler));
metasRoutes.put("/lines/:id/active-status", asyncHandler(setGoalLineActiveStatusHandler));

metasRoutes.get("/:campaignId/linha/:entityType/:entityId", asyncHandler(getGoalLineDetailHandler));

metasRoutes.post("/lines/:lineId/reforecast/preview", asyncHandler(previewReforecastHandler));
metasRoutes.post("/lines/:lineId/reforecast/apply", asyncHandler(applyRecalculatedGoalLineHandler));
metasRoutes.put("/lines/:lineId/daily-seasonality", asyncHandler(applyDailySeasonalityHandler));
