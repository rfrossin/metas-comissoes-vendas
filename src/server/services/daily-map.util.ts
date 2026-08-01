import { Prisma } from "@prisma/client";

// Módulo puro (sem I/O, sem dependência de outros services) — existe para
// quebrar um ciclo de import: bases-metas.service.ts (getRealizadoDailyMap)
// e metas.service.ts (curva de Meta) precisam dos dois lados destes helpers,
// e metas.service.ts/acompanhamento.service.ts já tinham uma aresta de
// dependência que impedia colocar isso direto num dos dois arquivos.

export type DailyMap = Map<string, Prisma.Decimal>;

export function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function quarterKeyOf(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-T${quarter}`;
}

// ISO-8601: semana começa na segunda-feira; a "dona" da semana é a que
// contém a quinta-feira dessa semana (regra padrão de numeração ISO).
export function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export interface PeriodTotal {
  key: string;
  value: Prisma.Decimal;
}

export function groupDailyMapBy(daily: DailyMap, keyFn: (date: Date) => string): PeriodTotal[] {
  const totals = new Map<string, Prisma.Decimal>();

  for (const [dateKey, value] of daily) {
    const key = keyFn(new Date(`${dateKey}T00:00:00.000Z`));
    totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(value));
  }

  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => ({ key, value }));
}

export function addDailyMaps(a: DailyMap, b: DailyMap): DailyMap {
  const result: DailyMap = new Map(a);
  for (const [key, value] of b) {
    result.set(key, (result.get(key) ?? new Prisma.Decimal(0)).plus(value));
  }
  return result;
}
