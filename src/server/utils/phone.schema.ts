import { z } from "zod";
// Import relativo, não o alias "@shared/*": aquele só existe em compile-time
// (tsc reescreve tipos, não o require() emitido). O backend roda como
// CommonJS puro em produção, sem tsconfig-paths/module-alias registrado —
// um require("@shared/...") no JS compilado falha com MODULE_NOT_FOUND e
// derruba o processo assim que este arquivo é importado (foi exatamente
// isto que causou o 502 em produção em 04/08/2026: identity.controller.ts
// importa phone.schema.ts logo no bootstrap do app, então o crash acontecia
// antes do servidor sequer começar a escutar).
import { isValidPhone, normalizePhone } from "../../shared/utils/phone.util";

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
