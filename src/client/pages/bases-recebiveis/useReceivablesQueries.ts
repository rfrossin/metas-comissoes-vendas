import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  BeneficiaryInput,
  ConditionalTriggerInput,
  MyReceivablesBaseDetail,
  MyReceivablesBaseSummary,
  ReceivablesBaseDetail,
  ReceivablesBaseInput,
  ReceivablesBaseListItem,
  SimulationResult,
  TierLadderRungInput,
} from "./types";

const LIST_KEY = ["receivables-bases"];

export function useReceivablesBases() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const { data } = await api.get<ReceivablesBaseListItem[]>("/bases-recebiveis");
      return data;
    },
  });
}

// "Minhas Bases" (PASSO 9.10) — disponível para TODOS os papéis, sem
// checagem de escopo de gestão: sempre só o próprio Membro vinculado.
export function useMyReceivablesBases() {
  return useQuery({
    queryKey: ["my-receivables-bases"],
    queryFn: async () => {
      const { data } = await api.get<MyReceivablesBaseSummary[]>("/bases-recebiveis/minhas");
      return data;
    },
  });
}

export function useMyReceivablesBaseDetail(id: string | null, page: number) {
  return useQuery({
    queryKey: ["my-receivables-base-detail", id, page],
    queryFn: async () => {
      const { data } = await api.get<MyReceivablesBaseDetail>(`/bases-recebiveis/minhas/${id}/graficos`, { params: { page } });
      return data;
    },
    enabled: !!id,
  });
}

export function useReceivablesBaseDetailForBeneficiary(baseId: string | null, memberId: string | null, page: number) {
  return useQuery({
    queryKey: ["receivables-base-detail-for-beneficiary", baseId, memberId, page],
    queryFn: async () => {
      const { data } = await api.get<MyReceivablesBaseDetail>(`/bases-recebiveis/${baseId}/beneficiario/${memberId}/graficos`, { params: { page } });
      return data;
    },
    enabled: !!baseId && !!memberId,
  });
}

export function useReceivablesBaseDetail(id: string | null) {
  return useQuery({
    queryKey: ["receivables-base", id],
    queryFn: async () => {
      const { data } = await api.get<ReceivablesBaseDetail>(`/bases-recebiveis/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useSaveReceivablesBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ReceivablesBaseInput }) =>
      id ? api.put(`/bases-recebiveis/${id}`, input) : api.post("/bases-recebiveis", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeleteReceivablesBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/bases-recebiveis/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useSetReceivablesBaseStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/bases-recebiveis/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDuplicateReceivablesBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/bases-recebiveis/${id}/duplicar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useSetBeneficiaries(baseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (beneficiaries: BeneficiaryInput[]) => api.put(`/bases-recebiveis/${baseId}/beneficiarios`, { beneficiaries }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivables-base", baseId] });
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useSetConditionalTriggers(baseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (triggers: ConditionalTriggerInput[]) => api.put(`/bases-recebiveis/${baseId}/gatilhos-condicionais`, { triggers }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receivables-base", baseId] }),
  });
}

export function useSetTierLadder(baseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rungs: TierLadderRungInput[]) => api.put(`/bases-recebiveis/${baseId}/degraus`, { rungs }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receivables-base", baseId] }),
  });
}

export function useSimulateReceivablesBase(baseId: string) {
  return useMutation({
    mutationFn: async (input: {
      memberId: string;
      simulatedMainRealized: number;
      conditionalSimulations: { conditionalTriggerId: string; simulatedRealized: number }[];
      referenceDate: string;
    }) => {
      const { data } = await api.post<SimulationResult>(`/bases-recebiveis/${baseId}/simular`, input);
      return data;
    },
  });
}
