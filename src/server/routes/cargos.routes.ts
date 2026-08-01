import { Router } from "express";
import {
  createCargoHandler,
  deleteCargoHandler,
  listCargosHandler,
  updateCargoHandler,
} from "../controllers/cargos.controller";
import { asyncHandler } from "../utils/async-handler";

export const cargosRoutes = Router();

cargosRoutes.get("/", asyncHandler(listCargosHandler));
cargosRoutes.post("/", asyncHandler(createCargoHandler));
cargosRoutes.put("/:id", asyncHandler(updateCargoHandler));
cargosRoutes.delete("/:id", asyncHandler(deleteCargoHandler));
