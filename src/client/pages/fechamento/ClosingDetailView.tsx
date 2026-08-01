import type { BenefitApprovalStatus, ClosingCampaignRow, ClosingDetail, RewardType } from "./types";

export const REWARD_LABELS: Record<RewardType, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Específico",
  PREMIO_FISICO: "Premiação Física",
};

export function fmt(value: string): string {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}
export function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
}
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Uma Base pode aparecer mais de uma vez no mesmo Fechamento (ex: Base
// Semanal ~4 janelas/mês) — receivablesBaseId sozinho não identifica a
// linha, precisa da janela (periodStart) junto. Mesma chave usada no backend.
export function campaignRowKey(receivablesBaseId: string, periodStart: string): string {
  return `${receivablesBaseId}:${periodStart.slice(0, 10)}`;
}

// Cor do "cartão" de cada Campanha (pedido explícito do usuário): Reprovado
// = cinza; Aprovado com valor = verde (o modelo usual); Aprovado mas Zerado
// (não elegível ou payout 0) = azul. Em impressão (readOnly), a cor
// permanece — é informação de status, não só decoração interativa.
function campaignColorClass(approvalStatus: BenefitApprovalStatus, payoutValue: string): string {
  if (approvalStatus === "REPROVADO") return "border-l-4 border-l-muted-foreground bg-secondary/30";
  if (Number(payoutValue) === 0) return "border-l-4 border-l-sky-500 bg-sky-500/5";
  return "border-l-4 border-l-success bg-success/5";
}

interface CampaignCardProps {
  campaign: ClosingCampaignRow;
  approvalStatus: BenefitApprovalStatus;
  readOnly: boolean;
  disabled?: boolean;
  onToggleApproval?: (status: BenefitApprovalStatus) => void;
  onOpenRecebiveis?: () => void;
}

export function CampaignCard({
  campaign,
  approvalStatus,
  readOnly,
  disabled,
  onToggleApproval,
  onOpenRecebiveis,
}: CampaignCardProps) {
  return (
    <div
      className={`space-y-2 rounded-md border border-border p-3 break-inside-avoid ${campaignColorClass(approvalStatus, campaign.payoutValue)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div
          onClick={onOpenRecebiveis}
          className={onOpenRecebiveis ? "cursor-pointer hover:underline" : undefined}
          title={onOpenRecebiveis ? "Ver em Recebíveis" : undefined}
        >
          <p className="text-sm font-medium text-foreground">{campaign.baseName}</p>
          <p className="text-xs text-muted-foreground">
            {campaign.indicatorLabel} — {campaign.triggerMode === "FAIXA" ? "Faixa" : "Cumulativo"} — {formatDate(campaign.periodStart)} a{" "}
            {formatDate(new Date(new Date(campaign.periodEndExclusive).getTime() - 86400000).toISOString())}
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 print:hidden">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggleApproval?.("APROVADO")}
              className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${approvalStatus === "APROVADO" ? "border-success bg-success text-success-foreground" : "border-border text-foreground hover:bg-secondary/50"}`}
            >
              Aprovar
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggleApproval?.("REPROVADO")}
              className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${approvalStatus === "REPROVADO" ? "border-muted-foreground bg-muted-foreground text-white" : "border-border text-foreground hover:bg-secondary/50"}`}
            >
              Reprovar
            </button>
          </div>
        )}
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

interface ClosingDetailViewProps {
  detail: ClosingDetail;
  approvals: Record<string, BenefitApprovalStatus>;
  readOnly: boolean;
  disabled?: boolean;
  onToggleApproval?: (key: string, status: BenefitApprovalStatus) => void;
  onOpenRecebiveis?: (campaign: ClosingCampaignRow) => void;
}

// Seções somente-leitura do detalhe de um Fechamento — compartilhadas entre
// MemberClosingDetailPage.tsx (tela interativa, com Aprovar/Reprovar e
// Salvar) e ImprimirFechamentosPage.tsx (impressão, sempre readOnly).
export function ClosingDetailView({ detail, approvals, readOnly, disabled, onToggleApproval, onOpenRecebiveis }: ClosingDetailViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold capitalize text-foreground">
          {detail.memberName} — {formatMonth(detail.referenceMonth)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {detail.cargoName}
          {detail.hierarchyPath ? ` — ${detail.hierarchyPath.replace(/>/g, " > ")}` : ""} — Status:{" "}
          {detail.status === "FECHADO" ? "Fechado" : detail.status === "ABERTO" ? "Aberto" : "Previsto"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-5 break-inside-avoid">
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
        <div className="rounded-lg border border-border p-4 break-inside-avoid">
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
        {detail.campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma Campanha de Recebível ativa para este Membro neste Fechamento.</p>
        )}
        {detail.campaigns.map((campaign) => {
          const key = campaignRowKey(campaign.receivablesBaseId, campaign.periodStart);
          return (
            <CampaignCard
              key={key}
              campaign={campaign}
              approvalStatus={approvals[key] ?? campaign.approvalStatus}
              readOnly={readOnly}
              disabled={disabled}
              onToggleApproval={onToggleApproval ? (status) => onToggleApproval(key, status) : undefined}
              onOpenRecebiveis={onOpenRecebiveis ? () => onOpenRecebiveis(campaign) : undefined}
            />
          );
        })}
      </div>

      {(detail.comments || detail.manualAdjustmentValue) && readOnly && (
        <div className="space-y-1 rounded-lg border border-border p-4 break-inside-avoid">
          <h3 className="text-sm font-semibold text-foreground">Comentários e Ajuste</h3>
          {detail.comments && <p className="text-sm text-foreground">{detail.comments}</p>}
          {detail.manualAdjustmentValue && (
            <p className="text-sm text-foreground">
              Valor Adicional: {fmt(detail.manualAdjustmentValue)}
              {detail.manualAdjustmentReason ? ` — ${detail.manualAdjustmentReason}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
