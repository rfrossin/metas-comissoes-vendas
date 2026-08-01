import type { Request, Response } from "express";
import { z } from "zod";
import { createCargo, deleteCargo, listCargos, updateCargo } from "../services/cargos.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

const cargoSchema = z.object({
  name: z.string().min(1),
  defaultFixedSalary: z.number().nonnegative(),
  permissionLevel: z.enum(["OPERACIONAL", "LIDERANCA_NO", "ADMINISTRADOR"]),
});

function respondToError(error: unknown, res: Response) {
  if (error instanceof NotFoundError) {
    res.status(404).json({ message: error.message });
    return;
  }

  if (error instanceof ConflictError) {
    res.status(409).json({ message: error.message });
    return;
  }

  if (error instanceof ForbiddenError) {
    res.status(403).json({ message: error.message });
    return;
  }

  throw error;
}

export async function listCargosHandler(req: Request, res: Response) {
  const cargos = await listCargos(req.user!.companyId);
  res.json(cargos);
}

export async function createCargoHandler(req: Request, res: Response) {
  const parsed = cargoSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const cargo = await createCargo(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(cargo);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateCargoHandler(req: Request, res: Response) {
  const parsed = cargoSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const cargo = await updateCargo(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(cargo);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteCargoHandler(req: Request, res: Response) {
  try {
    await deleteCargo(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}
