import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { InlineNameForm } from "./InlineNameForm";
import { DepartmentRow, type Department } from "./DepartmentRow";
import { ResponsibleList, type Responsible } from "./ResponsibleList";

export interface Channel {
  id: string;
  name: string;
  responsibles: Responsible[];
  departments: Department[];
}

// O backend recusa exclusão de Canal com Departamentos ou Responsáveis
// vinculados com uma mensagem específica via ConflictError (409) — sem
// isso, a exclusão falha em silêncio e parece que o botão não fez nada.
function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

// PASSO 11.7: Canal continua exclusivo do Administrador (não tem "pai"
// liderável abaixo de Empresa) — ledChannelIds/ledDepartmentIds/ledTeamIds
// só existem pra repassar pros níveis abaixo (Department/TeamRow), onde um
// Gestor já pode agir dentro do próprio escopo liderado.
export function ChannelRow({
  channel,
  ledChannelIds,
  ledDepartmentIds,
  ledTeamIds,
}: {
  channel: Channel;
  ledChannelIds: Set<string>;
  ledDepartmentIds: Set<string>;
  ledTeamIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["org-tree"] });
  }

  const updateMutation = useMutation({
    mutationFn: (name: string) => api.put(`/estrutura-organizacional/channels/${channel.id}`, { name }),
    onSuccess: () => {
      invalidate();
      setIsEditing(false);
      setError(null);
    },
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível salvar o Canal.")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/estrutura-organizacional/channels/${channel.id}`),
    onSuccess: invalidate,
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível excluir o Canal.")),
  });

  function handleDelete() {
    if (window.confirm(`Excluir o canal "${channel.name}"? Essa ação não pode ser desfeita.`)) {
      setError(null);
      deleteMutation.mutate();
    }
  }

  const createDepartmentMutation = useMutation({
    mutationFn: (name: string) =>
      api.post("/estrutura-organizacional/departments", { name, channelId: channel.id }),
    onSuccess: () => {
      invalidate();
      setIsAddingDepartment(false);
      setError(null);
    },
    onError: (mutationError) =>
      setError(extractErrorMessage(mutationError, "Não foi possível criar o Departamento.")),
  });

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start justify-between gap-2 bg-card px-4 py-3">
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
                initialValue={channel.name}
                placeholder="Nome do canal"
                submitLabel="Salvar"
                onSubmit={(name) => updateMutation.mutate(name)}
                onCancel={() => setIsEditing(false)}
                isSubmitting={updateMutation.isPending}
              />
            ) : (
              <span className="font-medium text-foreground">{channel.name}</span>
            )}
          </div>

          {!isEditing && (
            <div className="pl-6">
              <ResponsibleList responsibles={channel.responsibles} />
            </div>
          )}
        </div>

        {!isEditing && isAdmin && (
          <div className="flex gap-3 text-sm">
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

      {error && <p className="px-4 pb-2 text-xs text-destructive">{error}</p>}

      {isExpanded && (
        <div className="space-y-2 border-t border-border p-4 pl-8">
          {channel.departments.map((department) => (
            <DepartmentRow
              key={department.id}
              department={department}
              ledDepartmentIds={ledDepartmentIds}
              ledTeamIds={ledTeamIds}
            />
          ))}

          {/* PASSO 11.7: criar Departamento dentro de um Canal liderado já
              é permitido a Gestor (mesma regra de createMember/createTeam) —
              diferente de editar/excluir o próprio Canal, que fica acima. */}
          {(isAdmin || ledChannelIds.has(channel.id)) &&
            (isAddingDepartment ? (
              <InlineNameForm
                placeholder="Nome do departamento"
                submitLabel="Adicionar"
                onSubmit={(name) => createDepartmentMutation.mutate(name)}
                onCancel={() => setIsAddingDepartment(false)}
                isSubmitting={createDepartmentMutation.isPending}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingDepartment(true)}
                className="text-sm text-primary hover:underline"
              >
                + Departamento
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
