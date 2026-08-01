import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LoadingState } from "./AsyncState";
import { ChartDataTable } from "./ChartDataTable";
import { NO_DATA_TEXT } from "./copy";
import { formatMetricNumber, type ResultUnit } from "./format";
import { formatMonthKey } from "./periodLabels";
import type { CumulativePoint } from "./types";

const META_COLOR = "#4a3aa7"; // violeta — distinto do azul/aqua já usados em Meta/Realizado nos outros gráficos
const REALIZADO_COLOR = "#2a78d6";
const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

// Sempre mensal, independente do seletor de granularidade da seção acima —
// Meta Acumulada x Realizado Acumulada, mês a mês, período inteiro.
export function AcumuladoChart({
  points,
  isLoading,
  unit,
}: {
  points: CumulativePoint[] | undefined;
  isLoading: boolean;
  unit: ResultUnit | undefined;
}) {
  if (isLoading) return <LoadingState />;

  if (!points || points.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">{NO_DATA_TEXT}</p>
      </div>
    );
  }

  const data = points.map((point) => ({
    label: formatMonthKey(point.monthKey),
    Meta: Number(point.metaAcumulada),
    Realizado: Number(point.realizadoAcumulada),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(value: number) => formatMetricNumber(value, unit)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="Meta" stroke={META_COLOR} strokeWidth={2} dot={{ r: 4, fill: META_COLOR }} />
          <Line type="monotone" dataKey="Realizado" stroke={REALIZADO_COLOR} strokeWidth={2} dot={{ r: 4, fill: REALIZADO_COLOR }} />
        </LineChart>
      </ResponsiveContainer>
      <ChartDataTable
        caption="Meta Acumulada x Realizado Acumulado, mês a mês"
        columns={["Mês", "Meta", "Realizado"]}
        rows={data.map((point) => [point.label, formatMetricNumber(point.Meta, unit), formatMetricNumber(point.Realizado, unit)])}
      />
    </div>
  );
}
