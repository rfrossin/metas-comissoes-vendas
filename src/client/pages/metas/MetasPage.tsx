import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { ErrorState } from "@/components/AsyncState";
import { useAuthStore } from "@/store/auth.store";
import type { ResultType } from "@/pages/resultados/ResultTypesSection";
import { Modal } from "@/pages/bases-recebiveis/Modal";
import { CampaignDetail } from "./CampaignDetail";
import { MinhasMetasTab } from "./MinhasMetasTab";

type GoalCampaignStatus = "ATIVA" | "INATIVA" | "ENCERRADA";

export interface GoalCampaign {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: GoalCampaignStatus;
  inactivatedAt: string | null;
  resultType: { id: string; name: string; unit: "MOEDA" | "NUMERAL" };
  // PASSO 9.7: espelha assertOwnedOrAdmin no servidor (dono ou Admin) — o
  // client usa pra esconder Editar/Desativar/Duplicar/Excluir de quem não
  // pode usar (antes os 4 botões apareciam sempre e só falhavam com 403).
  canManage: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const STATUS_LABELS: Record<GoalCampaignStatus, string> = {
  ATIVA: "Ativa",
  INATIVA: "Inativa",
  ENCERRADA: "Encerrada",
};

const STATUS_ORDER: GoalCampaignStatus[] = ["ATIVA", "INATIVA", "ENCERRADA"];
const DEFAULT_STATUS_FILTER: GoalCampaignStatus[] = ["ATIVA", "INATIVA", "ENCERRADA"];

const emptyForm = { name: "", startDate: "", endDate: "", resultTypeId: "" };

export function MetasPage() {
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === "ADMINISTRADOR" || role === "LIDERANCA_NO";
  const tabs = (["campanhas", "minhas"] as const).filter((tab) => tab !== "campanhas" || canManage);
  // Campanha selecionada e aba ativa vivem na URL (não em useState puro): ao
  // entrar numa Linha de Meta (navegação real, GoalLineDetailPage/
  // MyGoalLineDetailPage) e voltar, a tela precisa reabrir a mesma Campanha
  // e a mesma aba em vez de remontar no estado padrão.
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState<"campanhas" | "minhas">(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "minhas") return "minhas";
    if (tabParam === "campanhas" && canManage) return "campanhas";
    return canManage ? "campanhas" : "minhas";
  });

  function setActiveTab(tab: "campanhas" | "minhas") {
    setActiveTabState(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const selectedId = searchParams.get("campaignId");
  const [error, setError] = useState<string | null>(null);
  // PASSO 9.7: pop-up de data de inativação — só existe enquanto o usuário
  // clica em "Desativar" (antes era um <input type="date"> sempre visível
  // por linha).
  const [deactivatingCampaign, setDeactivatingCampaign] = useState<GoalCampaign | null>(null);
  const [deactivateDate, setDeactivateDate] = useState("");

  const statusFilter = searchParams.has("status")
    ? (searchParams.get("status") ?? "")
        .split(",")
        .filter((s): s is GoalCampaignStatus => (STATUS_ORDER as string[]).includes(s))
    : DEFAULT_STATUS_FILTER;

  function toggleStatus(status: GoalCampaignStatus) {
    const next = statusFilter.includes(status) ? statusFilter.filter((s) => s !== status) : [...statusFilter, status];
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("status", next.join(","));
        return params;
      },
      { replace: true },
    );
  }

  function selectCampaign(id: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("campaignId", id);
        else next.delete("campaignId");
        return next;
      },
      { replace: true },
    );
  }

  const {
    data: campaigns,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["goal-campaigns"],
    queryFn: async () => {
      const { data } = await api.get<GoalCampaign[]>("/metas");
      return data;
    },
  });

  const { data: types } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => (editingId ? api.put(`/metas/${editingId}`, form) : api.post("/metas", form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goal-campaigns"] });
      setForm(emptyForm);
      setFormMode("closed");
      setEditingId(null);
      setError(null);
    },
    onError: () =>
      setError(
        editingId
          ? "Não foi possível salvar: confira as datas."
          : "Não foi possível criar a campanha (confira se a Data Inicial é anterior à Final).",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/metas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goal-campaigns"] });
      if (selectedId) selectCampaign(null);
    },
    onError: () => setError("Não foi possível excluir: esta campanha já possui Linhas de Meta calculadas."),
  });

  const activeStatusMutation = useMutation({
    mutationFn: ({ id, effectiveDate }: { id: string; effectiveDate: string | null }) =>
      api.put(`/metas/${id}/active-status`, { effectiveDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goal-campaigns"] });
      setDeactivatingCampaign(null);
      setDeactivateDate("");
    },
    onError: () => setError("Não foi possível alterar o status da campanha."),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/metas/${id}/duplicar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goal-campaigns"] }),
    onError: () => setError("Não foi possível duplicar a campanha."),
  });

  const selectedCampaign = campaigns?.find((c) => c.id === selectedId) ?? null;
  const filteredCampaigns = campaigns?.filter((c) => statusFilter.includes(c.status)) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Metas</h1>
          <p className="text-sm text-muted-foreground">
            Campanhas de meta: cada Linha de Meta é lançada diretamente no elemento desejado (Empresa, Canal,
            Departamento, Time ou Membro), usando os motores Top-Down, MCDS, Manual ou Agrupamento de Metas.
          </p>
        </div>

        {formMode === "closed" && activeTab === "campanhas" && (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
              setEditingId(null);
              setFormMode("create");
            }}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            + Nova Campanha
          </button>
        )}
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm ${
                activeTab === tab ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "campanhas" ? "Campanhas" : "Minhas Metas"}
            </button>
          ))}
        </div>
      )}

      {activeTab === "minhas" && <MinhasMetasTab />}

      {activeTab === "campanhas" && canManage && (
        <>
          {formMode !== "closed" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">
                {formMode === "edit" ? "Editar Campanha" : "Nova Campanha"}
              </h2>
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Nome</label>
                  <input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Período — Data Inicial</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Data Final</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Tipo de Resultado</label>
                  <select
                    value={form.resultTypeId}
                    onChange={(event) => setForm({ ...form, resultTypeId: event.target.value })}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">Selecione...</option>
                    {types?.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={
                    !form.name ||
                    !form.resultTypeId ||
                    !form.startDate ||
                    !form.endDate ||
                    form.startDate > form.endDate ||
                    saveMutation.isPending
                  }
                  onClick={() => saveMutation.mutate()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {saveMutation.isPending ? "Salvando..." : "Salvar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormMode("closed");
                    setEditingId(null);
                    setError(null);
                  }}
                  className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Estado:</span>
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  statusFilter.includes(status)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary/50"
                }`}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-1.5">Nome</th>
                  <th className="px-3 py-1.5">Período</th>
                  <th className="px-3 py-1.5">Tipo de Resultado</th>
                  <th className="px-3 py-1.5">Status</th>
                  <th className="px-3 py-1.5">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                )}

                {/* Antes de qualquer "nenhum registro": com a API fora do
                    ar, campaigns fica undefined e a condição de lista vazia
                    nunca casava — a tabela ficava vazia sem explicar nada. */}
                {isError && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2">
                      <ErrorState onRetry={() => refetch()} />
                    </td>
                  </tr>
                )}

                {!isLoading && !isError && campaigns?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                      Nenhuma campanha de meta cadastrada ainda.
                    </td>
                  </tr>
                )}

                {!isLoading && (campaigns?.length ?? 0) > 0 && filteredCampaigns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                      Nenhuma campanha no Estado selecionado.
                    </td>
                  </tr>
                )}

                {filteredCampaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    onClick={() => selectCampaign(campaign.id)}
                    className={`cursor-pointer border-t border-border ${
                      selectedId === campaign.id ? "bg-secondary/50" : "hover:bg-secondary/30"
                    }`}
                  >
                    <td className="px-3 py-1.5">{campaign.name}</td>
                    <td className="px-3 py-1.5">
                      {formatDate(campaign.startDate)} – {formatDate(campaign.endDate)}
                    </td>
                    <td className="px-3 py-1.5">{campaign.resultType.name}</td>
                    <td className="px-3 py-1.5">
                      {campaign.inactivatedAt ? (
                        <span className="text-destructive">Inativa desde {formatDate(campaign.inactivatedAt)}</span>
                      ) : (
                        STATUS_LABELS[campaign.status]
                      )}
                    </td>
                    <td className="px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                      {campaign.canManage ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setForm({
                                name: campaign.name,
                                startDate: campaign.startDate.slice(0, 10),
                                endDate: campaign.endDate.slice(0, 10),
                                resultTypeId: campaign.resultType.id,
                              });
                              setEditingId(campaign.id);
                              setFormMode("edit");
                              setError(null);
                            }}
                            className="text-xs text-primary hover:underline"
                          >
                            Editar
                          </button>
                          {campaign.inactivatedAt ? (
                            <button
                              type="button"
                              onClick={() => activeStatusMutation.mutate({ id: campaign.id, effectiveDate: null })}
                              className="text-xs text-primary hover:underline"
                            >
                              Reativar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setDeactivatingCampaign(campaign);
                                setDeactivateDate("");
                              }}
                              className="text-xs text-destructive hover:underline"
                            >
                              Desativar
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={duplicateMutation.isPending}
                            onClick={() => duplicateMutation.mutate(campaign.id)}
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                          >
                            Duplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(campaign.id)}
                            className="text-xs text-destructive hover:underline"
                          >
                            Excluir
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedCampaign && <CampaignDetail campaign={selectedCampaign} />}

          {deactivatingCampaign && (
            <Modal title={`Desativar "${deactivatingCampaign.name}"`} onClose={() => setDeactivatingCampaign(null)}>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  A partir da data escolhida, a campanha para de compor Recebíveis — continua visível no Acompanhamento,
                  só marcada como inativa.
                </p>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Data de inativação</label>
                  <input
                    type="date"
                    value={deactivateDate}
                    onChange={(event) => setDeactivateDate(event.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={!deactivateDate || activeStatusMutation.isPending}
                    onClick={() => activeStatusMutation.mutate({ id: deactivatingCampaign.id, effectiveDate: deactivateDate })}
                    className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                  >
                    {activeStatusMutation.isPending ? "Desativando..." : "Confirmar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeactivatingCampaign(null)}
                    className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
