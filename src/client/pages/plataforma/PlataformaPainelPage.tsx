import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { platformApi, getPlatformErrorMessage } from "@/services/platform-api";
import { usePlatformAuthStore } from "@/store/platform-auth.store";

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
  createdAt: string;
  member: { fullName: string } | null;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const [requestsRes, companiesRes, platformUsersRes] = await Promise.all([
        platformApi.get<CompanySignupRequest[]>("/plataforma/pedidos-empresa", { params: { status: "PENDENTE" } }),
        platformApi.get<CompanyWithUsers[]>("/plataforma/empresas"),
        platformApi.get<PlatformUserRow[]>("/plataforma/usuarios"),
      ]);
      setRequests(requestsRes.data);
      setCompanies(companiesRes.data);
      setPlatformUsers(platformUsersRes.data);
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível carregar os dados."));
    } finally {
      setIsLoading(false);
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
                  <span className="text-xs text-muted-foreground">{company.status}</span>
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
                        <th className="pb-1 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {company.users.map((user) => (
                        <tr key={user.id} className="border-t border-border/50">
                          <td className="py-1 pr-2 text-foreground">{user.member?.fullName ?? "—"}</td>
                          <td className="py-1 pr-2 text-foreground">{user.email}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{user.role}</td>
                          <td className="py-1 text-muted-foreground">{user.isActive ? "Ativo" : "Inativo"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
