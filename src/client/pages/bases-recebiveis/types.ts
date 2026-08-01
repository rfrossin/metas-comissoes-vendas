import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

export type IndicatorType = "META" | "RESULTADO";
export type ReceivablesPeriodicity = "DIARIO" | "SEMANAL" | "MENSAL" | "TRIMESTRAL" | "ANUAL";
export type TriggerMode = "FAIXA" | "CUMULATIVO";
export type ReceivablesStatus = "ATIVO" | "DESATIVADO" | "ENCERRADO";
export type RewardType = "PERCENT_FIXO" | "PERCENT_RESULTADO" | "VALOR_FIXO" | "PREMIO_FISICO";

export interface ReceivablesBaseListItem {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  primaryGoalCampaignId: string | null;
  resultTypeId: string | null;
  primaryGoal: { name: string } | null;
  resultType: { name: string } | null;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  status: ReceivablesStatus;
  startDate: string | null;
  endDate: string | null;
  _count: { beneficiaries: number };
}

export interface ValueTierRow {
  id: string;
  order: number;
  thresholdValue: string;
}

export interface TierRuleRow {
  id: string;
  valueTierId: string;
  rewardType: RewardType;
  rewardResultTypeId: string | null;
  rewardResultType: { id: string; name: string } | null;
  rewardPercentage: string | null;
  rewardFixedValue: string | null;
  rewardDescription: string | null;
  valueTier: ValueTierRow;
}

export interface BeneficiaryRow {
  id: string;
  memberId: string;
  member: { id: string; fullName: string; cargo: { id: string; name: string } | null };
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  memberHierarchyPath: string | null;
  entityHierarchyPath: string | null;
}

export interface BeneficiaryInput {
  memberId: string;
  entityType: ScopeType;
  entityId: string;
}

export interface ConditionalTriggerRow {
  id: string;
  verificationLevel: ScopeType;
  indicatorType: IndicatorType;
  conditionalGoalCampaignId: string | null;
  conditionalGoal: { id: string; name: string } | null;
  resultTypeId: string | null;
  resultType: { id: string; name: string } | null;
  minAttainmentPercentage: string | null;
  minResultValue: string | null;
  applicableMemberIds: string[];
}

export interface ReceivablesBaseDetail extends ReceivablesBaseListItem {
  beneficiaries: BeneficiaryRow[];
  conditionalTriggers: ConditionalTriggerRow[];
  valueTiers: ValueTierRow[];
  tierRules: TierRuleRow[];
  // FULL = Admin, ou Gestor com TODOS os beneficiários no escopo dele —
  // gerencia a Base inteira. PARTIAL = Gestor com só ALGUNS beneficiários
  // no escopo — vê tudo (contexto), mas só edita Gatilhos cujo
  // applicableMemberIds seja só de editableBeneficiaryMemberIds; Degraus e
  // cabeçalho/Beneficiados ficam travados (afetam beneficiários de fora).
  access: "FULL" | "PARTIAL";
  editableBeneficiaryMemberIds: string[];
}

export interface ReceivablesBaseInput {
  name: string;
  indicatorType: IndicatorType;
  primaryGoalCampaignId: string | null;
  resultTypeId: string | null;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: string | null;
  endDate: string | null;
}

export interface ConditionalTriggerInput {
  verificationLevel: ScopeType;
  indicatorType: IndicatorType;
  conditionalGoalCampaignId: string | null;
  resultTypeId: string | null;
  minAttainmentPercentage: number | null;
  minResultValue: number | null;
  applicableMemberIds: string[];
}

export interface TierLadderRungInput {
  order: number;
  threshold: number;
  rewardType: RewardType;
  rewardResultTypeId: string | null;
  rewardPercentage: number | null;
  rewardFixedValue: number | null;
  rewardDescription: string | null;
}

export interface AchievedTierInfo {
  order: number;
  threshold: string;
}

export interface LadderRungStatus {
  order: number;
  threshold: string;
  achieved: boolean;
}

export interface TierPayoutBreakdown {
  order: number;
  rewardType: RewardType;
  baseValueUsed: string | null;
  computedAmount: string;
  physicalPrizeDescription: string | null;
}

export interface BlockedTriggerInfo {
  verificationLevel: ScopeType;
  indicatorType: IndicatorType;
  label: string;
  requiredMinimum: string;
  simulatedValue: string;
}

export interface ConditionalCheckResult extends BlockedTriggerInfo {
  triggerId: string;
  passed: boolean;
}

export interface MyReceivablesBaseSummary {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  periodicity: ReceivablesPeriodicity;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  periodStart: string;
  periodEndExclusive: string;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: string;
  physicalPrizeDescription: string | null;
  attainmentValue: string;
  fullLadder: LadderRungStatus[];
  conditionalChecks: ConditionalCheckResult[];
}

export interface MyConditionalTriggerInfo {
  id: string;
  label: string;
  verificationLevel: ScopeType;
  indicatorType: IndicatorType;
  requiredMinimum: string;
}

export interface MyTierRuleInfo {
  rewardType: RewardType;
  rewardResultTypeName: string | null;
  rewardPercentage: string | null;
  rewardFixedValue: string | null;
  rewardDescription: string | null;
}

export interface MyTierLadderRung {
  order: number;
  thresholdValue: string;
  rules: MyTierRuleInfo[];
}

export interface TierPeriodTarget {
  periodStart: string;
  periodEndExclusive: string;
  tiers: { order: number; requiredValue: string }[];
}

export interface TriggerSeriesPoint {
  periodStart: string;
  periodEndExclusive: string;
  requiredValue: string;
}

export interface TriggerSeries {
  triggerId: string;
  label: string;
  points: TriggerSeriesPoint[];
}

export interface ReceivablesBasePagination {
  offset: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface MyReceivablesBaseDetail {
  id: string;
  name: string;
  indicatorType: IndicatorType;
  goalOrResultLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  startDate: string | null;
  endDate: string | null;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  hierarchyPath: string | null;
  canSimulate: boolean;
  conditionalTriggers: MyConditionalTriggerInfo[];
  tierLadder: MyTierLadderRung[];
  tierPeriods: TierPeriodTarget[];
  triggerSeries: TriggerSeries[];
  pagination: ReceivablesBasePagination | null;
}

export interface SimulationResult {
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: string;
  physicalPrizeDescription: string | null;
  periodStart: string;
  periodEndExclusive: string;
  metaTotal: string | null;
  attainmentValue: string;
  achievedTiers: AchievedTierInfo[];
  fullLadder: LadderRungStatus[];
  tierBreakdown: TierPayoutBreakdown[];
  conditionalChecks: ConditionalCheckResult[];
  blockedTrigger: BlockedTriggerInfo | null;
}
