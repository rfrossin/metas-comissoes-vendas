import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LoadingState } from "./AsyncState";
import { ChartDataTable } from "./ChartDataTable";
import { NO_DATA_TEXT } from "./copy";
import { formatMetricNumber, type ResultUnit } from "./format";
import { monthNumberLabel } from "./periodLabels";
import type { ComparativoPoint } from "./types";

const REALIZADO_ATUAL_COLOR = "#2a78d6"; // slot 1 blue — período filtrado hoje
// Slot 2 (verde) evitado de propósito: no resto do app verde só significa
// "meta batida" (token --success, DESIGN.md "One Success Color Rule") — uma
// barra verde aqui seria lida como conquista, mas é só o Realizado histórico
// do ano comparado, sem julgamento de bom/ruim. Slot 7 (violeta) mantém a
// paleta categórica sem colidir com esse significado.
const REALIZADO_ANO_COLOR = "#4a3aa7"; // slot 7 violeta — ano comparado
const META_COLOR = "#eb6834"; // slot 6 orange — linha, distinta das 2 barras
const GRID_COLOR = "#e1e0d9";
const AXIS_COLOR = "#898781";

// 3 séries, mês a mês: Realizado Atual (barra, período filtrado no topo da
// tela) x Realizado do ano escolhido (barra) x Meta das campanhas
// selecionadas HOJE, reindexada por mês-do-ano (linha) — permite comparar
// o ritmo atual E o ritmo histórico contra o mesmo alvo.
export function ComparativoChart({
  points,
  isLoading,
  unit,
  year,
  onYearChange,
}: {
  points: ComparativoPoint[] | undefined;
  isLoading: boolean;
  unit: ResultUnit | undefined;
  year: number;
  onYearChange: (year: number) => void;
}) {
  const data = (points ?? []).map((point) => ({
    label: monthNumberLabel(point.monthNumber),
    "Realizado Atual": Number(point.realizadoAtual),
    [`Realizado ${year}`]: Number(point.realizadoAnoSelecionado),
    "Meta Atual": Number(point.metaReindexada),
  }));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Ano comparado</label>
        <input
          type="number"
          value={year}
          onChange={(event) => onYearChange(Number(event.target.value))}
          className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        />
      </div>

      {isLoading && <LoadingState />}

      {!isLoading && data.length === 0 && (
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{NO_DATA_TEXT}</p>
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(value: number) => formatMetricNumber(value, unit)} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Realizado Atual" fill={REALIZADO_ATUAL_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey={`Realizado ${year}`} fill={REALIZADO_ANO_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Line type="monotone" dataKey="Meta Atual" stroke={META_COLOR} strokeWidth={2} dot={{ r: 4, fill: META_COLOR }} />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartDataTable
            caption={`Realizado Atual x Realizado ${year} x Meta Atual, mês a mês`}
            columns={["Mês", "Realizado Atual", `Realizado ${year}`, "Meta Atual"]}
            rows={(points ?? []).map((point) => [
              monthNumberLabel(point.monthNumber),
              formatMetricNumber(Number(point.realizadoAtual), unit),
              formatMetricNumber(Number(point.realizadoAnoSelecionado), unit),
              formatMetricNumber(Number(point.metaReindexada), unit),
            ])}
          />
        </div>
      )}
    </div>
  );
}
