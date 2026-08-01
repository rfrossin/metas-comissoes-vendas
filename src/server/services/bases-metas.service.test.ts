import { describe, expect, it } from "vitest";
import { dayOfYear365 } from "./bases-metas.service";

function utc(year: number, month1based: number, day: number): Date {
  return new Date(Date.UTC(year, month1based - 1, day));
}

describe("dayOfYear365", () => {
  it("mapeia 1/jan para o dia 1 em ano comum e bissexto", () => {
    expect(dayOfYear365(utc(2025, 1, 1))).toBe(1);
    expect(dayOfYear365(utc(2024, 1, 1))).toBe(1);
  });

  it("mapeia 28/fev para o dia 59 nos dois casos", () => {
    expect(dayOfYear365(utc(2025, 2, 28))).toBe(59);
    expect(dayOfYear365(utc(2024, 2, 28))).toBe(59);
  });

  it("funde 29/fev (ano bissexto) no mesmo balde de 28/fev", () => {
    expect(dayOfYear365(utc(2024, 2, 29))).toBe(59);
  });

  it("realinha 1/mar para o dia 60 nos dois casos, mesmo com o dia bissexto a mais", () => {
    expect(dayOfYear365(utc(2025, 3, 1))).toBe(60);
    expect(dayOfYear365(utc(2024, 3, 1))).toBe(60);
  });

  it("mapeia 31/dez para o dia 365 sempre, mesmo em ano bissexto", () => {
    expect(dayOfYear365(utc(2025, 12, 31))).toBe(365);
    expect(dayOfYear365(utc(2024, 12, 31))).toBe(365);
  });

  it("mantém datas depois de março alinhadas entre anos comuns e bissextos", () => {
    expect(dayOfYear365(utc(2025, 7, 15))).toBe(dayOfYear365(utc(2024, 7, 15)));
  });
});
