import { Router } from "express";
import {
  getClosingDetailHandler,
  listClosingsHandler,
  listCommercialPeriodsHandler,
  reopenClosingBulkHandler,
  reopenClosingHandler,
  saveClosingBulkHandler,
  saveClosingHandler,
  setCommercialPeriodStatusHandler,
} from "../controllers/fechamento.controller";
import { asyncHandler } from "../utils/async-handler";

export const fechamentoRoutes = Router();

// Rotas específicas de /periodos ANTES de /:memberId/:referenceMonth — senão
// o padrão genérico de 2 segmentos intercepta "/periodos/lista" tratando
// "periodos" como memberId.
fechamentoRoutes.get("/periodos/lista", asyncHandler(listCommercialPeriodsHandler));
fechamentoRoutes.put("/periodos/:referenceMonth", asyncHandler(setCommercialPeriodStatusHandler));

fechamentoRoutes.post("/list", asyncHandler(listClosingsHandler));
// PASSO 11.4: "/bulk-save" é POST de 1 segmento só — não colide com o
// padrão genérico de 2 segmentos (GET/PUT/DELETE) abaixo, mas mantido perto
// de "/list" por clareza.
fechamentoRoutes.post("/bulk-save", asyncHandler(saveClosingBulkHandler));
fechamentoRoutes.post("/bulk-reopen", asyncHandler(reopenClosingBulkHandler));
fechamentoRoutes.get("/:memberId/:referenceMonth", asyncHandler(getClosingDetailHandler));
fechamentoRoutes.put("/:memberId/:referenceMonth", asyncHandler(saveClosingHandler));
fechamentoRoutes.delete("/:memberId/:referenceMonth", asyncHandler(reopenClosingHandler));
