import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LoadingState } from "./AsyncState";
import { ChartDataTable } from "./ChartDataTable";
import { formatMetricNumber, type ResultUnit } from "./format";
import { formatMonthKey } from "./periodLabels";
import type { RecalculatedPoint } from "./types";

const META_ORIGINAL_COLOR = "#4a3aa7"; // violeta — mesma cor do Meta do Acumulado, por consistência
// Vermelho evitado de propósito (era #e34948 antes): no resto do app,
// vermelho só significa "destructive"/erro/atrás do ritmo (token
// --destructive). O ajuste recalculado pode ficar ACIMA da meta original
// (boa notícia) tanto quanto abaixo — colorir de vermelho sempre soaria como
// alarme falso quando o ajuste for favorável. Amarelo (slot 4 da paleta
// categórica) chama atenção sem carregar julgamento de direção.
const META_RECALCULADA_COLOR = "#eda100"; // amarelo — neutro quanto à direção do ajuste
const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

// Só os meses estritamente APÓS "Realizado até" — Meta Original x
// Meta Recalculada (saldo necessário para fechar exatamente o Total
// original da Meta do Período, redistribuído respeitando a proporção
// original entre os meses restantes). Pode ficar acima OU abaixo da Meta
// Original dependendo se está atrás ou à frente do ritmo.
//
// "Original" (não "Atual") para não colidir com o sentido de "Atual" usado
// em ComparativoChart (período filtrado hoje) — aqui o contraste é
// original-vs-recalculada, não presente-vs-histórico.
export function RecalculadaChart({
  points,
  isLoading,
  unit,
}: {
  points: RecalculatedPoint[] | undefined;
  isLoading: boolean;
  unit: ResultUnit | undefined;
}) {
  if (isLoading) return <LoadingState />;

  if (!points || points.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Sem meses restantes após "Realizado Até" neste período.</p>
      </div>
    );
  }

  const data = points.map((point) => ({
    label: formatMonthKey(point.monthKey),
    "Meta Original": Number(point.metaAtual),
    "Meta Recalculada": Number(point.metaRecalculada),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(value: number) => formatMetricNumber(value, unit)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Meta Original" fill={META_ORIGINAL_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="Meta Recalculada" fill={META_RECALCULADA_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
      <ChartDataTable
        caption="Meta Original x Meta Recalculada, meses restantes após a data de corte"
        columns={["Mês", "Meta Original", "Meta Recalculada"]}
        rows={data.map((point) => [point.label, formatMetricNumber(point["Meta Original"], unit), formatMetricNumber(point["Meta Recalculada"], unit)])}
      />
    </div>
  );
}
