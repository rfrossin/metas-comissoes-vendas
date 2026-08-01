import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "@/store/auth.store";
import { useClosingDetail, useReopenClosing, useSaveClosing } from "./useFechamentoQueries";
import type { BenefitApprovalStatus, ClosingCampaignRow, RewardType } from "./types";

// O backend recusa payloads inválidos com uma mensagem específica via
// ConflictError (409) ou "Dados inválidos" (400, Zod) — sem isso, todo erro
// mostraria a mesma mensagem genérica, mascarando a causa real.
function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

const REWARD_LABELS: Record<RewardType, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

function fmt(value: string): string {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}
function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Uma Base pode aparecer mais de uma vez no mesmo Fechamento (ex: Base
// Semanal ~4 janelas/mês) — receivablesBaseId sozinho não identifica a
// linha, precisa da janela (periodStart) junto. Mesma chave usada no backend.
function campaignRowKey(receivablesBaseId: string, periodStart: string): string {
  return `${receivablesBaseId}:${periodStart.slice(0, 10)}`;
}

// Cor do "cartão" de cada Campanha (pedido explícito do usuário): Reprovado
// = cinza; Aprovado com valor = verde (o modelo usual); Aprovado mas Zerado
// (não elegível ou payout 0) = azul.
function campaignColorClass(approvalStatus: BenefitApprovalStatus, payoutValue: string): string {
  if (approvalStatus === "REPROVADO") return "border-l-4 border-l-muted-foreground bg-secondary/30";
  if (Number(payoutValue) === 0) return "border-l-4 border-l-sky-500 bg-sky-500/5";
  return "border-l-4 border-l-success bg-success/5";
}

function CampaignCard({
  campaign,
  approvalStatus,
  disabled,
  onToggleApproval,
  onOpenRecebiveis,
}: {
  campaign: ClosingCampaignRow;
  approvalStatus: BenefitApprovalStatus;
  disabled: boolean;
  onToggleApproval: (status: BenefitApprovalStatus) => void;
  onOpenRecebiveis: () => void;
}) {
  return (
    <div className={`space-y-2 rounded-md border border-border p-3 ${campaignColorClass(approvalStatus, campaign.payoutValue)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div onClick={onOpenRecebiveis} className="cursor-pointer hover:underline" title="Ver em Recebíveis">
          <p className="text-sm font-medium text-foreground">{campaign.baseName}</p>
          <p className="text-xs text-muted-foreground">
            {campaign.indicatorLabel} — {campaign.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"} — {formatDate(campaign.periodStart)} a{" "}
            {formatDate(new Date(new Date(campaign.periodEndExclusive).getTime() - 86400000).toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggleApproval("APROVADO")}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${approvalStatus === "APROVADO" ? "border-success bg-success text-success-foreground" : "border-border text-foreground hover:bg-secondary/50"}`}
          >
            Aprovar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggleApproval("REPROVADO")}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${approvalStatus === "REPROVADO" ? "border-muted-foreground bg-muted-foreground text-white" : "border-border text-foreground hover:bg-secondary/50"}`}
          >
            Reprovar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <p>
          <span className="text-muted-foreground">Resultado apurado: </span>
          {fmt(campaign.realizedValue)}
        </p>
        <p>
          <span className="text-muted-foreground">% Atingido: </span>
          {campaign.attainmentPercentage != null ? `${fmt(campaign.attainmentPercentage)}%` : "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Elegível: </span>
          {campaign.eligible ? "Sim" : `Não (${campaign.blockedReason ?? "—"})`}
        </p>
        <p>
          <span className="text-muted-foreground">Valor do benefício: </span>
          <span className="font-medium">{fmt(campaign.payoutValue)}</span>
        </p>
      </div>

      {campaign.tierBreakdown.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {campaign.tierBreakdown.map((tier, index) => (
            <li key={index}>
              Degrau #{tier.order} — {REWARD_LABELS[tier.rewardType]}
              {tier.baseValueUsed ? ` sobre ${fmt(tier.baseValueUsed)}` : ""}
              {tier.physicalPrizeDescription ? ` — ${tier.physicalPrizeDescription}` : ` = ${fmt(tier.computedAmount)}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-5">
        <div>
          <p className="text-xs text-muted-foreground">Fixo</p>
          <p className="text-lg font-semibold text-foreground">{fmt(detail.fixedValue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">% sobre o Fixo</p>
          <p className="text-lg font-semibold text-foreground">{fmt(detail.benefitsByType.PERCENT_FIXO)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">% sobre o Resultado</p>
          <p className="text-lg font-semibold text-foreground">{fmt(detail.benefitsByType.PERCENT_RESULTADO)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Específico</p>
          <p className="text-lg font-semibold text-foreground">{fmt(detail.benefitsByType.VALOR_FIXO)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-semibold text-primary">{fmt(detail.totalValue)}</p>
        </div>
      </div>

      {detail.benefitsByType.PREMIO_FISICO.length > 0 && (
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">Premiações Físicas: </span>
          {detail.benefitsByType.PREMIO_FISICO.join("; ")}
        </p>
      )}

      {detail.resultsByType.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Resultados do Período (todos os Tipos lançados)</h3>
          <div className="flex flex-wrap gap-4 text-sm">
            {detail.resultsByType.map((r) => (
              <p key={r.resultTypeId}>
                <span className="text-muted-foreground">{r.resultTypeName}: </span>
                {fmt(r.totalValue)}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Campanhas de Recebível</h3>
        {detail.campaigns.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma Campanha de Recebível ativa para este Membro neste Fechamento.</p>}
        {detail.campaigns.map((campaign) => {
          const key = campaignRowKey(campaign.receivablesBaseId, campaign.periodStart);
          return (
            <CampaignCard
              key={key}
              campaign={campaign}
              approvalStatus={approvals[key] ?? "APROVADO"}
              disabled={isLocked || isReadOnly}
              onToggleApproval={(status) => setApprovals((prev) => ({ ...prev, [key]: status }))}
              onOpenRecebiveis={() => {
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
          );
        })}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Comentários e Ajuste</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Comentários</label>
          <textarea
            value={comments}
            disabled={isLocked || isReadOnly}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Valor Adicional (R$)</label>
            <input
              type="number"
              step="0.01"
              value={manualAdjustmentValue}
              disabled={isLocked || isReadOnly}
              onChange={(e) => setManualAdjustmentValue(e.target.value)}
              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground">Motivo (opcional)</label>
            <input
              value={manualAdjustmentReason}
              disabled={isLocked || isReadOnly}
              onChange={(e) => setManualAdjustmentReason(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!isLocked && !isReadOnly && (
          <button
            type="button"
            disabled={saveClosing.isPending || isSelfClosing}
            title={isSelfClosing ? "Você não pode fechar o seu próprio benefício — peça a um Administrador." : undefined}
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saveClosing.isPending ? "Salvando..." : "Salvar Fechamento"}
          </button>
        )}
        {isLocked && detail.closedAt && (
          <p className="text-xs text-muted-foreground">Fechado em {formatDate(detail.closedAt)}. Reabra para editar.</p>
        )}
      </div>
    </div>
  );
}
