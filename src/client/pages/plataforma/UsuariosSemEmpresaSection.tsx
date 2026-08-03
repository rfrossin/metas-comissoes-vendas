import { useEffect, useState } from "react";
import { platformApi, getPlatformErrorMessage } from "@/services/platform-api";

interface OrphanIdentity {
  authUserId: string;
  email: string;
  name: string;
  createdAt: string;
  lastCompanyName: string | null;
  lastLeftAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Identidades sem nenhuma empresa ativa: quem criou conta e ainda não
// entrou em nenhuma, e quem saiu/foi removido da última. Não é uma fila de
// aprovação — cadastro de usuário não precisa de liberação do Super Admin
// (só empresa nova precisa). É visibilidade, mais a opção de excluir.
export function UsuariosSemEmpresaSection() {
  const [rows, setRows] = useState<OrphanIdentity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await platformApi.get<OrphanIdentity[]>("/plataforma/usuarios-sem-empresa");
      setRows(data);
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível carregar os usuários sem empresa."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete(authUserId: string) {
    setBusyId(authUserId);
    setError(null);
    try {
      await platformApi.delete(`/plataforma/identidades/${authUserId}`);
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível excluir o usuário."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Usuários sem empresa{rows.length > 0 ? ` (${rows.length})` : ""}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Contas criadas que ainda não entraram em nenhuma empresa, ou que saíram da última.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
        >
          Atualizar
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && rows.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">Nenhum usuário sem empresa.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Cadastro</th>
                <th className="px-3 py-2">Última empresa</th>
                <th className="px-3 py-2">Saída</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.authUserId} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground">{row.name || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.email}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.lastCompanyName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(row.lastLeftAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {confirmId === row.authUserId ? (
                      <span className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={busyId === row.authUserId}
                          onClick={() => void handleDelete(row.authUserId)}
                          className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                        >
                          {busyId === row.authUserId ? "Excluindo..." : "Confirmar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(row.authUserId)}
                        className="rounded-md border border-input px-3 py-1 text-xs text-foreground hover:bg-secondary/50"
                      >
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmId && (
        <p className="text-xs text-muted-foreground">
          Excluir remove o login do sistema. O histórico de fechamentos e lançamentos das empresas por onde a pessoa
          passou é preservado.
        </p>
      )}
    </section>
  );
}
