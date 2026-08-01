import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";

export type ResultUnit = "MOEDA" | "NUMERAL";

export interface ResultType {
  id: string;
  name: string;
  unit: ResultUnit;
}

const UNIT_LABELS: Record<ResultUnit, string> = {
  MOEDA: "Moeda (R$)",
  NUMERAL: "Numeral Puro",
};

const emptyForm = { name: "", unit: "MOEDA" as ResultUnit };

export function ResultTypesSection() {
  const queryClient = useQueryClient();
  // Tipo de Resultado: todos visualizam, só Admin cria/edita/exclui.
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data: types, isLoading } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingId) {
        await api.put(`/resultados/types/${editingId}`, form);
      } else {
        await api.post("/resultados/types", form);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["result-types"] });
      setForm(emptyForm);
      setEditingId(null);
      setError(null);
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível salvar o Tipo de Resultado."));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/resultados/types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["result-types"] });
      setError(null);
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível excluir este Tipo de Resultado."));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  function handleDelete(type: ResultType) {
    if (!window.confirm(`Excluir o Tipo de Resultado "${type.name}"? Essa ação não pode ser desfeita.`)) {
      return;
    }

    deleteMutation.mutate(type.id);
  }

  function handleEdit(type: ResultType) {
    setEditingId(type.id);
    setForm({ name: type.name, unit: type.unit });
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Tipos de Resultado</h2>
        <p className="text-xs text-muted-foreground">
          Dicionário de indicadores quantitativos (ex: "Valor Vendido", "Número de Vendas").
        </p>
      </div>

      {isAdmin && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="type-name">
              Nome do Indicador
            </label>
            <input
              id="type-name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="type-unit">
              Unidade
            </label>
            <select
              id="type-unit"
              value={form.unit}
              onChange={(event) => setForm({ ...form, unit: event.target.value as ResultUnit })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              {Object.entries(UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {editingId ? "Salvar" : "Adicionar"}
          </button>

          {editingId && (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
            >
              Cancelar
            </button>
          )}
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">Nome</th>
              <th className="px-3 py-1.5">Unidade</th>
              <th className="px-3 py-1.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}

            {!isLoading && types?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                  Nenhum tipo cadastrado ainda.
                </td>
              </tr>
            )}

            {types?.map((type) => (
              <tr key={type.id} className="border-t border-border">
                <td className="px-3 py-1.5">{type.name}</td>
                <td className="px-3 py-1.5">{UNIT_LABELS[type.unit]}</td>
                <td className="px-3 py-1.5">
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(type)}
                        aria-label={`Editar Tipo de Resultado "${type.name}"`}
                        className="text-xs text-primary hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(type)}
                        aria-label={`Excluir Tipo de Resultado "${type.name}"`}
                        className="text-xs text-destructive hover:underline"
                      >
                        Excluir
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
