import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

export type Granularity = "DIA" | "SEMANA" | "MES" | "TRIMESTRE";

export interface AvailableCampaignOption {
  goalCampaignId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "ATIVA" | "INATIVA" | "ENCERRADA";
}

export interface KpiCard {
  realizado: string;
  meta: string;
  percentMeta: string | null;
}

export interface CorridoKpi {
  realizadoCorrido: string;
  metaTotalPeriodo: string;
  percentMeta: string | null;
  percentEsperado: string | null;
  valorCobertura: string;
}

export interface EntityBucketValue {
  entityId: string;
  entityType: ScopeType;
  label: string;
  realizado: string;
  meta: string;
}

export interface GranularityBucketRow {
  periodKey: string;
  realizado: string;
  meta: string;
  percentMetaPeriodo: string | null;
  realizadoAcumulado: string;
  metaAcumulada: string;
  percentRealizadoEsperado: string | null;
  percentRealizadoMetaTotal: string | null;
  byEntity: EntityBucketValue[];
}

export interface AcompanhamentoOverview {
  kpis: {
    dia: KpiCard;
    semana: KpiCard;
    mes: KpiCard;
    trimestre: KpiCard;
    corrido: CorridoKpi;
  };
  granularity: Granularity;
  page: { monthOffset: number; hasPrev: boolean; hasNext: boolean } | null;
  buckets: GranularityBucketRow[];
  entities: { entityId: string; entityType: ScopeType; label: string; realizadoCorrido: string }[];
}

export interface CumulativePoint {
  monthKey: string;
  metaAcumulada: string;
  realizadoAcumulada: string;
}

export interface ComparativoPoint {
  monthNumber: number;
  realizadoAtual: string;
  realizadoAnoSelecionado: string;
  metaReindexada: string;
}

export interface RecalculatedPoint {
  monthKey: string;
  metaAtual: string;
  metaRecalculada: string;
}

export interface HierarchyRow {
  entityType: ScopeType;
  entityId: string;
  label: string;
  realizado: string;
  percentDoTotal: string | null;
  percentDaHierarquia: string | null;
  hasChildren: boolean;
}
