import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";

type ResultUnit = "MOEDA" | "NUMERAL";

interface ResultEntry {
  id: string;
  date: string;
  value: string;
  type: { id: string; name: string; unit: ResultUnit };
}

interface OperationalAdjustment {
  id: string;
  dateReference: string;
  value: string;
  reason: string;
  type: { id: string; name: string; unit: ResultUnit };
}

interface HistoryRow {
  kind: "resultado" | "desagio";
  id: string;
  date: string;
  typeName: string;
  unit: ResultUnit;
  value: string;
  reason?: string;
}

function formatValue(value: string, unit: ResultUnit) {
  const parsed = Number(value);

  if (unit === "MOEDA") {
    return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return parsed.toLocaleString("pt-BR");
}

export function HistoryTable({ memberId }: { memberId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: entries, isLoading: isLoadingEntries } = useQuery({
    queryKey: ["result-entries", memberId],
    queryFn: async () => {
      const { data } = await api.get<ResultEntry[]>("/resultados/entries", { params: { memberId } });
      return data;
    },
  });

  const { data: adjustments, isLoading: isLoadingAdjustments } = useQuery({
    queryKey: ["operational-adjustments", memberId],
    queryFn: async () => {
      const { data } = await api.get<OperationalAdjustment[]>("/resultados/adjustments", {
        params: { memberId },
      });
      return data;
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["result-entries", memberId] });
    queryClient.invalidateQueries({ queryKey: ["operational-adjustments", memberId] });
    queryClient.invalidateQueries({ queryKey: ["realizado-liquido", memberId] });
  }

  const deleteEntryMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/resultados/entries/${id}`),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível excluir este lançamento."));
    },
  });

  const deleteAdjustmentMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/resultados/adjustments/${id}`),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível excluir este lançamento."));
    },
  });

  function handleDelete(row: HistoryRow) {
    const label = row.kind === "resultado" ? "este Resultado" : "este Deságio";
    const detail = `${formatValue(row.value, row.unit)}, ${row.date.slice(0, 10)}`;

    if (!window.confirm(`Excluir ${label} (${detail})? Essa ação não pode ser desfeita.`)) {
      return;
    }

    if (row.kind === "resultado") {
      deleteEntryMutation.mutate(row.id);
    } else {
      deleteAdjustmentMutation.mutate(row.id);
    }
  }

  const rows: HistoryRow[] = useMemo(() => {
    const entryRows: HistoryRow[] = (entries ?? []).map((entry) => ({
      kind: "resultado",
      id: entry.id,
      date: entry.date,
      typeName: entry.type.name,
      unit: entry.type.unit,
      value: entry.value,
    }));

    const adjustmentRows: HistoryRow[] = (adjustments ?? []).map((adjustment) => ({
      kind: "desagio",
      id: adjustment.id,
      date: adjustment.dateReference,
      typeName: adjustment.type.name,
      unit: adjustment.type.unit,
      value: adjustment.value,
      reason: adjustment.reason,
    }));

    return [...entryRows, ...adjustmentRows].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [entries, adjustments]);

  const isLoading = isLoadingEntries || isLoadingAdjustments;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">Data</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Indicador</th>
              <th className="px-3 py-1.5">Valor</th>
              <th className="px-3 py-1.5">Motivo</th>
              <th className="px-3 py-1.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-2 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-2 text-muted-foreground">
                  Nenhum lançamento ainda.
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const rowLabel = `${row.kind === "resultado" ? "Resultado" : "Deságio"} de ${row.typeName} em ${row.date.slice(0, 10)}, ${formatValue(row.value, row.unit)}`;

              return (
                <tr key={`${row.kind}-${row.id}`} className="border-t border-border">
                  <td className="px-3 py-1.5">{row.date.slice(0, 10)}</td>
                  <td className="px-3 py-1.5">
                    {row.kind === "resultado" ? (
                      <span className="text-foreground">Resultado</span>
                    ) : (
                      <span className="text-muted-foreground">Deságio</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{row.typeName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(row.value, row.unit)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.reason ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => handleDelete(row)}
                      aria-label={`Excluir ${rowLabel}`}
                      className="text-xs text-destructive hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
