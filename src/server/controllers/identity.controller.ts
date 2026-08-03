import type { Request, Response } from "express";
import { z } from "zod";
import { getIdentityState, signUpIdentity } from "../services/identity.service";

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome"),
  email: z.string().email(),
  // 8 caracteres: mesmo mínimo cobrado na tela de aceite de convite
  // (AceitarConvitePage) — regras divergentes entre telas confundiriam.
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres"),
});

export async function signUpIdentityHandler(req: Request, res: Response) {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Dados inválidos" });
    return;
  }

  const result = await signUpIdentity(parsed.data);
  res.status(201).json(result);
}

export async function getIdentityStateHandler(req: Request, res: Response) {
  const state = await getIdentityState(req.identity!.authUserId);
  res.json(state);
}
