import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { EditarUsuarioModal } from "./EditarUsuarioModal";
import { PERMISSION_LEVEL_LABELS, hierarchyLabel, type CompanyUser, type PendingInvite, type PermissionLevel } from "./types";

const emptyInviteForm = { name: "", email: "" };

// Convite (Admin ou Gestor) só pede Nome + e-mail. Empresa e a tabela de
// Usuários (edição/exclusão) continuam exclusivas do Admin — quando um
// Gestor abre esta seção, só o card de convite aparece.
export function GestaoUsuariosSection({ companyName, role }: { companyName: string; role: PermissionLevel }) {
  const isAdmin = role === "ADMINISTRADOR";
  const queryClient = useQueryClient();
  const [inviteForm, setInviteForm] = useState(emptyInviteForm);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [companyNameDraft, setCompanyNameDraft] = useState(companyName);
  const [editingUser, setEditingUser] = useState<CompanyUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: ["permissoes-usuarios"],
    queryFn: async () => {
      const { data } = await api.get<CompanyUser[]>("/permissoes/usuarios");
      return data;
    },
    enabled: isAdmin,
  });

  const { data: invites } = useQuery({
    queryKey: ["permissoes-convites"],
    queryFn: async () => {
      const { data } = await api.get<PendingInvite[]>("/permissoes/convites");
      return data;
    },
    enabled: isAdmin,
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/permissoes/usuarios/${id}/ativo`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["permissoes-usuarios"] }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/permissoes/usuarios/${id}`),
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ["permissoes-usuarios"] });
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Não foi possível excluir este usuário.";
      setDeleteError(message);
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/permissoes/convites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["permissoes-convites"] }),
  });

  const createInviteMutation = useMutation({
    mutationFn: () => api.post<{ token: string }>("/permissoes/convites", inviteForm),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["permissoes-convites"] });
      setGeneratedLink(`${window.location.origin}/convite/${data.token}`);
      setInviteForm(emptyInviteForm);
      setInviteError(null);
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Não foi possível gerar o convite.";
      setInviteError(message);
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: () => api.put("/permissoes/empresa", { name: companyNameDraft }),
  });

  function handleInviteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) return;
    createInviteMutation.mutate();
  }

  function handleDeleteUser(user: CompanyUser) {
    const label = user.member?.fullName ?? user.email;
    if (!window.confirm(`Excluir o usuário "${label}"? Essa ação não pode ser desfeita.`)) return;
    deleteUserMutation.mutate(user.id);
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Empresa</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Nome da Empresa</label>
              <input
                value={companyNameDraft}
                onChange={(event) => setCompanyNameDraft(event.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
            <button
              type="button"
              disabled={!companyNameDraft.trim() || updateCompanyMutation.isPending}
              onClick={() => updateCompanyMutation.mutate()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {updateCompanyMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
            {updateCompanyMutation.isSuccess && <span className="text-xs text-muted-foreground">Salvo.</span>}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Convidar novo usuário</h2>
        <form onSubmit={handleInviteSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nome completo</label>
            <input
              value={inviteForm.name}
              onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">E-mail (login)</label>
            <input
              type="email"
              value={inviteForm.email}
              onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={createInviteMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {createInviteMutation.isPending ? "Gerando..." : "Gerar convite"}
          </button>
        </form>
        {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}

        {generatedLink && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="mb-1 text-foreground">
              Convite enviado por e-mail ao colaborador. Se preferir, você também pode copiar o link abaixo e enviá-lo por outro meio:
            </p>
            <div className="flex items-center gap-2">
              <input readOnly value={generatedLink} className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs" />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(generatedLink)}
                className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary/50"
              >
                Copiar
              </button>
              <button
                type="button"
                onClick={() => setGeneratedLink(null)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {invites && invites.length > 0 && (
          <div className="pt-2">
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Convites pendentes</h3>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-1.5">Nome</th>
                    <th className="px-3 py-1.5">E-mail</th>
                    <th className="px-3 py-1.5">Expira em</th>
                    <th className="px-3 py-1.5">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => (
                    <tr key={invite.id} className="border-t border-border">
                      <td className="px-3 py-1.5">{invite.name}</td>
                      <td className="px-3 py-1.5">{invite.email}</td>
                      <td className="px-3 py-1.5">{new Date(invite.expiresAt).toLocaleDateString("pt-BR")}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/convite/${invite.token}`)}
                            className="text-xs text-primary hover:underline"
                          >
                            Copiar link
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelInviteMutation.mutate(invite.id)}
                            className="text-xs text-destructive hover:underline"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Usuários da Empresa</h2>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-1.5">Nome</th>
                  <th className="px-3 py-1.5">E-mail</th>
                  <th className="px-3 py-1.5">Cargo</th>
                  <th className="px-3 py-1.5">Hierarquia</th>
                  <th className="px-3 py-1.5">Tipo</th>
                  <th className="px-3 py-1.5">Status</th>
                  <th className="px-3 py-1.5">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingUsers && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                )}
                {users?.map((user) => (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-3 py-1.5">{user.member?.fullName ?? user.email}</td>
                    <td className="px-3 py-1.5">{user.email}</td>
                    <td className="px-3 py-1.5">{user.member?.cargo.name ?? "—"}</td>
                    <td className="px-3 py-1.5">{hierarchyLabel(user.member)}</td>
                    <td className="px-3 py-1.5">{PERMISSION_LEVEL_LABELS[user.role]}</td>
                    <td className="px-3 py-1.5">
                      {user.isActive ? <span className="text-foreground">Ativo</span> : <span className="text-muted-foreground">Inativo</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingUser(user)}
                          className="text-xs text-primary hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveMutation.mutate({ id: user.id, isActive: !user.isActive })}
                          className="text-xs text-primary hover:underline"
                        >
                          {user.isActive ? "Desativar" : "Reativar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingUser && <EditarUsuarioModal user={editingUser} onClose={() => setEditingUser(null)} />}
    </div>
  );
}
