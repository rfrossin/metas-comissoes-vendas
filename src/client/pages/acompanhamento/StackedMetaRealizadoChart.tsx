import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import { NO_DATA_TEXT } from "./copy";
import { assignEntityColors } from "./entityColors";
import { formatMetricNumber, type ResultUnit } from "./format";
import type { GranularityBucketRow } from "./types";

const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

interface FlatRow {
  periodKey: string;
  periodLabel: string;
  [key: string]: string | number;
}

function buildFlatRows(buckets: GranularityBucketRow[], entityIds: string[], formatPeriodLabel: (key: string) => string): FlatRow[] {
  return buckets.map((bucket) => {
    const row: FlatRow = { periodKey: bucket.periodKey, periodLabel: formatPeriodLabel(bucket.periodKey) };
    entityIds.forEach((id) => {
      const entry = bucket.byEntity.find((e) => e.entityId === id);
      row[`meta__${id}`] = Number(entry?.meta ?? 0);
      row[`real__${id}`] = Number(entry?.realizado ?? 0);
    });
    return row;
  });
}

function ChartTooltip({
  active,
  payload,
  label,
  entityLabels,
  unit,
}: TooltipProps<number, string> & { entityLabels: Map<string, string>; unit: ResultUnit | undefined }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="text-foreground">
          <span style={{ color: entry.color }}>●</span> {entityLabels.get(String(entry.dataKey)) ?? String(entry.dataKey)}:{" "}
          {formatMetricNumber(entry.value as number, unit)}
        </p>
      ))}
    </div>
  );
}

// Coluna "Meta" (empilhada, 1 segmento por entidade) ao lado da coluna
// "Realizado" (mesma cor por entidade nas duas colunas — Meta com opacidade
// reduzida, Realizado com opacidade cheia — identidade vem da cor, ritmo
// planejado x entregue vem da opacidade).
export function StackedMetaRealizadoChart({
  buckets,
  entities,
  unit,
  formatPeriodLabel,
}: {
  buckets: GranularityBucketRow[];
  entities: { entityId: string; label: string }[];
  unit: ResultUnit | undefined;
  formatPeriodLabel: (key: string) => string;
}) {
  if (buckets.length === 0 || entities.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">{NO_DATA_TEXT}</p>
      </div>
    );
  }

  const entityIds = entities.map((e) => e.entityId);
  const colors = assignEntityColors(entityIds);
  const data = buildFlatRows(buckets, entityIds, formatPeriodLabel);

  const entityLabelsByKey = new Map<string, string>();
  entities.forEach((e) => {
    entityLabelsByKey.set(`meta__${e.entityId}`, `${e.label} — Meta`);
    entityLabelsByKey.set(`real__${e.entityId}`, `${e.label} — Realizado`);
  });

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="periodLabel" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<ChartTooltip entityLabels={entityLabelsByKey} unit={unit} />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {entities.map((e) => (
            <Bar
              key={`meta__${e.entityId}`}
              dataKey={`meta__${e.entityId}`}
              name={`${e.label} — Meta`}
              stackId="meta"
              fill={colors.get(e.entityId)}
              fillOpacity={0.45}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          ))}
          {entities.map((e) => (
            <Bar
              key={`real__${e.entityId}`}
              dataKey={`real__${e.entityId}`}
              name={`${e.label} — Realizado`}
              stackId="realizado"
              fill={colors.get(e.entityId)}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
