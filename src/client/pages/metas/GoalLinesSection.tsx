import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import type { GoalCampaign } from "./MetasPage";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { ScopeAssignment } from "@/pages/usuarios/types";
import { GoalLineForm } from "./GoalLineForm";
import { ReforecastPanel } from "./ReforecastPanel";
import { useEntityOptions } from "./useEntityOptions";

export interface PeriodTotal {
  key: string;
  value: string;
}

export interface GoalLine {
  id: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  engineType: "VALOR_ALVO_ANUAL" | "CRESCIMENTO_MENSAL" | "CRESCIMENTO_TRIMESTRAL" | "MANUAL" | "AGRUPAMENTO";
  seasonalityBaseId: string | null;
  seasonalityBaseName: string | null;
  dailySeasonalityBaseId: string | null;
  dailySeasonalityBaseName: string | null;
  initialAmount: string;
  growthRate: string | null;
  isManualOverride: boolean;
  // Só preenchido quando engineType=AGRUPAMENTO.
  groupDiscountPercentage: string | null;
  grossTotal: string | null;
  appliedAt: string | null;
  inactivatedAt: string | null;
  isRecalculated: boolean;
  channelId: string | null;
  departmentId: string | null;
  teamId: string | null;
  hierarchyPath: string | null;
  // PASSO 9.7: espelha assertNodeWithinEditableScope no servidor — client
  // usa pra esconder Editar/Recalcular/Desativar/Excluir de quem não pode.
  canEdit: boolean;
  total: string;
  finalAmount: string;
  averageMonthly: string;
  growthInPeriod: string | null;
  monthly: PeriodTotal[];
  weekly: PeriodTotal[];
  quarterly: PeriodTotal[];
}

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

const ENGINE_LABELS: Record<string, string> = {
  VALOR_ALVO_ANUAL: "Top-Down",
  CRESCIMENTO_MENSAL: "MCDS Mensal",
  CRESCIMENTO_TRIMESTRAL: "MCDS Trimestral",
  MANUAL: "Manual",
  AGRUPAMENTO: "Agrupamento de Metas",
};

function fmt(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Ação Desativar em 2 passos (pedido explícito): o campo de data só aparece
// depois de clicar em "Desativar", em vez de ficar sempre visível.
function DeactivateAction({
  isInactive,
  onConfirm,
  onReactivate,
}: {
  isInactive: boolean;
  onConfirm: (effectiveDate: string) => void;
  onReactivate: () => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [date, setDate] = useState("");

  if (isInactive) {
    return (
      <button type="button" onClick={onReactivate} className="text-xs text-primary hover:underline">
        Reativar
      </button>
    );
  }

  if (!showDatePicker) {
    return (
      <button type="button" onClick={() => setShowDatePicker(true)} className="text-xs text-destructive hover:underline">
        Desativar
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="w-32 rounded-md border border-input bg-background px-1.5 py-0.5 text-xs text-foreground"
      />
      <button
        type="button"
        disabled={!date}
        onClick={() => onConfirm(date)}
        className="text-xs text-destructive hover:underline disabled:opacity-50"
      >
        Confirmar
      </button>
      <button
        type="button"
        onClick={() => {
          setShowDatePicker(false);
          setDate("");
        }}
        className="text-xs text-muted-foreground hover:underline"
      >
        Cancelar
      </button>
    </div>
  );
}

export function GoalLinesSection({ campaign }: { campaign: GoalCampaign }) {
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const role = useAuthStore((state) => state.user?.role);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isCreating, setIsCreating] = useState(false);
  const [editingLine, setEditingLine] = useState<GoalLine | null>(null);
  const [reforecastLineId, setReforecastLineId] = useState<string | null>(null);

  // Filtro em cascata na URL (não em useState): ao entrar numa Linha de
  // Meta e voltar, a tela precisa reconstruir o mesmo filtro em vez de
  // remontar limpo (mesmo bug/fix já aplicado em Fechamento).
  const [searchParams, setSearchParams] = useSearchParams();
  const filterCanalId = searchParams.get("canalId") ?? "";
  const filterDepartamentoId = searchParams.get("departamentoId") ?? "";
  const filterTimeId = searchParams.get("timeId") ?? "";

  function setFilter(patch: { canalId?: string; departamentoId?: string; timeId?: string }) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }

  const { options: filterOptions } = useEntityOptions(companyId);

  const departamentoFilterOptions = filterCanalId
    ? filterOptions.DEPARTAMENTO.filter((option) => option.parentId === filterCanalId)
    : filterOptions.DEPARTAMENTO;
  const timeFilterOptions = filterDepartamentoId
    ? filterOptions.TIME.filter((option) => option.parentId === filterDepartamentoId)
    : filterOptions.TIME;

  const { data: linesResponse, isLoading } = useQuery({
    queryKey: ["goal-lines", campaign.id],
    queryFn: async () => {
      const { data } = await api.get<{ lines: GoalLine[]; totalCount: number }>(`/metas/${campaign.id}/lines`);
      return data;
    },
  });
  const lines = linesResponse?.lines;
  const totalCount = linesResponse?.totalCount ?? 0;
  const hiddenCount = totalCount - (lines?.length ?? 0);

  // PASSO 9.7: "+ Nova Linha de Meta" só aparece se o usuário tem ALGUM
  // escopo editável — Admin e Gestor sempre têm (toda atribuição de Gestor
  // já é EDITAR); Usuário só se tiver ≥1 atribuição EDITAR.
  const { data: myAssignments } = useQuery({
    queryKey: ["my-scope-assignments"],
    queryFn: async () => {
      const { data } = await api.get<ScopeAssignment[]>("/permissoes/minhas-atribuicoes");
      return data;
    },
    enabled: role === "OPERACIONAL",
  });
  const canCreateAnyLine =
    role === "ADMINISTRADOR" || role === "LIDERANCA_NO" || (myAssignments ?? []).some((a) => a.accessLevel === "EDITAR");

  const filteredLines = useMemo(
    () =>
      (lines ?? []).filter((line) => {
        if (filterCanalId && line.channelId !== filterCanalId) return false;
        if (filterDepartamentoId && line.departmentId !== filterDepartamentoId) return false;
        if (filterTimeId && line.teamId !== filterTimeId) return false;
        return true;
      }),
    [lines, filterCanalId, filterDepartamentoId, filterTimeId],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/metas/lines/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goal-lines", campaign.id] }),
  });

  const activeStatusMutation = useMutation({
    mutationFn: ({ lineId, effectiveDate }: { lineId: string; effectiveDate: string | null }) =>
      api.put(`/metas/lines/${lineId}/active-status`, { effectiveDate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goal-lines", campaign.id] }),
  });

  function closeForms() {
    setIsCreating(false);
    setEditingLine(null);
  }

  function goToDetail(line: GoalLine) {
    navigate(`/metas/${campaign.id}/linha/${line.entityType}/${line.entityId}?lineId=${line.id}`);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Linhas de Meta</h3>
        <p className="text-xs text-muted-foreground">
          Uma linha por entidade (Empresa, Canal, Departamento, Time ou Membro) — selecionada diretamente, sem
          pré-filtro de escopo. Linhas inativas (substituídas por recálculo, ou desativadas) continuam listadas
          como histórico.
        </p>
      </div>

      {!isCreating && !editingLine && canCreateAnyLine && (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
        >
          + Nova Linha de Meta
        </button>
      )}

      {hiddenCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Vendo {lines?.length ?? 0} de {totalCount} Linhas de Meta — as demais estão fora do seu escopo de visualização.
        </p>
      )}

      {isCreating && (
        <GoalLineForm campaign={campaign} campaignLines={lines ?? []} onDone={closeForms} onCancel={closeForms} />
      )}
      {editingLine && (
        <GoalLineForm
          campaign={campaign}
          campaignLines={lines ?? []}
          existingLine={editingLine}
          onDone={closeForms}
          onCancel={closeForms}
        />
      )}

      {lines && lines.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Canal</label>
            <select
              value={filterCanalId}
              onChange={(event) => setFilter({ canalId: event.target.value, departamentoId: "", timeId: "" })}
              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              {filterOptions.CANAL.map((option) => (
                <option key={option.entityId} value={option.entityId}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Departamento</label>
            <select
              value={filterDepartamentoId}
              onChange={(event) => setFilter({ departamentoId: event.target.value, timeId: "" })}
              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              {departamentoFilterOptions.map((option) => (
                <option key={option.entityId} value={option.entityId}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Time</label>
            <select
              value={filterTimeId}
              onChange={(event) => setFilter({ timeId: event.target.value })}
              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              {timeFilterOptions.map((option) => (
                <option key={option.entityId} value={option.entityId}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {(filterCanalId || filterDepartamentoId || filterTimeId) && (
            <button
              type="button"
              onClick={() => setFilter({ canalId: "", departamentoId: "", timeId: "" })}
              className="text-xs text-muted-foreground hover:underline"
            >
              Limpar filtro
            </button>
          )}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!isLoading && lines?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma Linha de Meta nesta campanha ainda.</p>
      )}
      {!isLoading && lines && lines.length > 0 && filteredLines.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma Linha de Meta corresponde ao filtro selecionado.</p>
      )}

      {filteredLines.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-1.5">Nível</th>
                <th className="whitespace-nowrap px-3 py-1.5">Entidade</th>
                <th className="whitespace-nowrap px-3 py-1.5">Hierarquia</th>
                <th className="whitespace-nowrap px-3 py-1.5">Motor de Cálculo</th>
                <th className="whitespace-nowrap px-3 py-1.5">Status</th>
                <th className="whitespace-nowrap px-3 py-1.5">Cresc. no Período</th>
                <th className="whitespace-nowrap px-3 py-1.5">Valor Inicial</th>
                <th className="whitespace-nowrap px-3 py-1.5">Valor Final</th>
                <th className="whitespace-nowrap px-3 py-1.5">Média Mensal</th>
                <th className="whitespace-nowrap px-3 py-1.5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.map((line) => (
                <tr
                  key={line.id}
                  onClick={() => goToDetail(line)}
                  className={`cursor-pointer border-t border-border hover:bg-secondary/30 ${
                    line.inactivatedAt ? "opacity-60" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{LEVEL_LABELS[line.entityType]}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {line.entityName}
                    {line.isRecalculated && (
                      <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
                        Recalculada
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{line.hierarchyPath ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {ENGINE_LABELS[line.engineType]}
                    {line.engineType === "AGRUPAMENTO" && Number(line.groupDiscountPercentage) > 0
                      ? ` (Deságio ${Number(line.groupDiscountPercentage).toFixed(1)}%)`
                      : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {line.inactivatedAt ? (
                      <span className="text-destructive">Inativa desde {formatDate(line.inactivatedAt)}</span>
                    ) : (
                      <span className="text-success">Ativa</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {line.growthInPeriod !== null ? `${(Number(line.growthInPeriod) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">{fmt(line.initialAmount)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{fmt(line.finalAmount)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium">{fmt(line.averageMonthly)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                    {line.canEdit ? (
                      <div className="flex items-center gap-2">
                        {!line.inactivatedAt && (
                          <button
                            type="button"
                            onClick={() => {
                              closeForms();
                              setEditingLine(line);
                            }}
                            className="text-xs text-primary hover:underline"
                          >
                            Editar
                          </button>
                        )}
                        {!line.inactivatedAt && line.engineType !== "AGRUPAMENTO" && (
                          <button
                            type="button"
                            onClick={() => setReforecastLineId(reforecastLineId === line.id ? null : line.id)}
                            className="text-xs text-primary hover:underline"
                          >
                            Recalcular
                          </button>
                        )}
                        <DeactivateAction
                          isInactive={Boolean(line.inactivatedAt)}
                          onConfirm={(effectiveDate) => activeStatusMutation.mutate({ lineId: line.id, effectiveDate })}
                          onReactivate={() => activeStatusMutation.mutate({ lineId: line.id, effectiveDate: null })}
                        />
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate(line.id)}
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
      )}

      {deleteMutation.isError && (
        <p className="text-sm text-destructive">
          Não foi possível excluir: confira se esta entidade é origem de alguma Linha Agrupada.
        </p>
      )}

      {reforecastLineId && (
        <ReforecastPanel
          lineId={reforecastLineId}
          onClose={() => setReforecastLineId(null)}
          onApplied={(newLine) => {
            setReforecastLineId(null);
            navigate(
              `/metas/${campaign.id}/linha/${newLine.entityType}/${newLine.entityId}?lineId=${newLine.lineId}`,
            );
          }}
        />
      )}
    </div>
  );
}
