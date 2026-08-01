import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";
import type { ResultType } from "./ResultTypesSection";
import { BRNumberField, parseBRNumber } from "./BRNumberField";

type LaunchType = "RESULTADO" | "DESAGIO";

// Fundo de ResultEntryForm.tsx + AdjustmentForm.tsx num quadro só: o usuário
// escolhe primeiro o Tipo de Lançamento (toggle, não <select> — é a decisão
// principal do fluxo) e o formulário se adapta — endpoint chamado, se Valor
// aceita negativo (via allowNegative do BRNumberField, sem lógica extra:
// trocar de Deságio pra Resultado com um valor negativo já digitado mostra
// erro na hora) e se o campo Motivo aparece.
export function LaunchEntryForm({ memberId }: { memberId: string }) {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState("");
  const [launchType, setLaunchType] = useState<LaunchType>("RESULTADO");
  const [date, setDate] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: types } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  const selectedType = types?.find((type) => type.id === typeId);

  const parsedValue = parseBRNumber(value);
  const isValidValue = parsedValue !== null && !Number.isNaN(parsedValue) && (launchType === "DESAGIO" || parsedValue >= 0);

  const createMutation = useMutation({
    mutationFn: () =>
      launchType === "RESULTADO"
        ? api.post("/resultados/entries", { memberId, typeId, date, value: parsedValue })
        : api.post("/resultados/adjustments", {
            memberId,
            typeId,
            dateReference: date,
            value: parsedValue,
            reason: reason.trim() ? reason : undefined,
          }),
    onSuccess: () => {
      // Mesmo padrão já usado no handler de exclusão de HistoryTable.tsx —
      // invalida as 3 queries incondicionalmente (HistoryTable lê Resultados
      // e Deságios juntos numa lista combinada, então não vale a pena
      // diferenciar por launchType aqui).
      queryClient.invalidateQueries({ queryKey: ["result-entries", memberId] });
      queryClient.invalidateQueries({ queryKey: ["operational-adjustments", memberId] });
      queryClient.invalidateQueries({ queryKey: ["realizado-liquido", memberId] });
      setTypeId("");
      setDate("");
      setValue("");
      setReason("");
      setError(null);
      setSuccess(launchType === "RESULTADO" ? "Resultado lançado." : "Deságio lançado.");
    },
    onError: (mutationError) => {
      setError(
        getErrorMessage(mutationError, launchType === "RESULTADO" ? "Não foi possível lançar o resultado." : "Não foi possível lançar o deságio."),
      );
      setSuccess(null);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);

    if (!typeId || !date || !isValidValue) {
      return;
    }

    createMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-xs font-semibold text-foreground">Novo Lançamento</h3>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="launch-entry-type">
          Tipo de Resultado
        </label>
        <select
          id="launch-entry-type"
          required
          value={typeId}
          onChange={(event) => setTypeId(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="">Selecione...</option>
          {types?.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Tipo de Lançamento</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLaunchType("RESULTADO")}
            className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
              launchType === "RESULTADO" ? "border-primary bg-primary/10 font-medium text-primary" : "border-input text-foreground"
            }`}
          >
            Resultado
          </button>
          <button
            type="button"
            onClick={() => setLaunchType("DESAGIO")}
            className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
              launchType === "DESAGIO" ? "border-primary bg-primary/10 font-medium text-primary" : "border-input text-foreground"
            }`}
          >
            Deságio
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="launch-entry-date">
          Data
        </label>
        <input
          id="launch-entry-date"
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        />
      </div>

      <BRNumberField
        id="launch-entry-value"
        label={launchType === "DESAGIO" ? "Valor (negativo para estorno)" : "Valor"}
        value={value}
        onChange={setValue}
        unit={selectedType?.unit}
        allowNegative={launchType === "DESAGIO"}
        negativeHint="Resultado não aceita valor negativo — troque o Tipo de Lançamento para Deságio para registrar estornos."
      />

      {launchType === "DESAGIO" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="launch-entry-reason">
            Motivo (opcional)
          </label>
          <textarea
            id="launch-entry-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={createMutation.isPending}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {createMutation.isPending ? "Lançando..." : launchType === "RESULTADO" ? "Lançar Resultado" : "Lançar Deságio"}
      </button>

      {success && <p className="text-xs text-success">{success}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
