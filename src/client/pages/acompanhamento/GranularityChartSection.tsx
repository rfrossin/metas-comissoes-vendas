import { LoadingState } from "./AsyncState";
import type { ResultUnit } from "./format";
import { GranularityDetailTable } from "./GranularityDetailTable";
import { formatPeriodLabel } from "./periodLabels";
import { StackedMetaRealizadoChart } from "./StackedMetaRealizadoChart";
import type { AcompanhamentoOverview, Granularity } from "./types";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  DIA: "Dia",
  SEMANA: "Semana",
  MES: "Mês",
  TRIMESTRE: "Trimestre",
};

// Dia/Semana mostram só o mês corrente do período (paginação); Mês/Trimestre
// mostram o período inteiro de uma vez — decisão explícita do usuário para
// não poluir o layout com muitas barras.
export function GranularityChartSection({
  overview,
  isLoading,
  unit,
  granularity,
  onGranularityChange,
  onMonthOffsetChange,
}: {
  overview: AcompanhamentoOverview | undefined;
  isLoading: boolean;
  unit: ResultUnit | undefined;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  onMonthOffsetChange: (offset: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Meta x Realizado por Período</h2>
        <div className="flex items-center gap-1">
          {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onGranularityChange(option)}
              className={`rounded-md border px-2 py-1 text-xs ${
                granularity === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-foreground hover:bg-secondary/50"
              }`}
            >
              {GRANULARITY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {overview?.page && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!overview.page.hasPrev}
            onClick={() => onMonthOffsetChange(overview.page!.monthOffset - 1)}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            ← Mês anterior
          </button>
          <button
            type="button"
            disabled={!overview.page.hasNext}
            onClick={() => onMonthOffsetChange(overview.page!.monthOffset + 1)}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Próximo mês →
          </button>
        </div>
      )}

      {isLoading && <LoadingState />}

      {overview && !isLoading && (
        <>
          <StackedMetaRealizadoChart
            buckets={overview.buckets}
            entities={overview.entities}
            unit={unit}
            formatPeriodLabel={(key) => formatPeriodLabel(key, granularity)}
          />
          <GranularityDetailTable buckets={overview.buckets} unit={unit} formatPeriodLabel={(key) => formatPeriodLabel(key, granularity)} />
        </>
      )}
    </div>
  );
}
