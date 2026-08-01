import { Router } from "express";
import {
  getComparativoSeriesHandler,
  getCumulativeSeriesHandler,
  getHierarchyChildrenHandler,
  getOverviewHandler,
  getRecalculatedMetaSeriesHandler,
  listAvailableCampaignsHandler,
} from "../controllers/acompanhamento.controller";
import { asyncHandler } from "../utils/async-handler";

export const acompanhamentoRoutes = Router();

acompanhamentoRoutes.get("/campanhas-disponiveis", asyncHandler(listAvailableCampaignsHandler));
acompanhamentoRoutes.post("/overview", asyncHandler(getOverviewHandler));
acompanhamentoRoutes.post("/acumulado", asyncHandler(getCumulativeSeriesHandler));
acompanhamentoRoutes.post("/comparativo", asyncHandler(getComparativoSeriesHandler));
acompanhamentoRoutes.post("/recalculada", asyncHandler(getRecalculatedMetaSeriesHandler));
acompanhamentoRoutes.post("/hierarquia/filhos", asyncHandler(getHierarchyChildrenHandler));
