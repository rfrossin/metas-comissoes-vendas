import { formatMetricValue, formatPercent } from "@/pages/acompanhamento/format";

interface ProgressBarProps {
  label: string;
  metaValue: string;
  realizadoValue: string;
  percentage: string | null;
  unit: "MOEDA" | "NUMERAL";
}

// Barra de progresso de 1 período (Diário/Semanal/Mensal/Trimestral/
// Acumulado) de 1 Linha de Meta — sem estado, sem lógica de negócio (o
// cálculo de percentual vive inteiramente no servidor, ver
// buildPeriodProgress em metas.service.ts). Preenchimento visual capado em
// 100% mesmo quando o percentual real ultrapassa isso — o rótulo numérico
// sempre mostra o valor real.
export function ProgressBar({ label, metaValue, realizadoValue, percentage, unit }: ProgressBarProps) {
  if (percentage === null) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">Sem meta neste período.</p>
      </div>
    );
  }

  const fraction = Number(percentage);
  const widthPercent = Math.min(100, Math.max(0, fraction * 100));
  const isOverTarget = fraction > 1;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {formatMetricValue(realizadoValue, unit)} / {formatMetricValue(metaValue, unit)} ({formatPercent(percentage)})
        </p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${isOverTarget ? "bg-success" : "bg-primary"}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}
