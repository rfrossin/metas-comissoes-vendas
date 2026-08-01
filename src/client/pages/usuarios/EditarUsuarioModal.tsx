import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { Modal } from "@/pages/bases-recebiveis/Modal";
import { MemberLinkPicker } from "./MemberLinkPicker";
import { ScopeAssignmentEditor, type DraftAssignment } from "./ScopeAssignmentEditor";
import { PERMISSION_LEVEL_LABELS, type CompanyUser, type PermissionLevel, type ScopeAssignment } from "./types";

function extractErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message ?? fallback;
}

export function EditarUsuarioModal({ user, onClose }: { user: CompanyUser; onClose: () => void }) {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.user!.companyId);
  const [role, setRole] = useState<PermissionLevel>(user.role);
  const [email, setEmail] = useState(user.email);
  const [assignments, setAssignments] = useState<DraftAssignment[]>(
    user.scopeAssignments.map((a) => ({ scopeType: a.scopeType, scopeId: a.scopeId, accessLevel: a.accessLevel })),
  );
  const [memberId, setMemberId] = useState<string | null>(user.member?.id ?? null);
  const [canLaunchOwnMemberResults, setCanLaunchOwnMemberResults] = useState(user.canLaunchOwnMemberResults);
  const [error, setError] = useState<string | null>(null);

  // Reaproveita o cache já carregado pela tela pai (mesma queryKey) para
  // saber quais Membros já estão vinculados a OUTRO usuário — sem disparo de
  // rede extra. Lido direto do cache (não via useQuery): um segundo
  // observer sem queryFn na mesma key colide com o observer real da tela
  // pai e o TanStack Query passa a rejeitar refetches dessa key inteira com
  // "No queryFn was passed".
  const allUsers = queryClient.getQueryData<CompanyUser[]>(["permissoes-usuarios"]);
  const excludeMemberIds = useMemo(
    () => (allUsers ?? []).filter((u) => u.id !== user.id && u.member).map((u) => u.member!.id),
    [allUsers, user.id],
  );

  const { data: fetchedAssignments, isLoading: isLoadingAssignments } = useQuery({
    queryKey: ["user-scope-assignments", user.id],
    queryFn: async () => {
      const { data } = await api.get<ScopeAssignment[]>(`/permissoes/usuarios/${user.id}/atribuicoes`);
      return data;
    },
    enabled: user.role !== "ADMINISTRADOR",
  });

  useEffect(() => {
    if (fetchedAssignments) {
      setAssignments(fetchedAssignments.map((a) => ({ scopeType: a.scopeType, scopeId: a.scopeId, accessLevel: a.accessLevel })));
    }
  }, [fetchedAssignments]);

  const roleMutation = useMutation({
    mutationFn: (newRole: PermissionLevel) => api.patch(`/permissoes/usuarios/${user.id}/role`, { role: newRole }),
  });

  // Admin define e-mail/senha de QUALQUER outro usuário (Usuário, Gestor ou
  // outro Admin) sem precisar da senha atual — o servidor bloqueia usar isto
  // no próprio usuário logado (existe uma troca de senha separada, em "meu
  // perfil", que exige a senha atual).
  const emailMutation = useMutation({
    mutationFn: (newEmail: string) => api.patch(`/permissoes/usuarios/${user.id}/email`, { email: newEmail }),
  });

  const assignmentsMutation = useMutation({
    mutationFn: (payload: DraftAssignment[]) => api.put(`/permissoes/usuarios/${user.id}/atribuicoes`, { assignments: payload }),
  });

  const memberMutation = useMutation({
    mutationFn: (newMemberId: string | null) => api.patch(`/permissoes/usuarios/${user.id}/membro`, { memberId: newMemberId }),
  });

  const resultsToggleMutation = useMutation({
    mutationFn: (value: boolean) => api.patch(`/permissoes/usuarios/${user.id}/resultados-proprio`, { canLaunchOwnMemberResults: value }),
  });

  const isSaving =
    roleMutation.isPending ||
    assignmentsMutation.isPending ||
    memberMutation.isPending ||
    resultsToggleMutation.isPending ||
    emailMutation.isPending;

  async function handleSave() {
    setError(null);

    if (role !== "ADMINISTRADOR") {
      const incomplete = assignments.some((assignment) => assignment.scopeType !== "EMPRESA" && !assignment.scopeId);
      if (incomplete) {
        setError("Preencha a entidade de todas as atribuições antes de salvar (ou remova a linha incompleta).");
        return;
      }
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Informe um e-mail de login.");
      return;
    }

    try {
      if (role !== user.role) {
        await roleMutation.mutateAsync(role);
      }
      if (role !== "ADMINISTRADOR") {
        await assignmentsMutation.mutateAsync(assignments);
      }
      if (memberId !== (user.member?.id ?? null)) {
        await memberMutation.mutateAsync(memberId);
      }
      const effectiveToggle = memberId ? canLaunchOwnMemberResults : false;
      if (memberId && effectiveToggle !== user.canLaunchOwnMemberResults) {
        await resultsToggleMutation.mutateAsync(effectiveToggle);
      }
      if (trimmedEmail !== user.email) {
        await emailMutation.mutateAsync(trimmedEmail);
      }
      queryClient.invalidateQueries({ queryKey: ["permissoes-usuarios"] });
      onClose();
    } catch (mutationError) {
      setError(extractErrorMessage(mutationError, "Não foi possível salvar as alterações."));
    }
  }

  return (
    <Modal title={`Editar ${user.member?.fullName ?? user.email}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo de Usuário</label>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as PermissionLevel)}
            className="w-full max-w-xs rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            {(Object.keys(PERMISSION_LEVEL_LABELS) as PermissionLevel[]).map((level) => (
              <option key={level} value={level}>
                {PERMISSION_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Credenciais de acesso</h3>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">E-mail de login</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full max-w-sm rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A senha é de responsabilidade do próprio usuário — ele pode alterá-la em seu perfil ou usar "Esqueci minha
            senha" na tela de login.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Vínculo com Membro do sistema</h3>
          <p className="text-xs text-muted-foreground">
            O vínculo concede automaticamente Visualizar de tudo o que está ligado diretamente a este Membro — não precisa de
            nenhuma atribuição extra para isso.
          </p>
          <MemberLinkPicker companyId={companyId} memberId={memberId} onChange={setMemberId} excludeMemberIds={excludeMemberIds} />
          {memberId && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={canLaunchOwnMemberResults}
                onChange={(event) => setCanLaunchOwnMemberResults(event.target.checked)}
              />
              Pode lançar/editar Resultados deste Membro
            </label>
          )}
        </div>

        {role === "ADMINISTRADOR" ? (
          <p className="text-sm text-muted-foreground">
            Administradores têm acesso irrestrito a todo o sistema — não há atribuições para configurar.
          </p>
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              {role === "LIDERANCA_NO" ? "Hierarquias lideradas" : "Hierarquias/Membros atribuídos"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {role === "LIDERANCA_NO"
                ? "Gestor tem permissão completa (visualizar + editar) em tudo abaixo de cada hierarquia selecionada, incluindo Bases de Recebível e Fechamentos."
                : "Para cada hierarquia ou Membro selecionado, escolha Visualizar ou Editar — vale para todos os módulos aplicáveis (Resultados, Metas, Acompanhamento, Recebíveis). Bases de Recebível e Fechamento continuam bloqueados para este papel."}
            </p>
            {isLoadingAssignments ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (
              <ScopeAssignmentEditor
                companyId={companyId}
                assignments={assignments}
                onChange={setAssignments}
                forcedAccessLevel={role === "LIDERANCA_NO" ? "EDITAR" : undefined}
              />
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
