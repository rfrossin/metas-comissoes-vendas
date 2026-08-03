import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";
import { ErrorState, LoadingState } from "@/components/AsyncState";

interface AccessRequest {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

// Código de convite da empresa + fila de pedidos de acesso feitos com ele.
// Só aparece para ADMINISTRADOR (o backend também barra, em assertAdmin).
export function CodigoConviteCard() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const codeQuery = useQuery({
    queryKey: ["codigo-convite"],
    queryFn: async () => (await api.get<{ inviteCode: string }>("/permissoes/codigo-convite")).data,
  });

  const requestsQuery = useQuery({
    queryKey: ["pedidos-acesso"],
    queryFn: async () => (await api.get<AccessRequest[]>("/permissoes/pedidos-acesso")).data,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.post<{ inviteCode: string }>("/permissoes/codigo-convite/regenerar"),
    onSuccess: () => {
      setConfirmRegenerate(false);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["codigo-convite"] });
    },
    onError: (error: unknown) => setActionError(getErrorMessage(error, "Não foi possível gerar um novo código.")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/permissoes/pedidos-acesso/${id}/aprovar`),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["pedidos-acesso"] });
      // O aprovado vira usuário da empresa — a lista de usuários muda junto.
      queryClient.invalidateQueries({ queryKey: ["company-users"] });
    },
    onError: (error: unknown) => setActionError(getErrorMessage(error, "Não foi possível aprovar o pedido.")),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/permissoes/pedidos-acesso/${id}/recusar`, { reason: "" }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["pedidos-acesso"] });
    },
    onError: (error: unknown) => setActionError(getErrorMessage(error, "Não foi possível recusar o pedido.")),
  });

  async function handleCopy() {
    if (!codeQuery.data) return;
    try {
      await navigator.clipboard.writeText(codeQuery.data.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard bloqueado (http, permissão negada) — o código está
      // visível na tela de qualquer forma, dá para copiar à mão.
      setActionError("Não foi possível copiar automaticamente. Copie o código manualmente.");
    }
  }

  const pending = requestsQuery.data ?? [];

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Código de convite da empresa</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Compartilhe este código com quem deve entrar na empresa. A pessoa cria a conta dela, informa o código e o
          pedido aparece aqui para você aprovar.
        </p>
      </div>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {codeQuery.isLoading && <LoadingState />}
      {codeQuery.isError && <ErrorState onRetry={() => codeQuery.refetch()} />}

      {codeQuery.data && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-input bg-background px-3 py-2 font-mono text-base tracking-widest text-foreground">
            {codeQuery.data.inviteCode}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-input px-3 py-2 text-sm text-foreground hover:bg-secondary/50"
          >
            {copied ? "Copiado!" : "Copiar"}
          </button>
          {confirmRegenerate ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={regenerateMutation.isPending}
                onClick={() => regenerateMutation.mutate()}
                className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
              >
                {regenerateMutation.isPending ? "Gerando..." : "Confirmar novo código"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRegenerate(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRegenerate(true)}
              className="rounded-md border border-input px-3 py-2 text-sm text-foreground hover:bg-secondary/50"
            >
              Gerar novo código
            </button>
          )}
        </div>
      )}

      {confirmRegenerate && (
        <p className="text-xs text-muted-foreground">
          Ao gerar um novo código, o anterior deixa de funcionar para novos pedidos. Pedidos que já estão na fila
          abaixo continuam válidos.
        </p>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-medium text-foreground">
          Pedidos de acesso{pending.length > 0 ? ` (${pending.length})` : ""}
        </h4>

        {requestsQuery.isLoading && <LoadingState />}
        {requestsQuery.isError && <ErrorState onRetry={() => requestsQuery.refetch()} />}

        {requestsQuery.data && pending.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum pedido pendente.</p>
        )}

        {pending.map((request) => (
          <div
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-input px-3 py-2"
          >
            <div>
              <p className="text-sm text-foreground">{request.name}</p>
              <p className="text-xs text-muted-foreground">{request.email}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate(request.id)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Aprovar
              </button>
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(request.id)}
                className="rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
              >
                Recusar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
