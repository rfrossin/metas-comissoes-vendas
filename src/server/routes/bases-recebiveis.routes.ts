import { Router } from "express";
import {
  createReceivablesBaseHandler,
  deleteReceivablesBaseHandler,
  duplicateReceivablesBaseHandler,
  getMyReceivablesBaseDetailHandler,
  getReceivablesBaseDetailForBeneficiaryHandler,
  getReceivablesBaseDetailHandler,
  listMyReceivablesBasesHandler,
  listReceivablesBasesHandler,
  setBeneficiariesHandler,
  setConditionalTriggersHandler,
  setReceivablesBaseStatusHandler,
  setTierLadderHandler,
  simulateReceivablesBaseHandler,
  updateReceivablesBaseHandler,
} from "../controllers/bases-recebiveis.controller";
import { asyncHandler } from "../utils/async-handler";

export const basesRecebiveisRoutes = Router();

basesRecebiveisRoutes.get("/", asyncHandler(listReceivablesBasesHandler));
basesRecebiveisRoutes.post("/", asyncHandler(createReceivablesBaseHandler));
// Precisa vir ANTES de "/:id" — senão o Express casaria "/minhas" como um id.
basesRecebiveisRoutes.get("/minhas", asyncHandler(listMyReceivablesBasesHandler));
basesRecebiveisRoutes.get("/minhas/:id/graficos", asyncHandler(getMyReceivablesBaseDetailHandler));
basesRecebiveisRoutes.get("/:id", asyncHandler(getReceivablesBaseDetailHandler));
basesRecebiveisRoutes.get("/:id/beneficiario/:memberId/graficos", asyncHandler(getReceivablesBaseDetailForBeneficiaryHandler));
basesRecebiveisRoutes.put("/:id", asyncHandler(updateReceivablesBaseHandler));
basesRecebiveisRoutes.patch("/:id/status", asyncHandler(setReceivablesBaseStatusHandler));
basesRecebiveisRoutes.delete("/:id", asyncHandler(deleteReceivablesBaseHandler));
basesRecebiveisRoutes.post("/:id/duplicar", asyncHandler(duplicateReceivablesBaseHandler));

basesRecebiveisRoutes.put("/:id/beneficiarios", asyncHandler(setBeneficiariesHandler));
basesRecebiveisRoutes.put("/:id/gatilhos-condicionais", asyncHandler(setConditionalTriggersHandler));
basesRecebiveisRoutes.put("/:id/degraus", asyncHandler(setTierLadderHandler));
basesRecebiveisRoutes.post("/:id/simular", asyncHandler(simulateReceivablesBaseHandler));
