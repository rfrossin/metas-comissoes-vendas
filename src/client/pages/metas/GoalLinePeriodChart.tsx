import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";

export interface ChartPoint {
  label: string;
  value: number;
}

// Paleta validada do skill de dataviz (references/palette.md): série única
// azul para magnitude, aqua para o acumulado — cada uma em seu próprio
// gráfico de eixo único (nunca dois eixos-Y no mesmo gráfico).
const BAR_COLOR = "#2a78d6";
const LINE_COLOR = "#1baf7a";
const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function ValueTooltip({ active, payload, label, total }: TooltipProps<number, string> & { total: number }) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value as number;
  const percent = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-foreground">
        {formatNumber(value)} <span className="text-muted-foreground">({percent.toFixed(1)}% do total)</span>
      </p>
    </div>
  );
}

// Um par de gráficos por granularidade (Mensal/Trimestral/Diário): barras
// com o valor do período (peso único, rótulo de % do total no tooltip) e,
// logo abaixo, a linha do Acumulado — dois gráficos de eixo único em vez de
// um só com dois eixos-Y (regra do skill de dataviz: nunca dual-axis).
export function GoalLinePeriodChart({ title, data }: { title: string; data: ChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <h5 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h5>
        <p className="text-xs text-muted-foreground">Sem dados.</p>
      </div>
    );
  }

  const total = data.reduce((acc, d) => acc + d.value, 0);
  let running = 0;
  const cumulativeData = data.map((d) => {
    running += d.value;
    return { label: d.label, cumulative: running };
  });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <h5 className="text-xs font-semibold text-foreground">{title}</h5>

      <div className="h-48 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: AXIS_COLOR }}
              axisLine={{ stroke: GRID_COLOR }}
              tickLine={false}
            />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={48} />
            <Tooltip content={<ValueTooltip total={total} />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
            <Bar dataKey="value" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground">Acumulado no período</p>
      <div className="h-32 w-full">
        <ResponsiveContainer>
          <LineChart data={cumulativeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: AXIS_COLOR }}
              axisLine={{ stroke: GRID_COLOR }}
              tickLine={false}
            />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={48} />
            <Tooltip formatter={(value: number) => [formatNumber(value), "Acumulado"]} contentStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="cumulative" stroke={LINE_COLOR} strokeWidth={2} dot={{ r: 3, fill: LINE_COLOR }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
