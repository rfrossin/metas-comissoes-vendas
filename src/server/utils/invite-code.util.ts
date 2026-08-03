import crypto from "node:crypto";

// Sem O/0/I/1: este código é ditado por telefone, colado em WhatsApp e
// digitado à mão pelo colaborador — os pares confundíveis viram suporte.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

// randomInt (CSPRNG) em vez de Math.random: quem conhece o código entra na
// fila de acesso da empresa, então adivinhá-lo tem valor. Math.random é
// previsível e não serve para nada com consequência de acesso.
//
// 32^10 ≈ 1,1e15 combinações — palpite cego é inviável. Ainda assim o
// código só CRIA um pedido pendente; quem libera de fato é o Admin.
export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

// O usuário digita o código como conseguir: minúsculo, com espaço, com
// hífen. Normalizamos antes de comparar para não rejeitar um código certo
// por causa de formatação.
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}
