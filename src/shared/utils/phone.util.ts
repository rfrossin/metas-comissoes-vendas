// Celular do usuário: DDD + número, obrigatório no cadastro de qualquer
// identidade. Mora no Supabase (user_metadata.phone), ao lado de nome e
// e-mail — é dado da PESSOA, não da participação dela numa empresa, então
// não tem cópia na tabela users (que é uma linha por empresa).
//
// Guardamos SEMPRE só os dígitos ("16992296316"): máscara é assunto de
// exibição, e gravar "(16) 99229-6316" tornaria impossível comparar dois
// telefones iguais digitados com formatações diferentes.

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, 62, 63, 64, 65, 66, 67, 68, 69, // Centro-Oeste + AC/RO
  71, 73, 74, 75, 77, 79, // BA/SE
  81, 82, 83, 84, 85, 86, 87, 88, 89, // Nordeste
  91, 92, 93, 94, 95, 96, 97, 98, 99, // Norte
]);

// Tira máscara, espaço, +55 — o usuário digita como quiser. O prefixo 55
// só cai fora quando o resultado ainda tem 11 dígitos, senão um celular
// legítimo de DDD 55 (RS) viraria um número de 9 dígitos.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

// Celular brasileiro: 11 dígitos (DDD + 9 dígitos começando em 9).
// Rejeitamos fixo (10 dígitos) de propósito — o campo é "contato de
// celular", e o uso pretendido (WhatsApp, SMS) não funciona em fixo.
export function isValidPhone(raw: string): boolean {
  const digits = normalizePhone(raw);
  if (digits.length !== 11) return false;
  if (!DDDS_VALIDOS.has(Number(digits.slice(0, 2)))) return false;
  // Nono dígito: todo celular no Brasil começa com 9 depois do DDD.
  if (digits[2] !== "9") return false;
  // Todos os dígitos iguais ("11999999999") passa nas regras acima mas é
  // sempre preenchimento de teste, nunca um número real.
  if (/^(\d)\1+$/.test(digits.slice(2))) return false;
  return true;
}

// Formata para exibição: "(16) 99229-6316". Devolve o valor original se
// não for um celular válido — telas de leitura não devem quebrar por causa
// de um dado legado fora do padrão.
export function formatPhone(raw: string): string {
  const digits = normalizePhone(raw);
  if (digits.length !== 11) return raw;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

// Máscara progressiva para o input: formata enquanto a pessoa digita, sem
// exigir que o número esteja completo (formatPhone só formata o número
// inteiro). Corta o excedente para o campo não aceitar mais de 11 dígitos.
export function maskPhoneInput(raw: string): string {
  const digits = normalizePhone(raw).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}
