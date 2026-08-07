import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  monthBucketOfWindow,
  monthOverlapsEmployment,
  overlapsEmployment,
  resolveMonthlyFixedSalary,
  resolveMonthlyManualAdjustment,
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

function closedMonth(memberId: string, monthKey: string, fixed: number, adjustment = 0): ClosingSnapshotContext {
  return {
    closingByMemberMonth: new Map([
      [`${memberId}|${monthKey}`, { fixedSalarySnapshot: new Prisma.Decimal(fixed), manualAdjustmentValue: new Prisma.Decimal(adjustment) }],
    ]),
    snapshotByWindowKey: new Map(),
  };
}

function member(overrides: Partial<MemberLite> = {}): MemberLite {
  return {
    id: "member-1",
    fullName: "João",
    customFixedSalary: null,
    entryDate: null,
    exitDate: null,
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
    const januaryValue = resolveMonthlyFixedSalary(m, "2026-01", closedMonth(m.id, "2026-01", 3000));
    expect(januaryValue.toString()).toBe("3000");
  });

  it("range com mês fechado e mês aberto: cada mês usa sua própria fonte, sem contaminar o outro", () => {
    const m = member({ cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(4000) } });
    const context = closedMonth(m.id, "2026-01", 3000);
    expect(resolveMonthlyFixedSalary(m, "2026-01", context).toString()).toBe("3000"); // congelado
    expect(resolveMonthlyFixedSalary(m, "2026-03", context).toString()).toBe("4000"); // ao vivo, Cargo já aumentado
  });

  it("Membro sem Cargo e sem snapshot: Fixo é zero (não quebra)", () => {
    const m = member({ cargo: null });
    const value = resolveMonthlyFixedSalary(m, "2026-01", emptyContext());
    expect(value.toString()).toBe("0");
  });
});

// Regra confirmada com o usuário (2026-08-07): sempre que existe Fechamento
// validado, ele SOBREPÕE o cálculo de Recebíveis daquele período — alterar
// hoje o Fixo de um Cargo/Membro ou a regra de uma Base não pode mexer no
// passado já fechado.
describe("resolveMonthlyManualAdjustment — Valor Adicional do Fechamento", () => {
  it("mês fechado com Valor Adicional: Recebíveis enxerga o mesmo valor lançado no Fechamento", () => {
    const context = closedMonth("member-1", "2026-06", 2000, 100);
    expect(resolveMonthlyManualAdjustment("member-1", "2026-06", context).toString()).toBe("100");
  });

  it("mês fechado sem Valor Adicional: zero", () => {
    const context = closedMonth("member-1", "2026-06", 2000);
    expect(resolveMonthlyManualAdjustment("member-1", "2026-06", context).toString()).toBe("0");
  });

  it("mês NÃO fechado: zero (nada a sobrepor, o cálculo ao vivo manda)", () => {
    expect(resolveMonthlyManualAdjustment("member-1", "2026-06", emptyContext()).toString()).toBe("0");
  });

  it("Valor Adicional negativo (desconto) é preservado com o sinal", () => {
    const context = closedMonth("member-1", "2026-06", 2000, -250);
    expect(resolveMonthlyManualAdjustment("member-1", "2026-06", context).toString()).toBe("-250");
  });

  it("não vaza entre Membros: o Adicional de um não conta para o outro", () => {
    const context = closedMonth("member-1", "2026-06", 2000, 100);
    expect(resolveMonthlyManualAdjustment("member-2", "2026-06", context).toString()).toBe("0");
  });

  it("cenário da Ana: Fixo NÃO é somado em meses anteriores à data de entrada", () => {
    // Entrada em JAN/2025 — Recebíveis não pode mostrar Fixo em 2024.
    const ana = member({ entryDate: utc("2025-01-01") });

    expect(monthOverlapsEmployment(ana, "2024-11")).toBe(false);
    expect(monthOverlapsEmployment(ana, "2024-12")).toBe(false);
    expect(monthOverlapsEmployment(ana, "2025-01")).toBe(true);
    expect(monthOverlapsEmployment(ana, "2025-02")).toBe(true);
  });

  it("Fixo não é somado em meses posteriores à saída", () => {
    const m = member({ entryDate: utc("2025-01-01"), exitDate: utc("2025-06-30") });

    expect(monthOverlapsEmployment(m, "2025-06")).toBe(true);
    expect(monthOverlapsEmployment(m, "2025-07")).toBe(false);
  });

  it("mês da própria admissão conta, mesmo com entrada no fim do mês", () => {
    const m = member({ entryDate: utc("2025-01-31") });
    expect(monthOverlapsEmployment(m, "2025-01")).toBe(true);
  });

  it("Membro sem datas de vínculo conta em qualquer mês", () => {
    expect(monthOverlapsEmployment(member(), "2020-01")).toBe(true);
  });

  it("cenário do usuário: Fechamento de Junho (Fixo 2.000 + Adicional) vence o Cargo atual de 3.000", () => {
    const m = member({ cargo: { id: "cargo-1", name: "Vendedor", defaultFixedSalary: new Prisma.Decimal(3000) } });
    const context = closedMonth(m.id, "2026-06", 2000, 100);

    expect(resolveMonthlyFixedSalary(m, "2026-06", context).toString()).toBe("2000");
    expect(resolveMonthlyManualAdjustment(m.id, "2026-06", context).toString()).toBe("100");
    // Julho segue em aberto: volta a valer o Cargo vigente.
    expect(resolveMonthlyFixedSalary(m, "2026-07", context).toString()).toBe("3000");
  });
});

// Regra confirmada com o usuário (2026-08-06): o Membro só tem Recebíveis e
// Fechamentos entre a data de ENTRADA e a de SAÍDA da empresa.
describe("overlapsEmployment — vínculo empregatício delimita Recebíveis/Fechamentos", () => {
  const marco = { start: utc("2026-03-01"), endExclusive: utc("2026-04-01") };

  it("Membro sem entrada nem saída (vínculo aberto dos dois lados) entra em qualquer período", () => {
    expect(overlapsEmployment(member(), marco.start, marco.endExclusive)).toBe(true);
  });

  it("mês ANTERIOR à entrada não conta — o Membro ainda não tinha sido admitido", () => {
    const m = member({ entryDate: utc("2026-05-10") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(false);
  });

  it("mês POSTERIOR à saída não conta — o Membro já havia sido desligado", () => {
    const m = member({ exitDate: utc("2026-01-31") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(false);
  });

  it("mês em que o Membro foi admitido no meio conta (interseção parcial)", () => {
    const m = member({ entryDate: utc("2026-03-20") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(true);
  });

  it("mês em que o Membro foi desligado no meio conta (interseção parcial)", () => {
    const m = member({ exitDate: utc("2026-03-10") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(true);
  });

  it("admissão no ÚLTIMO dia do período conta — trabalhou o dia da entrada", () => {
    const m = member({ entryDate: utc("2026-03-31") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(true);
  });

  it("desligamento no PRIMEIRO dia do período conta — trabalhou o dia da saída", () => {
    const m = member({ exitDate: utc("2026-03-01") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(true);
  });

  it("admissão no primeiro dia do mês SEGUINTE não conta (fronteira exclusiva)", () => {
    const m = member({ entryDate: utc("2026-04-01") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(false);
  });

  it("vínculo que cobre o período inteiro (entrou antes, saiu depois) conta", () => {
    const m = member({ entryDate: utc("2025-06-01"), exitDate: utc("2026-12-31") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(true);
  });

  it("passagem curta inteiramente dentro do período conta", () => {
    const m = member({ entryDate: utc("2026-03-05"), exitDate: utc("2026-03-15") });
    expect(overlapsEmployment(m, marco.start, marco.endExclusive)).toBe(true);
  });
});

// Existindo Fechamento para o mês, ele sobrepõe o cálculo daquele período.
// A trava usa o mês em que a janela TERMINA para decidir a qual Fechamento
// ela pertence — é o mesmo critério de agrupamento do Fechamento.
describe("monthBucketOfWindow — a qual mês (e portanto a qual Fechamento) a janela pertence", () => {
  it("janela mensal pertence ao próprio mês", () => {
    expect(monthBucketOfWindow(utc("2025-02-01")).toISOString().slice(0, 7)).toBe("2025-01");
  });

  it("janela trimestral pertence ao mês em que TERMINA", () => {
    // Jan→Mar: pertence a Março, não a Janeiro.
    expect(monthBucketOfWindow(utc("2025-04-01")).toISOString().slice(0, 7)).toBe("2025-03");
  });

  it("janela semanal que atravessa a virada do mês pertence ao mês do último dia", () => {
    // 29/01 a 04/02 (fim exclusivo 05/02) — último dia é 04/02, então Fev.
    expect(monthBucketOfWindow(utc("2025-02-05")).toISOString().slice(0, 7)).toBe("2025-02");
  });
});
