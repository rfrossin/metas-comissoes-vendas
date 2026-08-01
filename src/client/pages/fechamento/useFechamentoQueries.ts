import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ClosingDetail, ClosingListFilters, ClosingListRow, CommercialPeriod, SaveClosingInput } from "./types";

export interface CloseBulkItem {
  memberId: string;
  referenceMonth: string;
}

export interface CloseBulkResult extends CloseBulkItem {
  ok: boolean;
  error?: string;
}

export function useClosingsList(filters: ClosingListFilters, enabled: boolean) {
  return useQuery({
    queryKey: ["fechamento-list", filters],
    queryFn: async () => {
      const { data } = await api.post<ClosingListRow[]>("/fechamento/list", filters);
      return data;
    },
    enabled,
  });
}

export function useClosingDetail(memberId: string | null, referenceMonth: string | null) {
  return useQuery({
    queryKey: ["fechamento-detail", memberId, referenceMonth],
    queryFn: async () => {
      const { data } = await api.get<ClosingDetail>(`/fechamento/${memberId}/${referenceMonth}`);
      return data;
    },
    enabled: Boolean(memberId && referenceMonth),
  });
}

export function useSaveClosing(memberId: string, referenceMonth: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveClosingInput) => api.put(`/fechamento/${memberId}/${referenceMonth}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fechamento-detail", memberId, referenceMonth] });
      queryClient.invalidateQueries({ queryKey: ["fechamento-list"] });
    },
  });
}

// PASSO 11.4: "Fechar Selecionados" — aprova automaticamente todas as
// Campanhas de cada Membro+Mês selecionado (mesmo default de saveClosing
// quando approvals vem vazio), sem Comentários/Ajuste Manual (só fazem
// sentido individualmente). Sucesso parcial é esperado — o backend devolve
// um resultado por item, não lança erro pro lote inteiro.
export function useSaveClosingBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: CloseBulkItem[]) => {
      const { data } = await api.post<CloseBulkResult[]>("/fechamento/bulk-save", { items });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fechamento-list"] }),
  });
}

export function useReopenClosingBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: CloseBulkItem[]) => {
      const { data } = await api.post<CloseBulkResult[]>("/fechamento/bulk-reopen", { items });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fechamento-list"] }),
  });
}

export function useExportClosingsPdf() {
  return useMutation({
    mutationFn: async (items: CloseBulkItem[]) => {
      const { data } = await api.post<Blob>("/fechamento/export-pdf", { items }, { responseType: "blob" });
      return data;
    },
  });
}

export function useReopenClosing(memberId: string, referenceMonth: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/fechamento/${memberId}/${referenceMonth}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fechamento-detail", memberId, referenceMonth] });
      queryClient.invalidateQueries({ queryKey: ["fechamento-list"] });
    },
  });
}

export function useCommercialPeriods() {
  return useQuery({
    queryKey: ["commercial-periods"],
    queryFn: async () => {
      const { data } = await api.get<CommercialPeriod[]>("/fechamento/periodos/lista");
      return data;
    },
  });
}

export function useSetCommercialPeriodStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ referenceMonth, status }: { referenceMonth: string; status: "ABERTO" | "FECHADO" }) =>
      api.put(`/fechamento/periodos/${referenceMonth}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commercial-periods"] }),
  });
}
