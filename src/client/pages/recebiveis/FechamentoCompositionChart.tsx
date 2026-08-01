import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import { assignEntityColors } from "@/pages/acompanhamento/entityColors";
import { formatMonthKey } from "@/pages/acompanhamento/periodLabels";
import type { FechamentoBucketSegment } from "./types";

const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface FlatRow {
  monthKey: string;
  label: string;
  [key: string]: string | number;
}

function buildFlatRows(buckets: FechamentoBucketSegment[], baseIds: string[]): FlatRow[] {
  const monthKeys = [...new Set(buckets.map((b) => b.monthKey))].sort();
  return monthKeys.map((monthKey) => {
    const row: FlatRow = { monthKey, label: formatMonthKey(monthKey) };
    for (const baseId of baseIds) {
      const fechado = buckets.find((b) => b.monthKey === monthKey && b.receivablesBaseId === baseId && b.status === "FECHADO");
      const liberado = buckets.find((b) => b.monthKey === monthKey && b.receivablesBaseId === baseId && b.status === "LIBERADO");
      row[`${baseId}__FECHADO`] = fechado ? Number(fechado.value) : 0;
      row[`${baseId}__LIBERADO`] = liberado ? Number(liberado.value) : 0;
    }
    return row;
  });
}

function ChartTooltip({
  active,
  payload,
  label,
  segmentInfo,
}: TooltipProps<number, string> & { segmentInfo: Map<string, { baseName: string; status: "FECHADO" | "LIBERADO" }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const visible = payload.filter((entry) => Number(entry.value) > 0);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-foreground">{label}</p>
      {visible.map((entry) => {
        const info = segmentInfo.get(String(entry.dataKey));
        return (
          <p key={String(entry.dataKey)} className="text-foreground">
            <span style={{ color: entry.color }}>●</span> {info?.baseName ?? String(entry.dataKey)} ({info?.status === "FECHADO" ? "Fechado" : "Aberto"}):{" "}
            {fmt(entry.value as number)}
          </p>
        );
      })}
    </div>
  );
}

// Composição de Benefícios por Fechamento (bucket mensal fixo, decisão
// confirmada com o usuário — independente da periodicidade de cada Base).
// Cor fixa por Base (identidade); Fechado sólido, Aberto com opacidade
// reduzida + borda tracejada (textura, não cor — cor continua identificando
// a Meta/Base). Previsto não entra aqui (fica só no card à parte).
export function FechamentoCompositionChart({ buckets, bases }: { buckets: FechamentoBucketSegment[]; bases: { id: string; name: string }[] }) {
  if (buckets.length === 0 || bases.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Sem Benefícios Fechados/Abertos no período filtrado.</p>
      </div>
    );
  }

  const baseIds = bases.map((b) => b.id);
  const colors = assignEntityColors(baseIds);
  const data = buildFlatRows(buckets, baseIds);

  const segmentInfo = new Map<string, { baseName: string; status: "FECHADO" | "LIBERADO" }>();
  for (const base of bases) {
    segmentInfo.set(`${base.id}__FECHADO`, { baseName: base.name, status: "FECHADO" });
    segmentInfo.set(`${base.id}__LIBERADO`, { baseName: base.name, status: "LIBERADO" });
  }

  return (
    <div className="space-y-1">
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={64} />
            <Tooltip content={<ChartTooltip segmentInfo={segmentInfo} />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              payload={bases.map((base) => ({ value: base.name, type: "square", color: colors.get(base.id) }))}
            />
            {bases.map((base) => (
              <Bar
                key={`${base.id}__FECHADO`}
                dataKey={`${base.id}__FECHADO`}
                name={`${base.name} — Fechado`}
                stackId="month"
                fill={colors.get(base.id)}
                radius={[2, 2, 0, 0]}
                maxBarSize={36}
              />
            ))}
            {bases.map((base) => (
              <Bar
                key={`${base.id}__LIBERADO`}
                dataKey={`${base.id}__LIBERADO`}
                name={`${base.name} — Aberto`}
                stackId="month"
                fill={colors.get(base.id)}
                fillOpacity={0.55}
                stroke={colors.get(base.id)}
                strokeDasharray="3 2"
                radius={[2, 2, 0, 0]}
                maxBarSize={36}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Sólido = Fechado · Tracejado = Aberto (ainda não fechado oficialmente).</p>
    </div>
  );
}
