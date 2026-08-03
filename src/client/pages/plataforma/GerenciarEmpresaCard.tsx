import { useState } from "react";
import { platformApi, getPlatformErrorMessage } from "@/services/platform-api";

interface Props {
  company: { id: string; name: string; status: string };
  onChanged: () => void;
}

// Ações destrutivas/sensíveis sobre uma empresa, no painel da plataforma.
// Ambas pedem confirmação — a exclusão exige digitar o nome, porque apaga
// o histórico financeiro inteiro e não tem desfazer.
export function GerenciarEmpresaCard({ company, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");

  const isPaused = company.status !== "ATIVA";

  async function handleToggleStatus() {
    setIsBusy(true);
    setError(null);
    try {
      await platformApi.patch(`/plataforma/empresas/${company.id}/status`, {
        status: isPaused ? "ATIVA" : "BLOQUEADA_INADIMPLENCIA",
      });
      onChanged();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível alterar o status da empresa."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete() {
    setIsBusy(true);
    setError(null);
    try {
      // O backend revalida o nome digitado — a checagem daqui é só para
      // dar retorno imediato ao Super Admin.
      await platformApi.delete(`/plataforma/empresas/${company.id}`, {
        data: { confirmName: typedName },
      });
      setConfirmDelete(false);
      setTypedName("");
      onChanged();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível excluir a empresa."));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {isPaused && (
        <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          Acesso pausado: os usuários ainda conseguem fazer login, mas não podem ver nem alterar nada dentro desta
          empresa.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleToggleStatus()}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50 disabled:opacity-50"
        >
          {isPaused ? "Reativar acesso" : "Pausar acesso"}
        </button>

        {!confirmDelete && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setConfirmDelete(true)}
            className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            Excluir empresa
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="space-y-2 rounded-md border border-destructive/50 p-3">
          <p className="text-xs text-destructive">
            Isto apaga <strong>definitivamente</strong> a empresa e todos os dados dela — metas, resultados,
            recebíveis, fechamentos e histórico financeiro. Não há como desfazer.
          </p>
          <p className="text-xs text-muted-foreground">
            Para confirmar, digite o nome da empresa: <strong>{company.name}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={company.name}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            />
            <button
              type="button"
              disabled={isBusy || typedName.trim() !== company.name}
              onClick={() => void handleDelete()}
              className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50"
            >
              {isBusy ? "Excluindo..." : "Excluir definitivamente"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(false);
                setTypedName("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
