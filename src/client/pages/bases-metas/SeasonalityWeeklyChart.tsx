import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface WeightPoint {
  referenceKey: number;
  weight: number;
}

interface SeasonalityWeeklyChartProps {
  weights: WeightPoint[];
  labels: Record<number, string>;
  // Baldes densos (ex.: Diário do Ano, 365 pontos) — thina os rótulos do
  // eixo X pra não sobrepor texto; 0 (padrão) mostra todos os baldes.
  tickInterval?: number;
}

export function SeasonalityWeeklyChart({ weights, labels, tickInterval = 0 }: SeasonalityWeeklyChartProps) {
  const data = weights
    .slice()
    .sort((a, b) => a.referenceKey - b.referenceKey)
    .map((point) => ({
      bucket: labels[point.referenceKey] ?? String(point.referenceKey),
      percentage: Number((point.weight * 100).toFixed(2)),
    }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="1 0" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            unit="%"
            width={40}
          />
          <Tooltip
            formatter={(value: number) => [`${value}%`, "Peso"]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            cursor={{ fill: "hsl(var(--secondary))" }}
          />
          <Bar dataKey="percentage" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
