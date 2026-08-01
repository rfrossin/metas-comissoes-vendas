import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { IndicatorType, SimulationResult } from "./types";

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Próprio Empresa",
  CANAL: "Próprio Canal",
  DEPARTAMENTO: "Próprio Departamento",
  TIME: "Próprio Time",
  MEMBRO: "Próprio Membro",
};

const REWARD_LABELS: Record<string, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

function formatCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatNumber(value: string): string {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Bloco de resultado do Simulador — extraído para ser reaproveitado tanto
// pelo Simulador de gestão (SimulatorModal, qualquer Beneficiário no
// escopo) quanto pelo autoatendimento de "Minhas Bases" (MySimulatorModal,
// sempre o próprio Membro) — mesma apresentação, fontes de dados diferentes.
export function SimulationResultPanel({ result, indicatorType }: { result: SimulationResult; indicatorType: IndicatorType }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Período de Fechamento analisado: {formatDate(result.periodStart)} até{" "}
        {formatDate(new Date(new Date(result.periodEndExclusive).getTime() - 86400000).toISOString())}
      </p>

      {indicatorType === "META" && (
        <p className="text-xs text-muted-foreground">
          Meta 100% do período: {formatNumber(result.metaTotal ?? "0")} — Atingido: {formatNumber(result.attainmentValue)}%
        </p>
      )}
      {indicatorType === "RESULTADO" && (
        <p className="text-xs text-muted-foreground">Resultado simulado no período: {formatNumber(result.attainmentValue)}</p>
      )}

      {result.conditionalChecks.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-foreground">Gatilhos Condicionais</h4>
          <ul className="space-y-0.5 text-xs">
            {result.conditionalChecks.map((check) => (
              <li key={check.triggerId} className={check.passed ? "text-success" : "text-destructive"}>
                {check.passed ? "✅" : "❌"} {LEVEL_LABELS[check.verificationLevel]} — {check.label}: simulado{" "}
                {formatNumber(check.simulatedValue)}
                {check.indicatorType === "META" ? "%" : ""}, mínimo exigido {formatNumber(check.requiredMinimum)}
                {check.indicatorType === "META" ? "%" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.fullLadder.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-foreground">Ladder Completo</h4>
          <ul className="space-y-0.5 text-xs">
            {result.fullLadder.map((rung) => (
              <li key={rung.order} className={rung.achieved ? "text-success" : "text-muted-foreground"}>
                {rung.achieved ? "✅" : "○"} Degrau #{rung.order} — limiar {formatNumber(rung.threshold)}
                {indicatorType === "META" ? "%" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!result.eligible ? (
        <>
          <p className="font-medium text-destructive">R$ 0,00 ({result.blockedReason})</p>
          {result.blockedTrigger && (
            <p className="text-xs text-muted-foreground">
              Condição não atendida: {LEVEL_LABELS[result.blockedTrigger.verificationLevel]} — {result.blockedTrigger.label}. Simulado:{" "}
              {formatNumber(result.blockedTrigger.simulatedValue)}
              {result.blockedTrigger.indicatorType === "META" ? "%" : ""}, mínimo exigido:{" "}
              {formatNumber(result.blockedTrigger.requiredMinimum)}
              {result.blockedTrigger.indicatorType === "META" ? "%" : ""} para desbloquear.
            </p>
          )}
        </>
      ) : (
        <>
          {result.tierBreakdown.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-foreground">Detalhamento por Degrau Atingido</h4>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {result.tierBreakdown.map((tier) => (
                  <li key={tier.order}>
                    Degrau #{tier.order} — {REWARD_LABELS[tier.rewardType] ?? tier.rewardType}
                    {tier.baseValueUsed ? ` sobre ${formatCurrency(tier.baseValueUsed)}` : ""}
                    {tier.physicalPrizeDescription ? ` — ${tier.physicalPrizeDescription}` : ` = ${formatCurrency(tier.computedAmount)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="font-medium text-foreground">Ganho Projetado: {formatCurrency(result.payoutValue)}</p>
          {result.physicalPrizeDescription && (
            <p className="text-xs text-muted-foreground">Premiação Física: {result.physicalPrizeDescription}</p>
          )}
        </>
      )}
    </div>
  );
}
