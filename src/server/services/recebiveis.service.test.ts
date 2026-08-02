import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  resolveMonthlyFixedSalary,
  resolveWindowStatus,
  windowSnapshotKey,
  type ClosingSnapshotContext,
  type MemberLite,
} from "./recebiveis.service";

// Nota: computeMemberReceivablesRows/getReceivablesOverview fazem muitas
// queries Prisma (Member, ReceivablesBeneficiary, ReceivablesBase,
// MemberClosing+snapshots) — cobertura de ponta a ponta pertence à suíte de
// integração (src/**/*.integration.test.ts, exige Supabase local via
// `supabase start`). Aqui cobrimos as funções PURAS que decidem
// live-vs-congelado, que é onde um erro de lógica na regra "Fixo e
// Benefícios de um mês fechado vêm do snapshot" passaria despercebido.

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function emptyContext(): ClosingSnapshotContext {
  return { closingByMemberMonth: new Map(), snapshotByWindowKey: new Map() };
}

function member(overrides: Partial<MemberLite> = {}): MemberLite {
  return {
    id: "member-1",
    fullName: "João",
    customFixedSalary: null,
    cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(4000) },
    ...overrides,
  };
}

describe("resolveWindowStatus — decide PREVISTO/LIBERADO/FECHADO de uma janela", () => {
  const referenceDate = utc("2026-03-15");

  it("janela ainda em andamento (termina depois de hoje) é sempre PREVISTO, mesmo com snapshot", () => {
    const window = { start: utc("2026-03-01"), endExclusive: utc("2026-04-01") };
    expect(resolveWindowStatus(window, referenceDate, true)).toBe("PREVISTO");
    expect(resolveWindowStatus(window, referenceDate, false)).toBe("PREVISTO");
  });

  it("janela encerrada COM snapshot (MemberClosing salvo) é FECHADO", () => {
    const window = { start: utc("2026-02-01"), endExclusive: utc("2026-03-01") };
    expect(resolveWindowStatus(window, referenceDate, true)).toBe("FECHADO");
  });

  it("janela encerrada SEM snapshot (mês terminou, ninguém fechou) é LIBERADO", () => {
    const window = { start: utc("2026-02-01"), endExclusive: utc("2026-03-01") };
    expect(resolveWindowStatus(window, referenceDate, false)).toBe("LIBERADO");
  });
});

describe("windowSnapshotKey — chave de lookup do snapshot por janela", () => {
  it("chaves distintas para o mesmo período com memberId diferente", () => {
    const start = utc("2026-01-01");
    expect(windowSnapshotKey("member-a", "base-1", start)).not.toBe(windowSnapshotKey("member-b", "base-1", start));
  });

  it("chaves distintas para o mesmo Membro+período com Base diferente (Beneficiário em 2 Bases)", () => {
    const start = utc("2026-01-01");
    expect(windowSnapshotKey("member-a", "base-1", start)).not.toBe(windowSnapshotKey("member-a", "base-2", start));
  });

  it("chaves distintas para janelas semanais diferentes da mesma Base/Membro no mesmo mês", () => {
    expect(windowSnapshotKey("member-a", "base-1", utc("2026-01-05"))).not.toBe(windowSnapshotKey("member-a", "base-1", utc("2026-01-12")));
  });

  it("mesma tripla (Membro, Base, periodStart) sempre gera a mesma chave — grava e lê batem", () => {
    const start = utc("2026-01-05");
    expect(windowSnapshotKey("member-a", "base-1", start)).toBe(windowSnapshotKey("member-a", "base-1", start));
  });
});

describe("resolveMonthlyFixedSalary — Fixo congelado no Fechamento vs. ao vivo", () => {
  it("mês SEM MemberClosing salvo: usa o Fixo ao vivo do Cargo (Cargo.defaultFixedSalary)", () => {
    const m = member({ cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(4000) } });
    const value = resolveMonthlyFixedSalary(m, "2026-03", emptyContext());
    expect(value.toString()).toBe("4000");
  });

  it("mês SEM MemberClosing salvo, com customFixedSalary: usa o Fixo individual do Membro", () => {
    const m = member({ customFixedSalary: new Prisma.Decimal(5500), cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(4000) } });
    const value = resolveMonthlyFixedSalary(m, "2026-03", emptyContext());
    expect(value.toString()).toBe("5500");
  });

  it("mês COM MemberClosing salvo: usa o valor CONGELADO, ignora o Cargo atual — cenário do usuário (fechou Jan=3000, Cargo virou 4000 em Março)", () => {
    const m = member({ cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(4000) } });
    const context: ClosingSnapshotContext = {
      closingByMemberMonth: new Map([[`${m.id}|2026-01`, { fixedSalarySnapshot: new Prisma.Decimal(3000) }]]),
      snapshotByWindowKey: new Map(),
    };
    const januaryValue = resolveMonthlyFixedSalary(m, "2026-01", context);
    expect(januaryValue.toString()).toBe("3000");
  });

  it("range com mês fechado e mês aberto: cada mês usa sua própria fonte, sem contaminar o outro", () => {
    const m = member({ cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(4000) } });
    const context: ClosingSnapshotContext = {
      closingByMemberMonth: new Map([[`${m.id}|2026-01`, { fixedSalarySnapshot: new Prisma.Decimal(3000) }]]),
      snapshotByWindowKey: new Map(),
    };
    expect(resolveMonthlyFixedSalary(m, "2026-01", context).toString()).toBe("3000"); // congelado
    expect(resolveMonthlyFixedSalary(m, "2026-03", context).toString()).toBe("4000"); // ao vivo, Cargo já aumentado
  });

  it("Membro sem Cargo e sem snapshot: Fixo é zero (não quebra)", () => {
    const m = member({ cargo: null });
    const value = resolveMonthlyFixedSalary(m, "2026-01", emptyContext());
    expect(value.toString()).toBe("0");
  });
});
