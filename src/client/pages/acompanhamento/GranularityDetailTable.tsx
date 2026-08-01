import { NO_DATA_TEXT } from "./copy";
import { formatMetricValue, formatPercent, type ResultUnit } from "./format";
import type { GranularityBucketRow } from "./types";

function Row({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-t border-border">
      <td className="whitespace-nowrap px-2 py-1 font-medium text-muted-foreground">{label}</td>
      {values.map((value, index) => (
        <td key={index} className="whitespace-nowrap px-2 py-1 text-right">
          {value}
        </td>
      ))}
    </tr>
  );
}

// As 8 linhas pedidas: Períodos (cabeçalho), Realizado, Meta, %, Acumulado
// (Realizado/Meta), % Acumulado, % da Meta Total.
export function GranularityDetailTable({
  buckets,
  unit,
  formatPeriodLabel,
}: {
  buckets: GranularityBucketRow[];
  unit: ResultUnit | undefined;
  formatPeriodLabel: (key: string) => string;
}) {
  if (buckets.length === 0) {
    return <p className="text-xs text-muted-foreground">{NO_DATA_TEXT}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="whitespace-nowrap px-2 py-1">Período</th>
            {buckets.map((bucket) => (
              <th key={bucket.periodKey} className="whitespace-nowrap px-2 py-1 text-right">
                {formatPeriodLabel(bucket.periodKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Realizado" values={buckets.map((b) => formatMetricValue(b.realizado, unit))} />
          <Row label="Meta" values={buckets.map((b) => formatMetricValue(b.meta, unit))} />
          <Row label="% Realizado da Meta" values={buckets.map((b) => formatPercent(b.percentMetaPeriodo))} />
          <Row label="Realizado Acumulado" values={buckets.map((b) => formatMetricValue(b.realizadoAcumulado, unit))} />
          <Row label="Meta Acumulada" values={buckets.map((b) => formatMetricValue(b.metaAcumulada, unit))} />
          <Row label="% do Ritmo (Realizado ÷ Meta Acumulada)" values={buckets.map((b) => formatPercent(b.percentRealizadoEsperado))} />
          <Row label="% Realizado da Meta Total" values={buckets.map((b) => formatPercent(b.percentRealizadoMetaTotal))} />
        </tbody>
      </table>
    </div>
  );
}
