import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { Modal } from "./Modal";
import type { ResultType } from "@/pages/resultados/ResultTypesSection";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { useSetConditionalTriggers } from "./useReceivablesQueries";
import type { BeneficiaryRow, ConditionalTriggerInput, ConditionalTriggerRow, IndicatorType } from "./types";

interface CampaignOption {
  id: string;
  name: string;
}

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Próprio Empresa",
  CANAL: "Próprio Canal",
  DEPARTAMENTO: "Próprio Departamento",
  TIME: "Próprio Time",
  MEMBRO: "Próprio Membro",
};
const LEVEL_ORDER: ScopeType[] = ["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"];

function emptyDraft(): ConditionalTriggerInput {
  return {
    verificationLevel: "MEMBRO",
    indicatorType: "META",
    conditionalGoalCampaignId: null,
    resultTypeId: null,
    minAttainmentPercentage: null,
    minResultValue: null,
    applicableMemberIds: [],
  };
}

function toInput(trigger: ConditionalTriggerRow): ConditionalTriggerInput {
  return {
    verificationLevel: trigger.verificationLevel,
    indicatorType: trigger.indicatorType,
    conditionalGoalCampaignId: trigger.conditionalGoalCampaignId,
    resultTypeId: trigger.resultTypeId,
    minAttainmentPercentage: trigger.minAttainmentPercentage ? Number(trigger.minAttainmentPercentage) : null,
    minResultValue: trigger.minResultValue ? Number(trigger.minResultValue) : null,
    applicableMemberIds: trigger.applicableMemberIds,
  };
}

function applicableLabel(applicableMemberIds: string[], beneficiaries: BeneficiaryRow[]): string {
  if (applicableMemberIds.length === 0) return "Todos os Beneficiados";
  const names = beneficiaries.filter((b) => applicableMemberIds.includes(b.memberId)).map((b) => b.member.fullName);
  return names.length > 0 ? names.join(", ") : "Todos os Beneficiados";
}

// Espelha isTriggerOwnedByPartialAccess do backend (bases-recebiveis.service.ts):
// só é "dele" se mira exclusivamente Beneficiários dentro do que ele gerencia.
function isOwnedByPartialAccess(applicableMemberIds: string[], editableBeneficiaryMemberIds: string[] | null): boolean {
  if (editableBeneficiaryMemberIds === null) return true; // acesso FULL — tudo é dele
  return applicableMemberIds.length > 0 && applicableMemberIds.every((id) => editableBeneficiaryMemberIds.includes(id));
}

// Gatilhos Condicionais (Bases de Recebível §2) — 0 ou mais Condições de
// Ativação. Cada Condição verifica um NÍVEL relativo ao próprio
// Beneficiário (não uma Entidade fixa): "Próprio Membro" exige que CADA
// Beneficiário bata individualmente, "Próprio Time" exige que o Time DE
// CADA UM bata, etc. — resolvido por Beneficiário na hora da avaliação.
export function ConditionalTriggersModal({
  baseId,
  triggers,
  beneficiaries,
  editableBeneficiaryMemberIds = null,
  onClose,
}: {
  baseId: string;
  triggers: ConditionalTriggerRow[];
  beneficiaries: BeneficiaryRow[];
  // null = acesso FULL (Admin, ou Gestor com todos os Beneficiários) — tudo
  // editável. Array = acesso PARCIAL — só pode criar/editar Gatilhos cujo
  // "Aplica-se a" seja só destes ids; Gatilhos globais/de outros ficam
  // travados (o backend também garante isso, independente do que a UI deixa).
  editableBeneficiaryMemberIds?: string[] | null;
  onClose: () => void;
}) {
  const isPartial = editableBeneficiaryMemberIds !== null;
  const ownBeneficiaries = isPartial
    ? beneficiaries.filter((b) => editableBeneficiaryMemberIds!.includes(b.memberId))
    : beneficiaries;
  const [draft, setDraft] = useState<ConditionalTriggerInput>(() => emptyDraft());
  const [error, setError] = useState<string | null>(null);

  const { data: campaigns } = useQuery({
    queryKey: ["goal-campaigns-lite"],
    queryFn: async () => {
      const { data } = await api.get<CampaignOption[]>("/metas");
      return data;
    },
  });
  const { data: resultTypes } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  const setTriggers = useSetConditionalTriggers(baseId);

  const canAdd =
    (draft.indicatorType === "META"
      ? !!draft.conditionalGoalCampaignId && !!draft.minAttainmentPercentage && draft.minAttainmentPercentage > 0
      : !!draft.resultTypeId && !!draft.minResultValue && draft.minResultValue > 0) &&
    // Acesso PARCIAL nunca pode criar Gatilho "para todos" (global) — só
    // específico dos próprios Beneficiários, senão o backend descarta.
    (!isPartial || draft.applicableMemberIds.length > 0);

  function addDraft() {
    if (!canAdd) return;
    const next = [...triggers.map(toInput), draft];
    setTriggers.mutate(next, {
      onSuccess: () => {
        setDraft(emptyDraft());
        setError(null);
      },
      onError: () => setError("Não foi possível salvar a Condição."),
    });
  }

  function removeTrigger(id: string) {
    const next = triggers.filter((t) => t.id !== id).map(toInput);
    setTriggers.mutate(next, { onError: () => setError("Não foi possível remover a Condição.") });
  }

  return (
    <Modal title="Gatilhos Condicionais" onClose={onClose}>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Trava de elegibilidade: cada condição verifica um Nível relativo a cada Beneficiário ao qual ela se aplica (ex: "Próprio Time"
          exige que o Time de cada um bata). Se o Atingimento Real no Período de Fechamento ficar aquém do mínimo, o Beneficiário fica
          zerado no período.
        </p>

        {isPartial && (
          <p className="text-xs text-muted-foreground">
            Você só gerencia parte dos Beneficiários desta Base — Gatilhos globais ou de outros Beneficiários aparecem só para
            consulta (🔒), sem opção de remover.
          </p>
        )}

        {triggers.length > 0 && (
          <ul className="space-y-1 text-sm">
            {triggers.map((trigger) => {
              const owned = isOwnedByPartialAccess(trigger.applicableMemberIds, editableBeneficiaryMemberIds);
              return (
                <li key={trigger.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1">
                  <span>
                    {!owned && <span title="Somente consulta">🔒 </span>}
                    {LEVEL_LABELS[trigger.verificationLevel]} —{" "}
                    {trigger.indicatorType === "META"
                      ? `Meta: ${trigger.conditionalGoal?.name ?? "—"} ≥ ${trigger.minAttainmentPercentage}%`
                      : `Resultado: ${trigger.resultType?.name ?? "—"} ≥ ${trigger.minResultValue}`}
                    <span className="text-muted-foreground"> · Aplica-se a: {applicableLabel(trigger.applicableMemberIds, beneficiaries)}</span>
                  </span>
                  {owned && (
                    <button type="button" onClick={() => removeTrigger(trigger.id)} className="text-xs text-destructive hover:underline">
                      Remover
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 rounded-md border border-border p-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nível a Verificar</label>
            <div className="flex flex-wrap gap-1">
              {LEVEL_ORDER.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDraft({ ...draft, verificationLevel: level })}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    draft.verificationLevel === level
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {LEVEL_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Indicador</label>
              <div className="flex gap-1">
                {(["META", "RESULTADO"] as IndicatorType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDraft({ ...draft, indicatorType: type, conditionalGoalCampaignId: null, resultTypeId: null })}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      draft.indicatorType === type
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {type === "META" ? "Atingimento de Meta" : "Resultado"}
                  </button>
                ))}
              </div>
            </div>

            {draft.indicatorType === "META" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Meta Específica</label>
                  <select
                    value={draft.conditionalGoalCampaignId ?? ""}
                    onChange={(event) => setDraft({ ...draft, conditionalGoalCampaignId: event.target.value || null })}
                    className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">Selecione...</option>
                    {campaigns?.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">% Mínimo de Atingimento</label>
                  <input
                    type="number"
                    value={draft.minAttainmentPercentage ?? ""}
                    onChange={(event) => setDraft({ ...draft, minAttainmentPercentage: Number(event.target.value) })}
                    className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Tipo de Resultado</label>
                  <select
                    value={draft.resultTypeId ?? ""}
                    onChange={(event) => setDraft({ ...draft, resultTypeId: event.target.value || null })}
                    className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">Selecione...</option>
                    {resultTypes?.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Valor Mínimo</label>
                  <input
                    type="number"
                    value={draft.minResultValue ?? ""}
                    onChange={(event) => setDraft({ ...draft, minResultValue: Number(event.target.value) })}
                    className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>
              </>
            )}

            <button
              type="button"
              onClick={addDraft}
              disabled={!canAdd || setTriggers.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              + Adicionar Condição
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {isPartial
                ? "Aplica-se a (obrigatório escolher ao menos 1 — você só pode criar Gatilhos dos seus próprios Beneficiários)"
                : "Aplica-se a (deixe tudo desmarcado para valer para todos os Beneficiados)"}
            </label>
            <div className="max-h-32 w-full overflow-y-auto rounded-md border border-input bg-background p-1.5">
              {ownBeneficiaries.length === 0 && <p className="px-1 py-0.5 text-xs text-muted-foreground">Cadastre Beneficiados primeiro.</p>}
              {ownBeneficiaries.map((beneficiary) => (
                <label
                  key={beneficiary.memberId}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-secondary/50"
                >
                  <input
                    type="checkbox"
                    checked={draft.applicableMemberIds.includes(beneficiary.memberId)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        applicableMemberIds: draft.applicableMemberIds.includes(beneficiary.memberId)
                          ? draft.applicableMemberIds.filter((id) => id !== beneficiary.memberId)
                          : [...draft.applicableMemberIds, beneficiary.memberId],
                      })
                    }
                  />
                  <span>{beneficiary.member.fullName}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}
