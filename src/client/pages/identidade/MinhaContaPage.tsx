import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { identityApi } from "@/services/identity-api";
import { useIdentityStore } from "@/store/identity.store";
import { useAuthStore, PERMISSION_LEVEL_LABELS, type PermissionLevel } from "@/store/auth.store";
import { ErrorState, LoadingState } from "@/components/AsyncState";
import { SolicitarAcessoDialog } from "./SolicitarAcessoDialog";
import { CriarEmpresaDialog } from "./CriarEmpresaDialog";

interface IdentityState {
  email: string;
  name: string;
  createdAt: string;
  companies: { companyId: string; companyName: string; role: PermissionLevel }[];
}

// Painel de quem está autenticado mas (normalmente) ainda não pertence a
// nenhuma empresa. É o destino do login com status NO_COMPANY e o único
// lugar de onde se pede acesso a uma empresa ou se cadastra uma nova.
export function MinhaContaPage() {
  const navigate = useNavigate();
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const identityEmail = useIdentityStore((state) => state.email);
  const [dialog, setDialog] = useState<"acesso" | "empresa" | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<IdentityState>({
    queryKey: ["identidade", "eu"],
    queryFn: async () => (await identityApi.get<IdentityState>("/identidade/eu")).data,
  });

  function handleLogout() {
    clearIdentity();
    navigate("/login");
  }

  // Quem chegou aqui já tendo empresa (ex.: veio criar uma segunda) volta
  // para o app pela porta normal: um novo login emite o token de tenant.
  // Não dá para "entrar" na empresa daqui — este token é de identidade, e
  // as rotas do sistema exigem token de tenant.
  function handleEntrarNaEmpresa() {
    useAuthStore.getState().clearSession();
    clearIdentity();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Minha conta</h1>
            <p className="mt-1 text-sm text-muted-foreground">{data?.email ?? identityEmail}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-secondary/50"
          >
            Sair
          </button>
        </header>

        {isLoading && <LoadingState />}
        {isError && <ErrorState onRetry={() => refetch()} />}

        {data && (
          <>
            {data.companies.length === 0 ? (
              <section className="space-y-4 rounded-lg border border-border bg-card p-6">
                <div>
                  <h2 className="text-lg font-medium text-foreground">
                    Você ainda não tem acesso a nenhuma empresa
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Para usar o sistema, você precisa estar vinculado a uma empresa cadastrada. Cadastre uma nova
                    empresa ou peça acesso a uma empresa existente usando o código de convite que o administrador
                    dela pode fornecer.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setDialog("empresa")}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Cadastrar nova empresa
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog("acesso")}
                    className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/50"
                  >
                    Requisitar acesso a empresa existente
                  </button>
                </div>
              </section>
            ) : (
              <section className="space-y-4 rounded-lg border border-border bg-card p-6">
                <h2 className="text-lg font-medium text-foreground">Suas empresas</h2>
                <ul className="space-y-2">
                  {data.companies.map((company) => (
                    <li
                      key={company.companyId}
                      className="flex items-center justify-between rounded-md border border-input px-3 py-2"
                    >
                      <span className="text-sm text-foreground">{company.companyName}</span>
                      <span className="text-xs text-muted-foreground">
                        {PERMISSION_LEVEL_LABELS[company.role] ?? company.role}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleEntrarNaEmpresa}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Entrar no sistema
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog("empresa")}
                    className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/50"
                  >
                    Cadastrar nova empresa
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog("acesso")}
                    className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/50"
                  >
                    Entrar em outra empresa
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {dialog === "acesso" && <SolicitarAcessoDialog onClose={() => setDialog(null)} />}
        {dialog === "empresa" && <CriarEmpresaDialog onClose={() => setDialog(null)} />}
      </div>
    </div>
  );
}
