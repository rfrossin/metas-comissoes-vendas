import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { GanhoPorMetaResult, RecebiveisFilters, RecebiveisOverview } from "./types";

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

// enabled-gated (nunca dispara com filtro incompleto) — mesmo padrão de
// useAcompanhamentoQueries.ts. Chave de cache usa sortedIds só para
// estabilidade do cache — nunca para renderizar/atribuir cor (isso usa a
// ordem de seleção real, mantida no estado da página).
export function useRecebiveisOverview(filters: RecebiveisFilters) {
  return useQuery({
    queryKey: [
      "recebiveis",
      "overview",
      filters.entityType,
      sortedIds(filters.entityIds),
      filters.periodStart,
      filters.periodEnd,
    ],
    queryFn: async () => {
      const { data } = await api.post<RecebiveisOverview>("/recebiveis/overview", filters);
      return data;
    },
    enabled: filters.entityIds.length > 0 && !!filters.periodStart && !!filters.periodEnd,
  });
}

export function useMemberGanhoPorMeta(memberId: string | null, periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ["recebiveis", "ganho-por-meta", memberId, periodStart, periodEnd],
    queryFn: async () => {
      const { data } = await api.post<GanhoPorMetaResult>(`/recebiveis/membro/${memberId}/ganho-por-meta`, { periodStart, periodEnd });
      return data;
    },
    enabled: !!memberId && !!periodStart && !!periodEnd,
  });
}
