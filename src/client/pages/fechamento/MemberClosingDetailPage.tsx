import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "@/store/auth.store";
import { useClosingDetail, useReopenClosing, useSaveClosing } from "./useFechamentoQueries";
import { ClosingDetailView, campaignRowKey, formatDate, formatMonth } from "./ClosingDetailView";
import type { BenefitApprovalStatus } from "./types";

// O backend recusa payloads inválidos com uma mensagem específica via
// ConflictError (409) ou "Dados inválidos" (400, Zod) — sem isso, todo erro
// mostraria a mesma mensagem genérica, mascarando a causa real.
function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

export function MemberClosingDetailPage() {
  const { memberId, referenceMonth } = useParams<{ memberId: string; referenceMonth: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.user?.role);
  const ownMemberId = useAuthStore((state) => state.user?.memberId);
  // Gestor vê o próprio Fechamento normalmente, mas não pode Fechar/Reabrir
  // o próprio benefício — só um Administrador fecha/reabre o de um Gestor.
  const isSelfClosing = role === "LIDERANCA_NO" && !!ownMemberId && ownMemberId === memberId;
  // PASSO 9.12: Usuário passou a acessar esta tela, mas só em modo leitura —
  // nunca Aprova/Reprova Campanha, edita Comentários/Ajuste, Fecha ou Reabre.
  const isReadOnly = role === "OPERACIONAL";

  const { data: detail, isLoading } = useClosingDetail(memberId ?? null, referenceMonth ?? null);
  const saveClosing = useSaveClosing(memberId ?? "", referenceMonth ?? "");
  const reopenClosing = useReopenClosing(memberId ?? "", referenceMonth ?? "");

  const [approvals, setApprovals] = useState<Record<string, BenefitApprovalStatus>>({});
  const [comments, setComments] = useState("");
  const [manualAdjustmentValue, setManualAdjustmentValue] = useState("");
  const [manualAdjustmentReason, setManualAdjustmentReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) return;
    setApprovals(Object.fromEntries(detail.campaigns.map((c) => [campaignRowKey(c.receivablesBaseId, c.periodStart), c.approvalStatus])));
    setComments(detail.comments ?? "");
    setManualAdjustmentValue(detail.manualAdjustmentValue ?? "");
    setManualAdjustmentReason(detail.manualAdjustmentReason ?? "");
  }, [detail]);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const isLocked = detail.isSaved;
  const closingDetail = detail;

  function handleSave() {
    setError(null);
    saveClosing.mutate(
      {
        approvals: closingDetail.campaigns.map((c) => ({
          receivablesBaseId: c.receivablesBaseId,
          // periodStart chega da API como datetime ISO completo (Date do
          // servidor serializado via toISOString()) — a API espera só
          // "AAAA-MM-DD" (isoDate), senão o Zod recusa com 400 e a tela
          // mostra sempre a mesma mensagem genérica de erro, mascarando a
          // causa real.
          periodStart: c.periodStart.slice(0, 10),
          approvalStatus: approvals[campaignRowKey(c.receivablesBaseId, c.periodStart)] ?? "APROVADO",
        })),
        comments: comments.trim() || null,
        manualAdjustmentValue: manualAdjustmentValue.trim() ? Number(manualAdjustmentValue) : null,
        manualAdjustmentReason: manualAdjustmentReason.trim() || null,
      },
      { onError: (mutationError) => setError(extractErrorMessage(mutationError, "Não foi possível salvar o Fechamento.")) },
    );
  }

  const displayReadOnly = isLocked || isReadOnly;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-xs text-primary hover:underline"
          >
            ← Voltar
          </button>
          <h1 className="text-xl font-semibold capitalize text-foreground">
            {detail.memberName} — {formatMonth(detail.referenceMonth)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {detail.cargoName}
            {detail.hierarchyPath ? ` — ${detail.hierarchyPath.replace(/>/g, " > ")}` : ""} — Status: {detail.status === "FECHADO" ? "Fechado" : detail.status === "ABERTO" ? "Aberto" : "Previsto"}
          </p>
        </div>
        {isLocked && !isReadOnly && (
          <button
            type="button"
            disabled={reopenClosing.isPending || isSelfClosing}
            title={isSelfClosing ? "Você não pode reabrir o seu próprio benefício — peça a um Administrador." : undefined}
            onClick={() => reopenClosing.mutate()}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            {reopenClosing.isPending ? "Reabrindo..." : "Reabrir"}
          </button>
        )}
      </div>

      {isReadOnly && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Visão somente leitura do seu Fechamento — Aprovação, Comentários, Ajuste, Fechar e Reabrir são exclusivos de Administrador/Gestor.
        </p>
      )}

      {isSelfClosing && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Este é o seu próprio Fechamento — você pode visualizar, mas só um Administrador pode Fechar ou Reabrir o seu benefício.
        </p>
      )}

      <ClosingDetailView
        detail={detail}
        approvals={approvals}
        readOnly={displayReadOnly}
        disabled={isLocked || isReadOnly}
        onToggleApproval={(key, status) => setApprovals((prev) => ({ ...prev, [key]: status }))}
        onOpenRecebiveis={(campaign) => {
          const periodStart = campaign.periodStart.slice(0, 10);
          const periodEnd = new Date(new Date(campaign.periodEndExclusive).getTime() - 86400000).toISOString().slice(0, 10);
          const params = new URLSearchParams({
            entityType: "MEMBRO",
            entityIds: memberId ?? "",
            periodStart,
            periodEnd,
            highlightBaseId: campaign.receivablesBaseId,
            highlightPeriodStart: periodStart,
          });
          navigate(`/recebiveis?${params.toString()}`);
        }}
      />

      {!displayReadOnly && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Comentários e Ajuste</h3>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Comentários</label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={2}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Valor Adicional (R$)</label>
              <input
                type="number"
                step="0.01"
                value={manualAdjustmentValue}
                onChange={(e) => setManualAdjustmentValue(e.target.value)}
                className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs text-muted-foreground">Motivo (opcional)</label>
              <input
                value={manualAdjustmentReason}
                onChange={(e) => setManualAdjustmentReason(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="button"
            disabled={saveClosing.isPending || isSelfClosing}
            title={isSelfClosing ? "Você não pode fechar o seu próprio benefício — peça a um Administrador." : undefined}
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saveClosing.isPending ? "Salvando..." : "Salvar Fechamento"}
          </button>
        </div>
      )}
      {isLocked && detail.closedAt && (
        <p className="text-xs text-muted-foreground">Fechado em {formatDate(detail.closedAt)}. Reabra para editar.</p>
      )}
    </div>
  );
}
