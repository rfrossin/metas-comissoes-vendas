import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ResultType } from "@/pages/resultados/ResultTypesSection";
import type { IndicatorType, ReceivablesBaseInput, ReceivablesPeriodicity, TriggerMode } from "./types";

interface CampaignOption {
  id: string;
  name: string;
}

export const PERIODICITY_LABELS: Record<ReceivablesPeriodicity, string> = {
  DIARIO: "Diário",
  SEMANAL: "Semanal",
  MENSAL: "Mensal",
  TRIMESTRAL: "Trimestral",
  ANUAL: "Anual",
};

// Campos da Base de Recebível (Nome, Tipo, Campanha/Tipo de Resultado,
// Periodicidade, Modo, Vigência) — reaproveitado tanto na criação (lista)
// quanto na edição (pop-up da tela de configuração).
export function BaseFormFields({
  form,
  setForm,
  openEnded,
  setOpenEnded,
}: {
  form: ReceivablesBaseInput;
  setForm: (next: ReceivablesBaseInput) => void;
  openEnded: boolean;
  setOpenEnded: (next: boolean) => void;
}) {
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

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Nome da Campanha de Recebível</label>
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Tipo de Base de Recebível</label>
        <div className="flex gap-1">
          {(["META", "RESULTADO"] as IndicatorType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setForm({ ...form, indicatorType: type, primaryGoalCampaignId: null, resultTypeId: null })}
              className={`rounded-md border px-2 py-1 text-xs ${
                form.indicatorType === type
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-foreground hover:bg-secondary/50"
              }`}
            >
              {type === "META" ? "Baseado em Meta" : "Baseado em Resultado"}
            </button>
          ))}
        </div>
      </div>

      {form.indicatorType === "META" ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Campanha de Meta</label>
          <select
            value={form.primaryGoalCampaignId ?? ""}
            onChange={(event) => setForm({ ...form, primaryGoalCampaignId: event.target.value || null })}
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
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo de Resultado</label>
          <select
            value={form.resultTypeId ?? ""}
            onChange={(event) => setForm({ ...form, resultTypeId: event.target.value || null })}
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
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Periodicidade de Fechamento</label>
        <select
          value={form.periodicity}
          onChange={(event) => setForm({ ...form, periodicity: event.target.value as ReceivablesPeriodicity })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        >
          {(Object.entries(PERIODICITY_LABELS) as [ReceivablesPeriodicity, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Modo</label>
        <select
          value={form.triggerMode}
          onChange={(event) => setForm({ ...form, triggerMode: event.target.value as TriggerMode })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="FAIXA">Faixa (só o maior degrau)</option>
          <option value="CUMULATIVO">Cumulativo (soma os degraus)</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Vigência — Data Inicial</label>
        <input
          type="date"
          value={form.startDate ?? ""}
          onChange={(event) => setForm({ ...form, startDate: event.target.value || null })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Data Final</label>
        <input
          type="date"
          disabled={openEnded}
          value={form.endDate ?? ""}
          onChange={(event) => setForm({ ...form, endDate: event.target.value || null })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
        />
        <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={openEnded} onChange={(event) => setOpenEnded(event.target.checked)} />
          Final Aberto
        </label>
      </div>
    </div>
  );
}
