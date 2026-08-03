import { useState, type FormEvent } from "react";
import { identityApi, getIdentityErrorMessage } from "@/services/identity-api";

// Pedido de nova empresa feito por quem JÁ está logado. Só o nome da
// empresa é pedido: contato e identidade vêm da conta autenticada, e é
// esse vínculo que faz a empresa nascer já ligada a quem pediu, como
// Administrador, quando o Super Admin aprovar.
export function CriarEmpresaDialog({ onClose }: { onClose: () => void }) {
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await identityApi.post("/identidade/cadastrar-empresa", { companyName });
      setIsDone(true);
    } catch (err) {
      setError(getIdentityErrorMessage(err, "Não foi possível enviar o pedido."));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        {isDone ? (
          <>
            <h2 className="text-lg font-medium text-foreground">Pedido enviado</h2>
            <p className="text-sm text-muted-foreground">
              Seu pedido de cadastro foi enviado para análise. Quando for aprovado, a empresa já estará vinculada à sua
              conta como Administrador — basta fazer login novamente.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Fechar
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h2 className="text-lg font-medium text-foreground">Cadastrar nova empresa</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O pedido passa por aprovação. Depois de aprovado, você será o Administrador desta empresa.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="space-y-1">
              <label className="text-sm text-foreground" htmlFor="companyName">
                Nome da empresa
              </label>
              <input
                id="companyName"
                required
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isBusy}
                className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isBusy ? "Enviando..." : "Enviar pedido"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-input px-3 py-2 text-sm text-foreground"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
