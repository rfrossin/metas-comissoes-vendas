export type ResultUnit = "MOEDA" | "NUMERAL";

// Valores chegam do servidor como string (Prisma.Decimal serializado) — nunca
// convertidos para float além do necessário para exibição. Formatação leva
// em conta a unidade do Tipo de Resultado selecionado (R$ para MOEDA, número
// puro para NUMERAL); antes disso todo valor era exibido igual, ambíguo.
export function formatMetricValue(value: string | number, unit: ResultUnit | undefined): string {
  const amount = Number(value);
  if (unit === "MOEDA") {
    return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
  }
  return amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

// Versão sem casas decimais para eixos/tooltips de gráfico, onde precisão
// visual importa menos que legibilidade.
export function formatMetricNumber(value: number, unit: ResultUnit | undefined): string {
  if (unit === "MOEDA") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatPercent(value: string | null): string {
  if (value === null) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}
