import { Router } from "express";
import multer from "multer";
import {
  bulkDeleteResultsHandler,
  bulkUpdateResultsHandler,
  createOperationalAdjustmentHandler,
  createResultEntryHandler,
  createResultTypeHandler,
  deleteOperationalAdjustmentHandler,
  deleteResultEntryHandler,
  deleteResultTypeHandler,
  getRealizadoLiquidoSummaryHandler,
  listAllResultsHandler,
  listOperationalAdjustmentsHandler,
  listResultEntriesHandler,
  listResultTypesHandler,
  updateResultEntryHandler,
  updateResultTypeHandler,
} from "../controllers/resultados.controller";
import {
  resultsBulkImportCommitHandler,
  resultsBulkImportPreviewHandler,
} from "../controllers/resultados-bulk-import.controller";
import { asyncHandler } from "../utils/async-handler";
import { spreadsheetFileFilter } from "../utils/spreadsheet-file-filter";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: spreadsheetFileFilter,
});

export const resultadosRoutes = Router();

resultadosRoutes.get("/types", asyncHandler(listResultTypesHandler));
resultadosRoutes.post("/types", asyncHandler(createResultTypeHandler));
resultadosRoutes.put("/types/:id", asyncHandler(updateResultTypeHandler));
resultadosRoutes.delete("/types/:id", asyncHandler(deleteResultTypeHandler));

resultadosRoutes.get("/entries", asyncHandler(listResultEntriesHandler));
resultadosRoutes.post("/entries", asyncHandler(createResultEntryHandler));
resultadosRoutes.put("/entries/:id", asyncHandler(updateResultEntryHandler));
resultadosRoutes.delete("/entries/:id", asyncHandler(deleteResultEntryHandler));

resultadosRoutes.get("/adjustments", asyncHandler(listOperationalAdjustmentsHandler));
resultadosRoutes.post("/adjustments", asyncHandler(createOperationalAdjustmentHandler));
resultadosRoutes.delete("/adjustments/:id", asyncHandler(deleteOperationalAdjustmentHandler));

resultadosRoutes.get("/summary", asyncHandler(getRealizadoLiquidoSummaryHandler));

resultadosRoutes.get("/all", asyncHandler(listAllResultsHandler));
resultadosRoutes.post("/bulk-delete", asyncHandler(bulkDeleteResultsHandler));
resultadosRoutes.post("/bulk-update", asyncHandler(bulkUpdateResultsHandler));

resultadosRoutes.post(
  "/bulk-import/preview",
  upload.single("file"),
  asyncHandler(resultsBulkImportPreviewHandler),
);
resultadosRoutes.post("/bulk-import/commit", asyncHandler(resultsBulkImportCommitHandler));
