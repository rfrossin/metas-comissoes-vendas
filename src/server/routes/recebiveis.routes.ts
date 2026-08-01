import { Router } from "express";
import { getMemberGanhoPorMetaHandler, getReceivablesOverviewHandler } from "../controllers/recebiveis.controller";
import { asyncHandler } from "../utils/async-handler";

export const recebiveisRoutes = Router();

recebiveisRoutes.post("/overview", asyncHandler(getReceivablesOverviewHandler));
recebiveisRoutes.post("/membro/:memberId/ganho-por-meta", asyncHandler(getMemberGanhoPorMetaHandler));
