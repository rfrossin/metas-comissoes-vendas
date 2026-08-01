import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { InlineNameForm } from "./InlineNameForm";
import { MemberSummaryLine, type MemberSummary } from "./MemberSummaryLine";
import { ResponsibleList, type Responsible } from "./ResponsibleList";

export interface Team {
  id: string;
  name: string;
  responsibles: Responsible[];
  members: MemberSummary[];
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

// PASSO 11.7: Gestor com o próprio Time (ou um Departamento/Canal acima) no
// escopo liderado ganha Editar/Excluir dele — mesma regra do backend
// (assertNodeWithinLedScope).
export function TeamRow({ team, ledTeamIds }: { team: Team; ledTeamIds: Set<string> }) {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const canManageTeam = isAdmin || ledTeamIds.has(team.id);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["org-tree"] });
  }

  const updateMutation = useMutation({
    mutationFn: (name: string) => api.put(`/estrutura-organizacional/teams/${team.id}`, { name }),
    onSuccess: () => {
      invalidate();
      setIsEditing(false);
      setError(null);
    },
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível salvar o Time.")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/estrutura-organizacional/teams/${team.id}`),
    onSuccess: invalidate,
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível excluir o Time.")),
  });

  function handleDelete() {
    if (window.confirm(`Excluir o time "${team.name}"? Essa ação não pode ser desfeita.`)) {
      setError(null);
      deleteMutation.mutate();
    }
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-start justify-between gap-2 bg-background px-3 py-2">
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
                initialValue={team.name}
                placeholder="Nome do time"
                submitLabel="Salvar"
                onSubmit={(name) => updateMutation.mutate(name)}
                onCancel={() => setIsEditing(false)}
                isSubmitting={updateMutation.isPending}
              />
            ) : (
              <span className="text-sm text-foreground">{team.name}</span>
            )}
          </div>

          {!isEditing && (
            <div className="pl-6">
              <ResponsibleList responsibles={team.responsibles} />
            </div>
          )}
        </div>

        {!isEditing && canManageTeam && (
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
          {team.members.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum Membro neste Time ainda — adicione pela aba Membros.</p>
          )}
          {team.members.map((member) => (
            <MemberSummaryLine key={member.id} member={member} />
          ))}
        </div>
      )}
    </div>
  );
}
