import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { GestaoUsuariosSection } from "./GestaoUsuariosSection";
import { PERMISSION_LEVEL_LABELS, hierarchyLabel, type MyProfile } from "./types";

// Painel de auto-atendimento (spec do usuário): todo colaborador vê seus
// próprios dados/vínculos e troca a própria senha aqui. Administradores
// ganham, na mesma página, a seção de gestão de usuários/convites/empresa
// (GestaoUsuariosSection) — evita uma tela extra só para isso.
export function UsuariosPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data } = await api.get<MyProfile>("/permissoes/meu-perfil");
      return data;
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => api.put("/permissoes/minha-senha", { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError(null);
      setPasswordSuccess(true);
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Não foi possível trocar a senha.";
      setPasswordError(message);
      setPasswordSuccess(false);
    },
  });

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordSuccess(false);
    if (newPassword.length < 8) {
      setPasswordError("A nova senha deve ter ao menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("A confirmação não confere com a nova senha.");
      return;
    }
    setPasswordError(null);
    changePasswordMutation.mutate();
  }

  if (isLoading || !profile) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usuários</h1>
        <p className="text-sm text-muted-foreground">Seus dados de login, vínculos e segurança da conta.</p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Meus Dados</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Nome</dt>
            <dd className="text-foreground">{profile.member?.fullName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">E-mail (login)</dt>
            <dd className="text-foreground">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Empresa</dt>
            <dd className="text-foreground">{profile.company.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cargo</dt>
            <dd className="text-foreground">{profile.member?.cargo.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tipo de Usuário</dt>
            <dd className="text-foreground">{PERMISSION_LEVEL_LABELS[profile.role]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Hierarquia</dt>
            <dd className="text-foreground">{hierarchyLabel(profile.member)}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Segurança</h2>
        <form onSubmit={handlePasswordSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Senha atual</label>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nova senha</label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Confirmar nova senha</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {changePasswordMutation.isPending ? "Salvando..." : "Trocar senha"}
          </button>
        </form>
        {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
        {passwordSuccess && <p className="text-sm text-foreground">Senha alterada com sucesso.</p>}
      </div>

      {(profile.role === "ADMINISTRADOR" || profile.role === "LIDERANCA_NO") && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Gestão de Usuários</h2>
          <GestaoUsuariosSection companyName={profile.company.name} role={profile.role} />
        </div>
      )}
    </div>
  );
}
