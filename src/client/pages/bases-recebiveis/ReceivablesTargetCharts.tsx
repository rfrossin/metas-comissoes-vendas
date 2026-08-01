import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";

const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";
// Paleta categórica validada (skill de dataviz, references/palette.md) —
// ordem fixa, nunca ciclada por rank (azul/laranja/água/amarelo/magenta/
// verde/violeta/vermelho). Primeiro uso de gráfico multi-série no projeto —
// os gráficos existentes (GoalLinePeriodChart) só tinham série única.
const CATEGORICAL_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function StackedTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey as string} style={{ color: entry.color }}>
          {entry.name}: {formatNumber(entry.value as number)}
        </p>
      ))}
    </div>
  );
}

export interface TierLadderChartPoint {
  label: string;
  [tierKey: string]: string | number;
}

export interface TierLadderSeriesInfo {
  key: string;
  label: string;
}

// Coluna empilhada por período: 1 segmento por Degrau, altura = valor
// incremental daquele Degrau (diferença pro anterior). Mostra só a régua de
// metas (quanto seria preciso fazer) — ambiente simulado, nunca usa
// Realizado, por isso não há indicação de "batido"/"não batido" aqui.
export function TierLadderChart({ data, series }: { data: TierLadderChartPoint[]; series: TierLadderSeriesInfo[] }) {
  if (data.length === 0 || series.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem Degraus ou períodos para exibir.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-xs">
        {series.map((s, index) => (
          <span key={s.key} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<StackedTooltip />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
            {series.map((s, index) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="tiers"
                fill={CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]}
                radius={index === series.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface TriggerChartPoint {
  label: string;
  value: number;
}

function ValueTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-foreground">{formatNumber(payload[0].value as number)}</p>
    </div>
  );
}

// Valor mínimo exigido por período pra 1 Gatilho Condicional específico —
// mesma régua-alvo, sem Realizado.
export function TriggerRequirementChart({ title, data }: { title: string; data: TriggerChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <h5 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h5>
        <p className="text-xs text-muted-foreground">Sem períodos para exibir.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <h5 className="text-xs font-semibold text-foreground">{title}</h5>
      <div className="h-40 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<ValueTooltip />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
            <Bar dataKey="value" fill={CATEGORICAL_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
