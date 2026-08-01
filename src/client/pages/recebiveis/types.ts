import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

export type IndicatorType = "META" | "RESULTADO";
export type ReceivablesPeriodicity = "DIARIO" | "SEMANAL" | "MENSAL" | "TRIMESTRAL" | "ANUAL";
export type WindowStatus = "FECHADO" | "LIBERADO" | "PREVISTO";
export type RewardType = "PERCENT_FIXO" | "PERCENT_RESULTADO" | "VALOR_FIXO" | "PREMIO_FISICO";
export type TriggerMode = "FAIXA" | "CUMULATIVO";

export interface RecebiveisFilters {
  entityType: ScopeType;
  entityIds: string[];
  periodStart: string;
  periodEnd: string;
}

export interface GanhoPorMetaRow {
  receivablesBaseId: string;
  baseName: string;
  indicatorType: IndicatorType;
  indicatorLabel: string;
  periodicity: ReceivablesPeriodicity;
  triggerMode: TriggerMode;
  periodStart: string;
  periodEndExclusive: string;
  status: WindowStatus;
  attainmentValue: string;
  currentTierLabel: string | null;
  eligible: boolean;
  blockedReason: string | null;
  payoutValue: string;
  physicalPrizeDescription: string | null;
  nextTierGap: string | null;
  topTierPotentialPayout: string;
}

export interface GanhoPorMetaResult {
  member: { id: string; fullName: string };
  rows: GanhoPorMetaRow[];
}

export interface DistribuicaoRow {
  memberId: string;
  fullName: string;
  cargoName: string;
  salarioFixo: string;
  comissao: string;
  premiosFisicosCount: number;
  custoTotal: string;
}

export type RecebiveisTable =
  | { kind: "GANHO_POR_META"; member: { id: string; fullName: string }; rows: GanhoPorMetaRow[] }
  | { kind: "DISTRIBUICAO"; rows: DistribuicaoRow[] };

export interface FechamentoBucketSegment {
  monthKey: string;
  receivablesBaseId: string;
  baseName: string;
  status: "FECHADO" | "LIBERADO";
  periodicity: ReceivablesPeriodicity;
  value: string;
  windowCount: number;
  sampleStartIso: string;
  sampleEndInclusiveIso: string;
}

export interface CumulativePoint {
  monthKey: string;
  fixoAcumulado: string;
  beneficiosAcumulado: string;
}

export interface Metas360Row {
  receivablesBaseId: string;
  baseName: string;
  indicatorLabel: string;
  beneficiariosCount: number;
  totalGerado: string;
  premiosFisicosCount: number;
}

export interface ModeloBeneficioRow {
  rewardType: RewardType;
  total: string;
  count: number;
}

export interface PremioFisicoItem {
  memberId: string;
  fullName: string;
  baseName: string;
  degrau: string;
  descricao: string;
  status: WindowStatus;
  periodStart: string;
  periodEndInclusive: string;
}

export interface RecebiveisOverview {
  kpis: {
    beneficiosTotal: string;
    fechadoTotal: string;
    liberadoTotal: string;
    previstoTotal: string;
    fixoTotal: string;
    premiosFisicosCount: number;
  };
  fechamentoBuckets: FechamentoBucketSegment[];
  cumulativeSeries: CumulativePoint[];
  table: RecebiveisTable;
  metas360: Metas360Row[];
  modelosBeneficio: ModeloBeneficioRow[];
  premiosFisicos: PremioFisicoItem[];
}
