import { useState, type FormEvent } from "react";
import { identityApi, getIdentityErrorMessage } from "@/services/identity-api";

// Pedir acesso a uma empresa existente usando o código que o Admin dela
// divulgou. Confirma o nome da empresa antes de enviar — um código digitado
// errado que por acaso exista mandaria o pedido para a empresa errada.
export function SolicitarAcessoDialog({ onClose }: { onClose: () => void }) {
  const [inviteCode, setInviteCode] = useState("");
  const [company, setCompany] = useState<{ companyName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDone, setIsDone] = useState(false);

  async function handleCheck(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      const { data } = await identityApi.get<{ companyName: string }>("/identidade/empresa", {
        params: { inviteCode },
      });
      setCompany(data);
    } catch (err) {
      setError(getIdentityErrorMessage(err, "Código de convite inválido."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setIsBusy(true);
    try {
      await identityApi.post("/identidade/solicitar-acesso", { inviteCode });
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
              O administrador de <strong>{company?.companyName}</strong> vai receber seu pedido. Você será avisado por
              e-mail quando ele for aprovado.
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
          <>
            <div>
              <h2 className="text-lg font-medium text-foreground">Requisitar acesso a empresa</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Peça ao administrador da empresa o código de convite e informe abaixo.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {company ? (
              <div className="space-y-4">
                <div className="rounded-md border border-input px-3 py-2">
                  <p className="text-xs text-muted-foreground">Empresa encontrada</p>
                  <p className="text-sm font-medium text-foreground">{company.companyName}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleConfirm}
                    className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {isBusy ? "Enviando..." : "Confirmar pedido"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompany(null)}
                    className="rounded-md border border-input px-3 py-2 text-sm text-foreground"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCheck} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm text-foreground" htmlFor="inviteCode">
                    Código da empresa
                  </label>
                  <input
                    id="inviteCode"
                    required
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    placeholder="Ex.: ABCDE12345"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase text-foreground"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {isBusy ? "Verificando..." : "Continuar"}
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
          </>
        )}
      </div>
    </div>
  );
}
