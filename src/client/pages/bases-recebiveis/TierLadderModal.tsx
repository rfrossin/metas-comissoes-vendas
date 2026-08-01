import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { Modal } from "./Modal";
import { useSetTierLadder } from "./useReceivablesQueries";
import type { ReceivablesBaseDetail, RewardType, TierLadderRungInput } from "./types";

interface ResultTypeOption {
  id: string;
  name: string;
}

const REWARD_LABELS: Record<RewardType, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico (R$)",
  PREMIO_FISICO: "Premiação Física",
};

function rungsFromDetail(base: ReceivablesBaseDetail): TierLadderRungInput[] {
  return base.tierRules
    .map((rule) => ({
      order: rule.valueTier.order,
      threshold: Number(rule.valueTier.thresholdValue),
      rewardType: rule.rewardType,
      rewardResultTypeId: rule.rewardResultTypeId,
      rewardPercentage: rule.rewardPercentage ? Number(rule.rewardPercentage) : null,
      rewardFixedValue: rule.rewardFixedValue ? Number(rule.rewardFixedValue) : null,
      rewardDescription: rule.rewardDescription,
    }))
    .sort((a, b) => a.order - b.order);
}

function emptyRung(order: number): TierLadderRungInput {
  return {
    order,
    threshold: 0,
    rewardType: "VALOR_FIXO",
    rewardResultTypeId: null,
    rewardPercentage: null,
    rewardFixedValue: null,
    rewardDescription: null,
  };
}

// Degraus (Faixa/Cumulativo) + Base de Cálculo Dinâmica da recompensa
// (Bases de Recebível §3-§5), dentro do pop-up de configuração. Limiar em %
// (indicatorType=META) ou valor absoluto do Tipo de Resultado
// (indicatorType=RESULTADO).
export function TierLadderModal({
  base,
  readOnly = false,
  onClose,
}: {
  base: ReceivablesBaseDetail;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const [rungs, setRungs] = useState<TierLadderRungInput[]>(() =>
    base.tierRules.length > 0 ? rungsFromDetail(base) : [emptyRung(1)],
  );
  const [error, setError] = useState<string | null>(null);

  const { data: resultTypes } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultTypeOption[]>("/resultados/types");
      return data;
    },
  });

  const setTierLadder = useSetTierLadder(base.id);

  function updateRung(index: number, patch: Partial<TierLadderRungInput>) {
    setRungs((prev) => prev.map((rung, i) => (i === index ? { ...rung, ...patch } : rung)));
  }

  function addRung() {
    setRungs((prev) => [...prev, emptyRung(prev.length + 1)]);
  }

  function removeRung(index: number) {
    setRungs((prev) => prev.filter((_, i) => i !== index).map((rung, i) => ({ ...rung, order: i + 1 })));
  }

  function save() {
    setTierLadder.mutate(rungs, {
      onSuccess: () => setError(null),
      onError: () => setError("Não foi possível salvar os degraus — confira os campos obrigatórios de cada tipo de recompensa."),
    });
  }

  const thresholdLabel = base.indicatorType === "META" ? "% de Atingimento" : "Valor do Resultado (R$)";

  return (
    <Modal title={`Degraus e Recompensa — Modo ${base.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-2">
          {rungs.map((rung, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Ordem</label>
                <input value={rung.order} disabled className="w-14 rounded-md border border-input bg-secondary/30 px-2 py-1 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{thresholdLabel}</label>
                <input
                  type="number"
                  disabled={readOnly}
                  value={rung.threshold || ""}
                  onChange={(event) => updateRung(index, { threshold: Number(event.target.value) })}
                  className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Tipo de Recompensa</label>
                <select
                  disabled={readOnly}
                  value={rung.rewardType}
                  onChange={(event) => updateRung(index, { rewardType: event.target.value as RewardType })}
                  className="w-44 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                >
                  {(Object.entries(REWARD_LABELS) as [RewardType, string][]).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {rung.rewardType === "PERCENT_RESULTADO" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Tipo de Resultado da Comissão</label>
                  <select
                    disabled={readOnly}
                    value={rung.rewardResultTypeId ?? ""}
                    onChange={(event) => updateRung(index, { rewardResultTypeId: event.target.value || null })}
                    className="w-44 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Selecione...</option>
                    {resultTypes?.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(rung.rewardType === "PERCENT_FIXO" || rung.rewardType === "PERCENT_RESULTADO") && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Percentual (%)</label>
                  <input
                    type="number"
                    disabled={readOnly}
                    value={rung.rewardPercentage ?? ""}
                    onChange={(event) => updateRung(index, { rewardPercentage: Number(event.target.value) })}
                    className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                  />
                </div>
              )}

              {rung.rewardType === "VALOR_FIXO" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Valor (R$)</label>
                  <input
                    type="number"
                    disabled={readOnly}
                    value={rung.rewardFixedValue ?? ""}
                    onChange={(event) => updateRung(index, { rewardFixedValue: Number(event.target.value) })}
                    className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                  />
                </div>
              )}

              {rung.rewardType === "PREMIO_FISICO" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Descrição do Prêmio</label>
                  <input
                    disabled={readOnly}
                    value={rung.rewardDescription ?? ""}
                    onChange={(event) => updateRung(index, { rewardDescription: event.target.value })}
                    placeholder="Ex: Vale Presente"
                    className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                  />
                </div>
              )}

              {!readOnly && (
                <button type="button" onClick={() => removeRung(index)} className="text-xs text-destructive hover:underline">
                  Remover
                </button>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            Você só gerencia parte dos Beneficiários desta Base — Degraus ficam em modo leitura.
          </p>
        ) : (
        <div className="flex gap-2">
          <button type="button" onClick={addRung} className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground">
            + Adicionar Degrau
          </button>
          <button
            type="button"
            onClick={save}
            disabled={setTierLadder.isPending || rungs.length === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {setTierLadder.isPending ? "Salvando..." : "Salvar Degraus"}
          </button>
        </div>
        )}
      </div>
    </Modal>
  );
}
