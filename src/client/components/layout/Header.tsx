import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, ChevronDown, LogOut, Menu, PanelLeft, PanelLeftClose, Search } from "lucide-react";
import { api, getErrorMessage } from "@/services/api";
import { PERMISSION_LEVEL_LABELS, useAuthStore, type AuthUser, type CompanyMembership } from "@/store/auth.store";
import { useIdentityStore } from "@/store/identity.store";
import { useNotifications } from "./useNotifications";

interface MyProfile {
  email: string;
  role: "OPERACIONAL" | "LIDERANCA_NO" | "ADMINISTRADOR";
  company: { id: string; name: string };
}

export function Header({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenMobileNav,
  onOpenSearch,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileNav: () => void;
  onOpenSearch: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [companySwitchError, setCompanySwitchError] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const { notifications } = useNotifications();
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Compartilha cache com UsuariosPage (mesma queryKey) — a identificação de
  // tenant no header não dispara uma segunda chamada de rede na maioria das
  // sessões, só lê o que já foi buscado.
  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data } = await api.get<MyProfile>("/permissoes/meu-perfil");
      return data;
    },
  });

  // Só busca a lista de empresas quando o menu abre — a maioria dos
  // usuários tem uma única empresa e nunca precisa dessa chamada.
  const { data: myCompanies } = useQuery({
    queryKey: ["my-companies"],
    queryFn: async () => {
      const { data } = await api.get<CompanyMembership[]>("/permissoes/minhas-empresas");
      return data;
    },
    enabled: userMenuOpen,
  });

  async function handleSwitchCompany(companyId: string) {
    setCompanySwitchError(null);
    try {
      const { data } = await api.post<{ status: "OK"; token: string; user: AuthUser }>("/permissoes/trocar-empresa", {
        companyId,
      });
      setSession(data.token, data.user);
      // Todo dado em cache pertence à empresa anterior — descartar evita
      // uma tela mostrar, por um instante, dado de outra empresa.
      queryClient.clear();
      setUserMenuOpen(false);
      navigate("/estrutura-organizacional");
    } catch (err) {
      setCompanySwitchError(getErrorMessage(err, "Não foi possível trocar de empresa."));
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Abre o painel de conta (entrar em outra empresa / cadastrar nova /
  // aceitar convites). Aquelas rotas exigem token de IDENTIDADE, que a
  // sessão de tenant não tem — o backend troca um pelo outro a partir da
  // sessão já autenticada, evitando um logout/login só para isso.
  async function handleGoToAccount() {
    setCompanySwitchError(null);
    try {
      const { data } = await api.post<{ token: string; email: string }>("/permissoes/token-identidade");
      useIdentityStore.getState().setIdentity(data.token, data.email);
      setUserMenuOpen(false);
      navigate("/minha-conta");
    } catch (err) {
      setCompanySwitchError(getErrorMessage(err, "Não foi possível abrir sua conta."));
    }
  }

  function handleLogout() {
    clearSession();
    navigate("/login");
  }

  return (
    <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-2">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Abrir menu de navegação"
        className="rounded-md border border-border p-1.5 text-foreground hover:bg-secondary/50 md:hidden"
      >
        <Menu className="size-4" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"}
        aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
        className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground md:inline-flex"
      >
        {sidebarCollapsed ? <PanelLeft className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
      </button>

      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-foreground">GMC</p>
        {profile && (
          <span className="hidden rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground sm:inline">
            {profile.company.name}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-2 flex flex-1 max-w-sm items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary/50"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden truncate sm:inline">Buscar tela...</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground/70 sm:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <div className="relative" ref={notificationsRef}>
          <button
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
            aria-label="Notificações"
            aria-expanded={notificationsOpen}
            className="relative rounded-md p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          >
            <Bell className="size-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex size-2 rounded-full bg-destructive" aria-hidden="true" />
            )}
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-border bg-popover p-3 text-sm shadow-sm">
              <p className="font-medium text-foreground">Notificações</p>
              {notifications.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Nenhuma notificação por enquanto — este produto ainda não tem um gerador de eventos (gatilho
                  liberado, fechamento pendente etc.) ligado a este painel.
                </p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                  {notifications.map((notification) => (
                    <li key={notification.id} className="rounded-md border border-border p-2">
                      <p className="font-medium text-foreground">{notification.title}</p>
                      <p className="text-xs text-muted-foreground">{notification.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            aria-label="Menu do usuário"
            aria-expanded={userMenuOpen}
            className="flex items-center gap-1.5 rounded-md p-1.5 text-sm text-foreground hover:bg-secondary/50"
          >
            <span className="hidden max-w-[12rem] truncate sm:inline">{user?.email}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-border bg-popover p-1 text-sm shadow-sm">
              <div className="px-2 py-1.5">
                <p className="truncate text-foreground">{user?.email}</p>
                {user?.role && <p className="text-xs text-muted-foreground">{PERMISSION_LEVEL_LABELS[user.role]}</p>}
              </div>

              {/* A seção aparece SEMPRE que há empresas, não só com mais de
                  uma: com uma só, ela mostra onde a pessoa está e dá acesso
                  a "Entrar em outra empresa" — antes, quem tinha uma
                  empresa não via nem indício de que dava para ter outras. */}
              {myCompanies && myCompanies.length > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {myCompanies.length > 1 ? "Trocar de empresa" : "Empresa atual"}
                  </p>
                  {companySwitchError && (
                    <p className="px-2 pb-1 text-xs text-destructive">{companySwitchError}</p>
                  )}
                  {myCompanies.map((company) => (
                    <button
                      key={company.companyId}
                      type="button"
                      disabled={company.companyId === user?.companyId}
                      onClick={() => handleSwitchCompany(company.companyId)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-secondary/50 disabled:cursor-default disabled:font-medium disabled:opacity-70"
                    >
                      <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{company.companyName}</span>
                    </button>
                  ))}
                </>
              )}

              <div className="my-1 border-t border-border" />
              {/* Leva ao painel de identidade, onde ficam os caminhos de
                  entrar em outra empresa, cadastrar uma nova e aceitar
                  convites. Exige um token de identidade, que só o login
                  emite — por isso passa pela tela de login. */}
              <button
                type="button"
                onClick={handleGoToAccount}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-secondary/50"
              >
                <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                Entrar em outra empresa
              </button>

              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-destructive hover:bg-secondary/50"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
