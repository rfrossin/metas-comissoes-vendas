import type { Granularity } from "./types";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function formatMonthKey(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_LABELS[Number(month) - 1]}/${year}`;
}

export function monthNumberLabel(monthNumber: number): string {
  return MONTH_LABELS[monthNumber - 1];
}

// Rótulo de coluna por granularidade — as chaves batem com o formato gerado
// no servidor (isoKey/isoWeekKey/monthKeyOf/quarterKeyOf, metas.service.ts).
export function formatPeriodLabel(key: string, granularity: Granularity): string {
  switch (granularity) {
    case "DIA": {
      const [, month, day] = key.split("-");
      return `${day}/${month}`;
    }
    case "SEMANA": {
      const [year, week] = key.split("-W");
      return `Sem ${week}/${year}`;
    }
    case "MES":
      return formatMonthKey(key);
    case "TRIMESTRE": {
      const [year, quarter] = key.split("-T");
      return `T${quarter}/${year}`;
    }
  }
}
