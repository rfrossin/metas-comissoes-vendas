import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

export type ClosingStatus = "PREVISTO" | "ABERTO" | "FECHADO";
export type BenefitApprovalStatus = "APROVADO" | "REPROVADO";
export type RewardType = "PERCENT_FIXO" | "PERCENT_RESULTADO" | "VALOR_FIXO" | "PREMIO_FISICO";
export type PeriodStatus = "ABERTO" | "FECHADO";

export interface ClosingListFilters {
  status: ClosingStatus[];
  entityType: ScopeType;
  entityIds: string[];
  cargoId: string | null;
  search: string | null;
  periodStart: string;
  periodEnd: string;
}

export interface ClosingListRow {
  memberId: string;
  memberName: string;
  cargoName: string;
  hierarchyPath: string | null;
  referenceMonth: string;
  status: ClosingStatus;
  fixedValue: string;
  benefitsValue: string;
  totalValue: string;
}

export interface TierPayoutBreakdownRow {
  order: number;
  rewardType: RewardType;
  baseValueUsed: string | null;
  computedAmount: string;
  physicalPrizeDescription: string | null;
}

export interface ClosingCampaignRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: "META" | "RESULTADO";
  indicatorLabel: string;
  triggerMode: "FAIXA" | "CUMULATIVO";
  periodStart: string;
  periodEndExclusive: string;
  attainmentPercentage: string | null;
  realizedValue: string;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: string;
  physicalPrizeDescription: string | null;
  tierBreakdown: TierPayoutBreakdownRow[];
  approvalStatus: BenefitApprovalStatus;
}

export interface BenefitsByType {
  PERCENT_FIXO: string;
  PERCENT_RESULTADO: string;
  VALOR_FIXO: string;
  PREMIO_FISICO: string[];
}

export interface ResultByType {
  resultTypeId: string;
  resultTypeName: string;
  totalValue: string;
}

export interface ClosingDetail {
  memberId: string;
  memberName: string;
  cargoName: string;
  hierarchyPath: string | null;
  referenceMonth: string;
  isSaved: boolean;
  status: ClosingStatus;
  fixedValue: string;
  campaigns: ClosingCampaignRow[];
  resultsByType: ResultByType[];
  benefitsByType: BenefitsByType;
  totalValue: string;
  manualAdjustmentValue: string | null;
  manualAdjustmentReason: string | null;
  comments: string | null;
  closedAt: string | null;
}

export interface SaveClosingInput {
  approvals: { receivablesBaseId: string; periodStart: string; approvalStatus: BenefitApprovalStatus }[];
  comments: string | null;
  manualAdjustmentValue: number | null;
  manualAdjustmentReason: string | null;
}

export interface CommercialPeriod {
  id: string;
  referenceMonth: string;
  status: PeriodStatus;
  closedAt: string | null;
  reopenedAt: string | null;
}
