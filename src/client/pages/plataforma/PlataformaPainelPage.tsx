import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { platformApi, getPlatformErrorMessage } from "@/services/platform-api";
import { usePlatformAuthStore } from "@/store/platform-auth.store";
import { UsuariosSemEmpresaSection } from "./UsuariosSemEmpresaSection";
import { VincularUsuarioSection } from "./VincularUsuarioSection";
import { GerenciarEmpresaCard } from "./GerenciarEmpresaCard";

interface CompanySignupRequest {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  status: "PENDENTE" | "APROVADO" | "REJEITADO";
  createdAt: string;
}

interface CompanyUser {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  // createdAt = entrada na empresa; leftAt = saída (null se ainda está lá).
  createdAt: string;
  leftAt: string | null;
  // Identidade Supabase — usada para oferecer a pessoa no seletor de
  // "adicionar usuário a uma empresa".
  authUserId: string | null;
  member: { fullName: string } | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface CompanyWithUsers {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  users: CompanyUser[];
}

interface PlatformUserRow {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPORTE";
}

export function PlataformaPainelPage() {
  const navigate = useNavigate();
  const platformUser = usePlatformAuthStore((state) => state.platformUser);
  const clearSession = usePlatformAuthStore((state) => state.clearSession);
  const [requests, setRequests] = useState<CompanySignupRequest[]>([]);
  const [companies, setCompanies] = useState<CompanyWithUsers[]>([]);
  const [platformUsers, setPlatformUsers] = useState<PlatformUserRow[]>([]);
  // Identidades sem empresa — alimentam o seletor de "vincular usuario".
  const [orphans, setOrphans] = useState<{ authUserId: string; email: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Remoção de um usuário de uma empresa (saída), pedindo confirmação —
  // é ação destrutiva de acesso e não deve disparar num clique só.
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<"SUPER_ADMIN" | "SUPORTE">("SUPER_ADMIN");
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [createUserSuccess, setCreateUserSuccess] = useState<string | null>(null);

  async function loadAll() {
    setIsLoading(true);
    setError(null);
    try {
      const [requestsRes, companiesRes, platformUsersRes, orphansRes] = await Promise.all([
        platformApi.get<CompanySignupRequest[]>("/plataforma/pedidos-empresa", { params: { status: "PENDENTE" } }),
        platformApi.get<CompanyWithUsers[]>("/plataforma/empresas"),
        platformApi.get<PlatformUserRow[]>("/plataforma/usuarios"),
        platformApi.get<{ authUserId: string; email: string }[]>("/plataforma/usuarios-sem-empresa"),
      ]);
      setRequests(requestsRes.data);
      setCompanies(companiesRes.data);
      setPlatformUsers(platformUsersRes.data);
      setOrphans(orphansRes.data);
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível carregar os dados."));
    } finally {
      setIsLoading(false);
    }
  }

  // Encerra o vínculo do usuário com a empresa (leftAt). A identidade
  // continua existindo e pode entrar em outra empresa — diferente de
  // excluir o login, que fica na seção de usuários sem empresa.
  async function handleRemoveFromCompany(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      await platformApi.delete(`/plataforma/vinculos/${userId}`);
      setConfirmRemoveUserId(null);
      await loadAll();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível remover o usuário da empresa."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreatePlatformUser(event: FormEvent) {
    event.preventDefault();
    setIsCreatingUser(true);
    setCreateUserError(null);
    setCreateUserSuccess(null);
    try {
      await platformApi.post("/plataforma/usuarios", { name: newUserName, email: newUserEmail, role: newUserRole });
      setCreateUserSuccess(`Convite enviado para ${newUserEmail}.`);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserRole("SUPER_ADMIN");
      await loadAll();
    } catch (err) {
      setCreateUserError(getPlatformErrorMessage(err, "Não foi possível criar o usuário."));
    } finally {
      setIsCreatingUser(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApprove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await platformApi.post(`/plataforma/pedidos-empresa/${id}/aprovar`);
      await loadAll();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível aprovar o pedido."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    const reason = window.prompt("Motivo da rejeição (opcional):") ?? "";
    setBusyId(id);
    setError(null);
    try {
      await platformApi.post(`/plataforma/pedidos-empresa/${id}/rejeitar`, { reason });
      await loadAll();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível rejeitar o pedido."));
    } finally {
      setBusyId(null);
    }
  }

  function handleLogout() {
    clearSession();
    navigate("/admin-plataforma/login");
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Painel da Plataforma</h1>
            <p className="text-sm text-muted-foreground">Logado como {platformUser?.name}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Sair
          </button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Pedidos de cadastro de empresa</h2>

          {!isLoading && requests.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum pedido pendente.</p>
          )}

          <div className="space-y-3">
            {requests.map((request) => (
              <div key={request.id} className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium text-foreground">{request.companyName}</p>
                <p className="text-sm text-muted-foreground">
                  {request.contactName} — {request.contactEmail}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(request.createdAt).toLocaleString("pt-BR")}
                </p>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === request.id}
                    onClick={() => handleApprove(request.id)}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={busyId === request.id}
                    onClick={() => handleReject(request.id)}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Usuários da plataforma</h2>

          <div className="space-y-2">
            {platformUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <span className="text-foreground">
                  {u.name} — {u.email}
                </span>
                <span className="text-xs text-muted-foreground">{u.role === "SUPER_ADMIN" ? "Super Admin" : "Suporte"}</span>
              </div>
            ))}
          </div>

          <form onSubmit={handleCreatePlatformUser} className="space-y-2 rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Adicionar novo usuário da plataforma</p>
            {createUserError && <p className="text-sm text-destructive">{createUserError}</p>}
            {createUserSuccess && <p className="text-sm text-success">{createUserSuccess}</p>}
            <div className="flex flex-wrap gap-2">
              <input
                required
                placeholder="Nome"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                className="w-48 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <input
                required
                type="email"
                placeholder="E-mail"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="w-64 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as "SUPER_ADMIN" | "SUPORTE")}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="SUPORTE">Suporte</option>
              </select>
              <button
                type="submit"
                disabled={isCreatingUser}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isCreatingUser ? "Enviando..." : "Convidar"}
              </button>
            </div>
          </form>
        </section>

        <UsuariosSemEmpresaSection />

        {/* Identidades conhecidas = as já vinculadas a alguma empresa MAIS
            as órfãs (que são justamente as que mais precisam ser
            vinculadas). Deduplicadas por authUserId: quem está em duas
            empresas apareceria repetido. */}
        <VincularUsuarioSection
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          identities={Array.from(
            new Map([
              ...companies
                .flatMap((c) => c.users)
                .filter((u) => u.authUserId)
                .map((u) => [u.authUserId as string, { authUserId: u.authUserId as string, email: u.email }] as const),
              ...orphans.map((o) => [o.authUserId, { authUserId: o.authUserId, email: o.email }] as const),
            ]).values(),
          ).sort((a, b) => a.email.localeCompare(b.email))}
          onLinked={() => void loadAll()}
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Empresas e usuários</h2>

          {!isLoading && companies.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada ainda.</p>
          )}

          <div className="space-y-4">
            {companies.map((company) => (
              <div key={company.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground">{company.name}</p>
                  <span
                    className={
                      company.status === "ATIVA"
                        ? "text-xs text-muted-foreground"
                        : "rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    }
                  >
                    {company.status === "ATIVA" ? "Ativa" : "Acesso pausado"}
                  </span>
                </div>

                {company.users.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum usuário nesta empresa ainda.</p>
                ) : (
                  <table className="mt-3 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-1 pr-2 font-normal">Nome</th>
                        <th className="pb-1 pr-2 font-normal">E-mail</th>
                        <th className="pb-1 pr-2 font-normal">Papel</th>
                        <th className="pb-1 pr-2 font-normal">Entrada</th>
                        <th className="pb-1 pr-2 font-normal">Saída</th>
                        <th className="pb-1 pr-2 font-normal">Status</th>
                        <th className="pb-1 font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {company.users.map((user) => (
                        <tr key={user.id} className="border-t border-border/50">
                          <td className="py-1 pr-2 text-foreground">{user.member?.fullName ?? "—"}</td>
                          <td className="py-1 pr-2 text-foreground">{user.email}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{user.role}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{formatDate(user.createdAt)}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{formatDate(user.leftAt)}</td>
                          <td className="py-1 pr-2 text-muted-foreground">
                            {user.leftAt ? "Saiu" : user.isActive ? "Ativo" : "Inativo"}
                          </td>
                          <td className="py-1 text-right">
                            {/* Quem já saiu não tem o que remover. */}
                            {!user.leftAt &&
                              (confirmRemoveUserId === user.id ? (
                                <span className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={busyId === user.id}
                                    onClick={() => void handleRemoveFromCompany(user.id)}
                                    className="rounded-md bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                                  >
                                    {busyId === user.id ? "..." : "Confirmar"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveUserId(null)}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveUserId(user.id)}
                                  className="rounded-md border border-input px-2 py-0.5 text-xs text-foreground hover:bg-secondary/50"
                                >
                                  Remover
                                </button>
                              ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <GerenciarEmpresaCard
                  company={{ id: company.id, name: company.name, status: company.status }}
                  onChanged={() => void loadAll()}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
