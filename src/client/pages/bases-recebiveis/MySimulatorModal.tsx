import { useState } from "react";
import { Modal } from "./Modal";
import { SimulationResultPanel } from "./SimulationResultPanel";
import { useSimulateReceivablesBase } from "./useReceivablesQueries";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { IndicatorType } from "./types";

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Próprio Empresa",
  CANAL: "Próprio Canal",
  DEPARTAMENTO: "Próprio Departamento",
  TIME: "Próprio Time",
  MEMBRO: "Próprio Membro",
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface MyTriggerRef {
  triggerId: string;
  label: string;
  verificationLevel: ScopeType;
  indicatorType: IndicatorType;
}

// Simulador de autoatendimento ("Minhas Bases") — mesmo motor/endpoint do
// Simulador de gestão (SimulatorModal), mas sempre para o próprio Membro:
// sem seletor de Beneficiado, alimentado só pelos Gatilhos que já se
// aplicam a ele (conditionalChecks de listMyReceivablesBases).
export function MySimulatorModal({
  baseId,
  indicatorType,
  memberId,
  triggers,
  onClose,
}: {
  baseId: string;
  indicatorType: IndicatorType;
  memberId: string;
  triggers: MyTriggerRef[];
  onClose: () => void;
}) {
  const [referenceDate, setReferenceDate] = useState(isoToday());
  const [mainValue, setMainValue] = useState("");
  const [conditionalValues, setConditionalValues] = useState<Record<string, string>>({});

  const simulate = useSimulateReceivablesBase(baseId);

  function run() {
    simulate.mutate({
      memberId,
      simulatedMainRealized: Number(mainValue) || 0,
      conditionalSimulations: triggers.map((trigger) => ({
        conditionalTriggerId: trigger.triggerId,
        simulatedRealized: Number(conditionalValues[trigger.triggerId]) || 0,
      })),
      referenceDate,
    });
  }

  return (
    <Modal title="Simulador" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data de Referência (define o Período de Fechamento)</label>
            <input
              type="date"
              value={referenceDate}
              onChange={(event) => setReferenceDate(event.target.value)}
              className="w-44 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {indicatorType === "META" ? "Realizado Simulado da Meta Principal" : "Realizado Simulado (Resultado)"}
            </label>
            <input
              type="number"
              value={mainValue}
              onChange={(event) => setMainValue(event.target.value)}
              className="w-48 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>

          {triggers.map((trigger) => (
            <div key={trigger.triggerId} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Simulado: {LEVEL_LABELS[trigger.verificationLevel]} — {trigger.label}
              </label>
              <input
                type="number"
                value={conditionalValues[trigger.triggerId] ?? ""}
                onChange={(event) => setConditionalValues((prev) => ({ ...prev, [trigger.triggerId]: event.target.value }))}
                className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
          ))}

          <button
            type="button"
            onClick={run}
            disabled={simulate.isPending || !referenceDate}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {simulate.isPending ? "Calculando..." : "Calcular"}
          </button>
        </div>

        {simulate.data && <SimulationResultPanel result={simulate.data} indicatorType={indicatorType} />}
      </div>
    </Modal>
  );
}
