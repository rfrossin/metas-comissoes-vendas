import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type {
  AcompanhamentoOverview,
  AvailableCampaignOption,
  ComparativoPoint,
  CumulativePoint,
  Granularity,
  RecalculatedPoint,
} from "./types";

export interface AcompanhamentoFilters {
  resultTypeId: string;
  periodStart: string;
  periodEnd: string;
  realizadoAte: string;
  entityType: ScopeType;
  entityIds: string[];
  goalCampaignIds: string[];
}

// Só para chave de cache — nunca usar o array ordenado para render (cor por
// entidade depende da ordem de SELEÇÃO, não da ordem alfabética/de id).
function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

export function useAvailableCampaigns(
  filters: Pick<AcompanhamentoFilters, "resultTypeId" | "periodStart" | "periodEnd" | "entityType" | "entityIds">,
) {
  const enabled = Boolean(filters.resultTypeId && filters.periodStart && filters.periodEnd && filters.entityIds.length > 0);

  return useQuery({
    queryKey: [
      "acompanhamento",
      "campanhas-disponiveis",
      filters.resultTypeId,
      filters.periodStart,
      filters.periodEnd,
      filters.entityType,
      sortedIds(filters.entityIds),
    ],
    queryFn: async () => {
      const { data } = await api.get<AvailableCampaignOption[]>("/acompanhamento/campanhas-disponiveis", {
        params: {
          resultTypeId: filters.resultTypeId,
          periodStart: filters.periodStart,
          periodEnd: filters.periodEnd,
          entityType: filters.entityType,
          entityIds: filters.entityIds.join(","),
        },
      });
      return data;
    },
    enabled,
  });
}

export function useOverview(filters: AcompanhamentoFilters, granularity: Granularity, monthOffset: number) {
  const enabled = Boolean(
    filters.resultTypeId && filters.periodStart && filters.periodEnd && filters.realizadoAte && filters.entityIds.length > 0,
  );

  return useQuery({
    queryKey: [
      "acompanhamento",
      "overview",
      filters.resultTypeId,
      filters.periodStart,
      filters.periodEnd,
      filters.realizadoAte,
      filters.entityType,
      sortedIds(filters.entityIds),
      sortedIds(filters.goalCampaignIds),
      granularity,
      monthOffset,
    ],
    queryFn: async () => {
      const { data } = await api.post<AcompanhamentoOverview>("/acompanhamento/overview", {
        ...filters,
        granularity,
        monthOffset,
      });
      return data;
    },
    enabled,
  });
}

// Sempre mensal — não depende de granularity/monthOffset (independência
// pedida explicitamente pelo usuário: "sempre mês a mês, independente do
// seletor de granularidade").
export function useCumulativeSeries(filters: AcompanhamentoFilters) {
  const enabled = Boolean(
    filters.resultTypeId && filters.periodStart && filters.periodEnd && filters.realizadoAte && filters.entityIds.length > 0,
  );

  return useQuery({
    queryKey: [
      "acompanhamento",
      "acumulado",
      filters.resultTypeId,
      filters.periodStart,
      filters.periodEnd,
      filters.realizadoAte,
      filters.entityType,
      sortedIds(filters.entityIds),
      sortedIds(filters.goalCampaignIds),
    ],
    queryFn: async () => {
      const { data } = await api.post<CumulativePoint[]>("/acompanhamento/acumulado", filters);
      return data;
    },
    enabled,
  });
}

// Depende de período (para o "Realizado Atual") mas não de realizadoAte —
// o ano comparado sempre soma Jan-Dez inteiro, sem corte.
export function useComparativoSeries(
  filters: Pick<AcompanhamentoFilters, "resultTypeId" | "periodStart" | "periodEnd" | "entityType" | "entityIds" | "goalCampaignIds">,
  year: number,
) {
  const enabled = Boolean(filters.resultTypeId && filters.periodStart && filters.periodEnd && filters.entityIds.length > 0 && year);

  return useQuery({
    queryKey: [
      "acompanhamento",
      "comparativo",
      filters.resultTypeId,
      filters.periodStart,
      filters.periodEnd,
      filters.entityType,
      sortedIds(filters.entityIds),
      sortedIds(filters.goalCampaignIds),
      year,
    ],
    queryFn: async () => {
      const { data } = await api.post<ComparativoPoint[]>("/acompanhamento/comparativo", { ...filters, year });
      return data;
    },
    enabled,
  });
}

// Meses restantes após "Realizado até" — depende dos mesmos filtros do
// overview (precisa saber onde cortar e qual é a Meta Total original).
export function useRecalculatedSeries(filters: AcompanhamentoFilters) {
  const enabled = Boolean(
    filters.resultTypeId && filters.periodStart && filters.periodEnd && filters.realizadoAte && filters.entityIds.length > 0,
  );

  return useQuery({
    queryKey: [
      "acompanhamento",
      "recalculada",
      filters.resultTypeId,
      filters.periodStart,
      filters.periodEnd,
      filters.realizadoAte,
      filters.entityType,
      sortedIds(filters.entityIds),
      sortedIds(filters.goalCampaignIds),
    ],
    queryFn: async () => {
      const { data } = await api.post<RecalculatedPoint[]>("/acompanhamento/recalculada", filters);
      return data;
    },
    enabled,
  });
}
