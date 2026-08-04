import { z } from "zod";
import { isValidPhone, normalizePhone } from "@shared/utils/phone.util";

// Um único schema para todos os pontos de entrada do celular (cadastro,
// aceite de convite, edição de "Meus dados"). Centralizado de propósito: se
// cada rota escrevesse a própria regra, o campo obrigatório numa tela seria
// opcional em outra e a garantia de "todo usuário tem celular" cairia.
//
// O transform devolve só os dígitos, então o service sempre recebe o
// formato canônico independentemente de como a tela mandou.
export const phoneSchema = z
  .string({ required_error: "Informe seu celular com DDD" })
  .trim()
  .min(1, "Informe seu celular com DDD")
  .refine(isValidPhone, "Informe um celular válido com DDD, ex.: (16) 99229-6316")
  .transform(normalizePhone);
