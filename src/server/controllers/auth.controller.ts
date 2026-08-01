import type { Request, Response } from "express";
import { z } from "zod";
import { login, chooseCompany, switchCompany, listMyCompanies } from "../services/auth.service";
import { UnauthorizedError } from "../utils/http-errors";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginHandler(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const result = await login(parsed.data);
    res.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ message: error.message });
      return;
    }

    throw error;
  }
}

const chooseCompanySchema = z.object({
  preAuthToken: z.string().min(1),
  companyId: z.string().min(1),
});

export async function chooseCompanyHandler(req: Request, res: Response) {
  const parsed = chooseCompanySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const result = await chooseCompany(parsed.data.preAuthToken, parsed.data.companyId);
    res.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ message: error.message });
      return;
    }

    throw error;
  }
}

const switchCompanySchema = z.object({
  companyId: z.string().min(1),
});

export async function switchCompanyHandler(req: Request, res: Response) {
  const parsed = switchCompanySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const result = await switchCompany(req.user!.id, parsed.data.companyId);
    res.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(401).json({ message: error.message });
      return;
    }

    throw error;
  }
}

export async function myCompaniesHandler(req: Request, res: Response) {
  const memberships = await listMyCompanies(req.user!.id);
  res.json(memberships);
}
