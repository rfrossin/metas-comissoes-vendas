import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";
import type { ResultType } from "./ResultTypesSection";
import type { ResultRow } from "./AllResultsTab";

type BulkField = "typeId" | "date" | "reason";

interface BulkEditPanelProps {
  entryIds: string[];
  adjustmentIds: string[];
  rows: ResultRow[];
  onDone: () => void;
  onCancel: () => void;
}

// Achado da critique: este painel aplicava a N registros de uma vez sem
// preview, ao contrário do irmão ResultsBulkImportPanel (que mostra
// linha-a-linha antes de confirmar). A prévia abaixo é só client-side — os
// `rows` selecionados já vêm carregados da tabela em AllResultsTab, sem
// round-trip novo ao servidor — e mostra valor atual → novo valor por linha;
// só then o botão "Confirmar" dispara o `/resultados/bulk-update` de fato.
export function BulkEditPanel({ entryIds, adjustmentIds, rows, onDone, onCancel }: BulkEditPanelProps) {
  const queryClient = useQueryClient();
  const canEditReason = entryIds.length === 0 && adjustmentIds.length > 0;
  const [field, setField] = useState<BulkField>("typeId");
  const [value, setValue] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: types } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
    enabled: field === "typeId",
  });

  const totalSelected = entryIds.length + adjustmentIds.length;
  const newTypeName = field === "typeId" ? types?.find((type) => type.id === value)?.name : undefined;

  function currentValueLabel(row: ResultRow): string {
    if (field === "typeId") return row.typeName;
    if (field === "date") return row.date.slice(0, 10);
    return row.reason ?? "—";
  }

  const newValueLabel = field === "typeId" ? (newTypeName ?? "—") : value;

  const applyMutation = useMutation({
    mutationFn: () => api.post("/resultados/bulk-update", { entryIds, adjustmentIds, field, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-results"] });
      onDone();
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível aplicar a edição em massa."));
    },
  });

  function handleReview(event: FormEvent) {
    event.preventDefault();

    if (!value) {
      return;
    }

    setError(null);
    setIsReviewing(true);
  }

  function handleFieldChange(nextField: BulkField) {
    setField(nextField);
    setValue("");
    setIsReviewing(false);
  }

  if (isReviewing) {
    return (
      <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
        <p className="text-sm text-foreground">
          Revise as {totalSelected} {totalSelected === 1 ? "alteração abaixo" : "alterações abaixo"} antes de confirmar:
        </p>

        <div className="max-h-60 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-secondary text-secondary-foreground">
              <tr>
                <th className="px-2 py-1.5">Membro</th>
                <th className="px-2 py-1.5">Data</th>
                <th className="px-2 py-1.5">Atual</th>
                <th className="px-2 py-1.5">Novo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="border-t border-border">
                  <td className="px-2 py-1.5">{row.memberName}</td>
                  <td className="px-2 py-1.5">{row.date.slice(0, 10)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{currentValueLabel(row)}</td>
                  <td className="px-2 py-1.5 font-medium text-foreground">{newValueLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {applyMutation.isPending ? "Aplicando..." : `Confirmar aplicação (${totalSelected})`}
          </button>
          <button
            type="button"
            onClick={() => setIsReviewing(false)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
          >
            Voltar
          </button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleReview}
      className="flex flex-wrap items-end gap-3 rounded-md border border-primary/40 bg-primary/5 p-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="bulk-edit-field">
          Campo
        </label>
        <select
          id="bulk-edit-field"
          value={field}
          onChange={(event) => handleFieldChange(event.target.value as BulkField)}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="typeId">Tipo de Resultado</option>
          <option value="date">Data</option>
          {canEditReason && <option value="reason">Motivo (só Deságios)</option>}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="bulk-edit-value">
          Novo valor
        </label>

        {field === "typeId" && (
          <select
            id="bulk-edit-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Selecione...</option>
            {types?.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        )}

        {field === "date" && (
          <input
            id="bulk-edit-value"
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        )}

        {field === "reason" && (
          <input
            id="bulk-edit-value"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={!value}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Revisar alterações
      </button>

      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
      >
        Cancelar
      </button>

      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}
