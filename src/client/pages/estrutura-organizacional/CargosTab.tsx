import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { PERMISSION_LEVEL_LABELS, useAuthStore, type PermissionLevel } from "@/store/auth.store";

interface Cargo {
  id: string;
  name: string;
  defaultFixedSalary: string;
  permissionLevel: PermissionLevel;
}

const emptyForm = {
  name: "",
  defaultFixedSalary: "",
  permissionLevel: "OPERACIONAL" as PermissionLevel,
};

export function CargosTab() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data: cargos, isLoading } = useQuery({
    queryKey: ["cargos"],
    queryFn: async () => {
      const { data } = await api.get<Cargo[]>("/cargos");
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        defaultFixedSalary: Number(form.defaultFixedSalary),
        permissionLevel: form.permissionLevel,
      };

      if (editingId) {
        await api.put(`/cargos/${editingId}`, payload);
      } else {
        await api.post("/cargos", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cargos"] });
      setForm(emptyForm);
      setEditingId(null);
      setError(null);
    },
    onError: () => {
      setError("Não foi possível salvar o cargo.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/cargos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cargos"] });
      setError(null);
    },
    onError: () => {
      setError("Não foi possível excluir: verifique se há membros vinculados a este cargo.");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  function handleEdit(cargo: Cargo) {
    setEditingId(cargo.id);
    setForm({
      name: cargo.name,
      defaultFixedSalary: cargo.defaultFixedSalary,
      permissionLevel: cargo.permissionLevel,
    });
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Matriz de cargos da empresa: salário fixo padrão e nível de permissão (RBAC).
      </p>

      {isAdmin && (
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-sm text-foreground" htmlFor="name">
            Nome do Cargo
          </label>
          <input
            id="name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-foreground" htmlFor="defaultFixedSalary">
            Salário Fixo Padrão (R$)
          </label>
          <input
            id="defaultFixedSalary"
            type="number"
            step="0.01"
            min="0"
            required
            value={form.defaultFixedSalary}
            onChange={(event) => setForm({ ...form, defaultFixedSalary: event.target.value })}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-foreground" htmlFor="permissionLevel">
            Nível de Permissão
          </label>
          <select
            id="permissionLevel"
            value={form.permissionLevel}
            onChange={(event) =>
              setForm({ ...form, permissionLevel: event.target.value as PermissionLevel })
            }
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            {Object.entries(PERMISSION_LEVEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {editingId ? "Salvar alterações" : "Adicionar cargo"}
        </button>

        {editingId && (
          <button
            type="button"
            onClick={handleCancelEdit}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
          >
            Cancelar
          </button>
        )}
      </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Salário Padrão</th>
              <th className="px-4 py-2">Nível de Permissão</th>
              <th className="px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}

            {!isLoading && cargos?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-muted-foreground">
                  Nenhum cargo cadastrado ainda.
                </td>
              </tr>
            )}

            {cargos?.map((cargo) => (
              <tr key={cargo.id} className="border-t border-border">
                <td className="px-4 py-2">{cargo.name}</td>
                <td className="px-4 py-2">
                  {Number(cargo.defaultFixedSalary).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </td>
                <td className="px-4 py-2">{PERMISSION_LEVEL_LABELS[cargo.permissionLevel]}</td>
                <td className="px-4 py-2">
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(cargo)}
                        className="text-sm text-primary hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(cargo.id)}
                        className="text-sm text-destructive hover:underline"
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
