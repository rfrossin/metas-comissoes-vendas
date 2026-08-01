import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonthKey } from "@/pages/acompanhamento/periodLabels";
import type { CumulativePoint } from "./types";

const FIXO_COLOR = "#4a3aa7";
const BENEFICIOS_COLOR = "#2a78d6";
const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Acumulado no Período (sempre mensal): Fixo Acumulado x Benefícios
// Acumulados (Fechado+Aberto) — compara o quanto de folha variável já
// supera/complementa o Fixo ao longo do período filtrado.
export function AcumuladoFixoBeneficiosChart({ points }: { points: CumulativePoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Sem dados.</p>
      </div>
    );
  }

  const data = points.map((point) => ({
    label: formatMonthKey(point.monthKey),
    Fixo: Number(point.fixoAcumulado),
    Benefícios: Number(point.beneficiosAcumulado),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={72} />
          <Tooltip formatter={(value: number) => fmt(value)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="Fixo" stroke={FIXO_COLOR} strokeWidth={2} dot={{ r: 4, fill: FIXO_COLOR }} />
          <Line type="monotone" dataKey="Benefícios" stroke={BENEFICIOS_COLOR} strokeWidth={2} dot={{ r: 4, fill: BENEFICIOS_COLOR }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
