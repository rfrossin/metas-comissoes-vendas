import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { InlineNameForm } from "./InlineNameForm";
import { TeamRow, type Team } from "./TeamRow";
import { ResponsibleList, type Responsible } from "./ResponsibleList";

export interface Department {
  id: string;
  name: string;
  responsibles: Responsible[];
  teams: Team[];
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

// PASSO 11.7: Gestor com o próprio Departamento (ou um Canal acima) no
// escopo liderado ganha Editar/Excluir dele e "+ Time" dentro dele — mesma
// regra do backend (assertNodeWithinLedScope), refletida aqui só pra não
// oferecer um botão que vai dar 403.
export function DepartmentRow({
  department,
  ledDepartmentIds,
  ledTeamIds,
}: {
  department: Department;
  ledDepartmentIds: Set<string>;
  ledTeamIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const canManageDepartment = isAdmin || ledDepartmentIds.has(department.id);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["org-tree"] });
  }

  const updateMutation = useMutation({
    mutationFn: (name: string) =>
      api.put(`/estrutura-organizacional/departments/${department.id}`, { name }),
    onSuccess: () => {
      invalidate();
      setIsEditing(false);
      setError(null);
    },
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível salvar o Departamento.")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/estrutura-organizacional/departments/${department.id}`),
    onSuccess: invalidate,
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível excluir o Departamento.")),
  });

  function handleDelete() {
    if (window.confirm(`Excluir o departamento "${department.name}"? Essa ação não pode ser desfeita.`)) {
      setError(null);
      deleteMutation.mutate();
    }
  }

  const createTeamMutation = useMutation({
    mutationFn: (name: string) =>
      api.post("/estrutura-organizacional/teams", { name, departmentId: department.id }),
    onSuccess: () => {
      invalidate();
      setIsAddingTeam(false);
      setError(null);
    },
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível criar o Time.")),
  });

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start justify-between gap-2 bg-card px-3 py-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-muted-foreground"
            >
              {isExpanded ? "▾" : "▸"}
            </button>

            {isEditing ? (
              <InlineNameForm
                initialValue={department.name}
                placeholder="Nome do departamento"
                submitLabel="Salvar"
                onSubmit={(name) => updateMutation.mutate(name)}
                onCancel={() => setIsEditing(false)}
                isSubmitting={updateMutation.isPending}
              />
            ) : (
              <span className="text-sm font-medium text-foreground">{department.name}</span>
            )}
          </div>

          {!isEditing && (
            <div className="pl-6">
              <ResponsibleList responsibles={department.responsibles} />
            </div>
          )}
        </div>

        {!isEditing && canManageDepartment && (
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setIsEditing(true)} className="text-primary hover:underline">
              Editar
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
              className="text-destructive hover:underline disabled:opacity-50"
            >
              Excluir
            </button>
          </div>
        )}
      </div>

      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}

      {isExpanded && (
        <div className="space-y-2 border-t border-border p-3 pl-8">
          {department.teams.map((team) => (
            <TeamRow key={team.id} team={team} ledTeamIds={ledTeamIds} />
          ))}

          {canManageDepartment &&
            (isAddingTeam ? (
              <InlineNameForm
                placeholder="Nome do time"
                submitLabel="Adicionar"
                onSubmit={(name) => createTeamMutation.mutate(name)}
                onCancel={() => setIsAddingTeam(false)}
                isSubmitting={createTeamMutation.isPending}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingTeam(true)}
                className="text-xs text-primary hover:underline"
              >
                + Time
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
