import { useMemo, useState } from "react";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { formatFullHierarchy } from "./hierarchy";
import { MySimulatorModal } from "./MySimulatorModal";
import { TierLadderChart, TriggerRequirementChart, type TierLadderChartPoint, type TierLadderSeriesInfo } from "./ReceivablesTargetCharts";
import type { MyReceivablesBaseDetail } from "./types";

const TRIGGER_MODE_EXPLANATION: Record<"FAIXA" | "CUMULATIVO", string> = {
  FAIXA: "Faixa: só o Degrau mais alto batido no período conta — a recompensa é a daquele Degrau específico.",
  CUMULATIVO: "Cumulativo: todos os Degraus batidos no período somam — as recompensas de cada um se acumulam.",
};

function formatValue(value: string, indicatorType: "META" | "RESULTADO"): string {
  const n = Number(value);
  return indicatorType === "META" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function periodLabel(iso: string, periodicity: string): string {
  const date = new Date(iso);
  if (periodicity === "TRIMESTRAL") {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `T${quarter}/${date.getUTCFullYear()}`;
  }
  if (periodicity === "ANUAL") {
    return `${date.getUTCFullYear()}`;
  }
  return date.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: periodicity === "MENSAL" ? undefined : "2-digit",
    month: "short",
    year: "numeric",
  });
}

const REWARD_LABELS: Record<string, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

function rewardText(rule: {
  rewardType: string;
  rewardResultTypeName: string | null;
  rewardPercentage: string | null;
  rewardFixedValue: string | null;
  rewardDescription: string | null;
}): string {
  const label = REWARD_LABELS[rule.rewardType] ?? rule.rewardType;
  if (rule.rewardType === "PREMIO_FISICO") return `${label}${rule.rewardDescription ? `: ${rule.rewardDescription}` : ""}`;
  if (rule.rewardType === "PERCENT_FIXO" || rule.rewardType === "PERCENT_RESULTADO") {
    const base = rule.rewardType === "PERCENT_RESULTADO" && rule.rewardResultTypeName ? ` de ${rule.rewardResultTypeName}` : "";
    return `${label}${base}: ${rule.rewardPercentage ?? "—"}%`;
  }
  return `${label}: ${rule.rewardFixedValue ?? "—"}`;
}

// UI de exibição extraída de MyReceivablesBaseDetailPage.tsx (PASSO 18/19) —
// somente-leitura e 100% SIMULADA (nunca usa Realizado). Reaproveitada por 2
// wrappers finos: autoatendimento ("Minhas Bases", memberId = o próprio
// usuário logado) e Admin/Gestor vendo o detalhe de QUALQUER Beneficiário da
// Base (memberId vem da URL, não do usuário logado).
export function ReceivablesBaseDetailView({
  detail,
  page,
  onPageChange,
  memberId,
  onBack,
}: {
  detail: MyReceivablesBaseDetail;
  page: number;
  onPageChange: (page: number) => void;
  memberId: string;
  onBack: () => void;
}) {
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  const tierSeries: TierLadderSeriesInfo[] = useMemo(
    () => detail.tierLadder.map((tier) => ({ key: `tier${tier.order}`, label: `Degrau ${tier.order}` })),
    [detail],
  );

  const tierChartData: TierLadderChartPoint[] = useMemo(() => {
    return detail.tierPeriods.map((period) => {
      const point: TierLadderChartPoint = { label: periodLabel(period.periodStart, detail.periodicity) };
      let previous = 0;
      const sorted = [...period.tiers].sort((a, b) => a.order - b.order);
      for (const tier of sorted) {
        const cumulative = Number(tier.requiredValue);
        point[`tier${tier.order}`] = Math.max(cumulative - previous, 0);
        previous = cumulative;
      }
      return point;
    });
  }, [detail]);

  const triggerCharts = useMemo(() => {
    return detail.triggerSeries.map((series) => ({
      triggerId: series.triggerId,
      label: series.label,
      data: series.points.map((point) => ({ label: periodLabel(point.periodStart, detail.periodicity), value: Number(point.requiredValue) })),
    }));
  }, [detail]);

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:underline">
        ← Voltar
      </button>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.indicatorType === "META" ? "Baseado na Meta" : "Baseado no Tipo de Resultado"}: {detail.goalOrResultLabel}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Período de Fechamento</p>
          <p className="text-sm font-medium text-foreground">{PERIODICITY_LABELS[detail.periodicity]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Modo</p>
          <p className="text-sm font-medium text-foreground">{detail.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"}</p>
          <p className="text-xs text-muted-foreground">{TRIGGER_MODE_EXPLANATION[detail.triggerMode]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Período de Vigência</p>
          <p className="text-sm font-medium text-foreground">
            {detail.startDate ? formatDate(detail.startDate) : "Início aberto"} até {detail.endDate ? formatDate(detail.endDate) : "sem data final"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Entidade de Análise</p>
          <p className="text-sm font-medium text-foreground">
            {formatFullHierarchy(detail.hierarchyPath, detail.entityType, detail.entityName)}
          </p>
        </div>
      </div>

      {detail.conditionalTriggers.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Gatilhos Condicionais</h3>
          <ul className="space-y-0.5 text-sm text-foreground">
            {detail.conditionalTriggers.map((trigger) => (
              <li key={trigger.id}>
                {trigger.indicatorType === "META" ? "Meta" : "Resultado"}: {trigger.label} — mínimo{" "}
                {formatValue(trigger.requiredMinimum, trigger.indicatorType)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.tierLadder.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Degraus de Recompensa — baseados {detail.indicatorType === "META" ? "na Meta" : "no Resultado"} "{detail.goalOrResultLabel}"
          </h3>
          <ul className="space-y-1 text-sm text-foreground">
            {detail.tierLadder.map((tier) => (
              <li key={tier.order}>
                Degrau #{tier.order} — limiar {formatValue(tier.thresholdValue, detail.indicatorType)}
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {tier.rules.map((rule, index) => (
                    <li key={index}>{rewardText(rule)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Quanto é preciso fazer — Degraus (simulado, por período)</h3>
        <TierLadderChart data={tierChartData} series={tierSeries} />
      </div>

      {triggerCharts.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Quanto é preciso fazer — Gatilhos Condicionais (simulado, por período)</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {triggerCharts.map((chart) => (
              <TriggerRequirementChart key={chart.triggerId} title={chart.label} data={chart.data} />
            ))}
          </div>
        </div>
      )}

      {detail.pagination && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={!detail.pagination.hasPrev}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            ← Anterior
          </button>
          <button
            type="button"
            disabled={!detail.pagination.hasNext}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Próximo →
          </button>
        </div>
      )}

      {detail.canSimulate && (
        <div>
          <button
            type="button"
            onClick={() => setSimulatorOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Simular
          </button>
        </div>
      )}

      {simulatorOpen && (
        <MySimulatorModal
          baseId={detail.id}
          indicatorType={detail.indicatorType}
          memberId={memberId}
          triggers={detail.conditionalTriggers.map((trigger) => ({
            triggerId: trigger.id,
            label: trigger.label,
            verificationLevel: trigger.verificationLevel,
            indicatorType: trigger.indicatorType,
          }))}
          onClose={() => setSimulatorOpen(false)}
        />
      )}
    </div>
  );
}
