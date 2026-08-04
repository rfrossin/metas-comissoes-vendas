import { describe, expect, it } from "vitest";
import { formatPhone, isValidPhone, maskPhoneInput, normalizePhone } from "./phone.util";

describe("normalizePhone", () => {
  it("remove máscara e espaços", () => {
    expect(normalizePhone("(16) 99229-6316")).toBe("16992296316");
    expect(normalizePhone("16 99229 6316")).toBe("16992296316");
    expect(normalizePhone("16.99229.6316")).toBe("16992296316");
  });

  it("remove o +55 quando sobram 11 dígitos", () => {
    expect(normalizePhone("+55 16 99229-6316")).toBe("16992296316");
    expect(normalizePhone("5516992296316")).toBe("16992296316");
  });

  it("preserva DDD 55 (RS), que não é prefixo de país aqui", () => {
    // 11 dígitos, não 13 — não entra na regra do +55.
    expect(normalizePhone("(55) 99999-1234")).toBe("55999991234");
    expect(isValidPhone("(55) 99999-1234")).toBe(true);
  });
});

describe("isValidPhone", () => {
  it("aceita celular válido", () => {
    expect(isValidPhone("(16) 99229-6316")).toBe(true);
    expect(isValidPhone("16992296316")).toBe(true);
    expect(isValidPhone("+55 (11) 98765-4321")).toBe(true);
  });

  it("rejeita telefone fixo (10 dígitos)", () => {
    expect(isValidPhone("(16) 3222-1234")).toBe(false);
  });

  it("rejeita quantidade errada de dígitos", () => {
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("992296316")).toBe(false);
    expect(isValidPhone("169922963166")).toBe(false);
  });

  it("rejeita DDD inexistente", () => {
    expect(isValidPhone("(10) 99229-6316")).toBe(false);
    expect(isValidPhone("(20) 99229-6316")).toBe(false);
    expect(isValidPhone("(00) 99229-6316")).toBe(false);
  });

  it("rejeita número sem o nono dígito 9", () => {
    expect(isValidPhone("(16) 89229-6316")).toBe(false);
  });

  it("rejeita dígitos repetidos (preenchimento de teste)", () => {
    expect(isValidPhone("(11) 99999-9999")).toBe(false);
  });
});

describe("formatPhone", () => {
  it("formata para exibição", () => {
    expect(formatPhone("16992296316")).toBe("(16) 99229-6316");
    expect(formatPhone("(16) 99229-6316")).toBe("(16) 99229-6316");
  });

  it("devolve o original quando não dá para formatar", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("1234")).toBe("1234");
  });
});

describe("maskPhoneInput", () => {
  it("formata progressivamente enquanto digita", () => {
    expect(maskPhoneInput("1")).toBe("1");
    expect(maskPhoneInput("16")).toBe("16");
    expect(maskPhoneInput("169")).toBe("(16) 9");
    expect(maskPhoneInput("1699229")).toBe("(16) 99229");
    expect(maskPhoneInput("16992296316")).toBe("(16) 99229-6316");
  });

  it("ignora dígitos além do 11º", () => {
    expect(maskPhoneInput("169922963169999")).toBe("(16) 99229-6316");
  });

  it("é idempotente sobre o próprio resultado (o input remascara a cada tecla)", () => {
    expect(maskPhoneInput("(16) 99229-6316")).toBe("(16) 99229-6316");
    expect(maskPhoneInput(maskPhoneInput("169"))).toBe("(16) 9");
  });

  it("permite apagar", () => {
    // Sem esta garantia o backspace ficaria preso no ") " da máscara.
    expect(maskPhoneInput("(16")).toBe("16");
    expect(maskPhoneInput("(1")).toBe("1");
  });
});
