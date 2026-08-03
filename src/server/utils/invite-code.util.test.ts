import { describe, expect, it } from "vitest";
import { generateInviteCode, normalizeInviteCode } from "./invite-code.util";

describe("generateInviteCode", () => {
  it("gera código de 10 caracteres", () => {
    expect(generateInviteCode()).toHaveLength(10);
  });

  it("nunca usa caracteres ambíguos (O, 0, I, 1)", () => {
    // 200 amostras: com alfabeto de 32, a chance de um caractere proibido
    // escapar por acaso em 2.000 sorteios é desprezível se ele não estiver
    // no alfabeto — o teste falha de imediato se alguém reintroduzir O/0/I/1.
    for (let i = 0; i < 200; i += 1) {
      expect(generateInviteCode()).not.toMatch(/[O0I1]/);
    }
  });

  it("usa apenas maiúsculas e dígitos do alfabeto definido", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateInviteCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    }
  });

  it("não repete códigos em 1.000 gerações", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInviteCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("normalizeInviteCode", () => {
  it("aceita o código como o usuário digita (minúsculo, espaços, hífens)", () => {
    // Todos representam o mesmo código: é o que a pessoa cola do WhatsApp.
    expect(normalizeInviteCode("abcde12345")).toBe("ABCDE12345");
    expect(normalizeInviteCode("  ABCDE12345  ")).toBe("ABCDE12345");
    expect(normalizeInviteCode("ABCDE-12345")).toBe("ABCDE12345");
    expect(normalizeInviteCode("ABC DE 12345")).toBe("ABCDE12345");
    expect(normalizeInviteCode("abc-de 123 45")).toBe("ABCDE12345");
  });

  it("não altera um código já normalizado", () => {
    expect(normalizeInviteCode("ABCDE12345")).toBe("ABCDE12345");
  });

  it("preserva caracteres inválidos em vez de removê-los silenciosamente", () => {
    // Normalizar é só formatação. Um código com caractere inválido deve
    // continuar inválido e falhar na busca — não virar outro código válido
    // por remoção silenciosa.
    expect(normalizeInviteCode("ABCDE1234@")).toBe("ABCDE1234@");
  });
});
