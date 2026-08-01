import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { GoalCampaign } from "./MetasPage";
import type { PeriodTotal } from "./GoalLinesSection";
import { GoalLinePeriodChart, type ChartPoint } from "./GoalLinePeriodChart";
import { ReforecastPanel } from "./ReforecastPanel";
import { buildMonthlyBuckets, expandMonthlyToDaily } from "./GoalLineForm";

interface GroupSourceDetail {
  goalCampaignId: string;
  campaignName: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  currentTotal: string;
  hasActiveLine: boolean;
}

interface GoalLineDetail {
  lineId: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  engineType: "VALOR_ALVO_ANUAL" | "CRESCIMENTO_MENSAL" | "CRESCIMENTO_TRIMESTRAL" | "MANUAL" | "AGRUPAMENTO";
  seasonalityBaseId: string | null;
  seasonalityBaseName: string | null;
  dailySeasonalityBaseId: string | null;
  dailySeasonalityBaseName: string | null;
  growthRate: string | null;
  groupDiscountPercentage: string | null;
  grossTotal: string | null;
  inactivatedAt: string | null;
  isRecalculated: boolean;
  total: string;
  initialAmount: string;
  finalAmount: string;
  averageMonthly: string;
  growthInPeriod: string | null;
  monthly: PeriodTotal[];
  weekly: PeriodTotal[];
  quarterly: PeriodTotal[];
  daily: { date: string; value: string }[];
  groupSources: GroupSourceDetail[];
}

type AnalysisType = "DIAS_SEMANA" | "DIAS_ANO" | "DIAS_MES" | "MESES_ANO" | "MESES_DIAS_SEMANA" | "MESES_DIAS_MES" | "TRIMESTRES";

interface SeasonalityBase {
  id: string;
  name: string;
  analysisType: AnalysisType;
  resultType: { id: string };
}

const SIMPLE_DAILY_ANALYSIS_TYPES: AnalysisType[] = ["DIAS_SEMANA", "DIAS_ANO", "DIAS_MES"];
const DAILY_ANALYSIS_LABELS: Partial<Record<AnalysisType, string>> = {
  DIAS_SEMANA: "Dias da Semana",
  DIAS_ANO: "Dias do Ano",
  DIAS_MES: "Dias do Mês",
};

const ENGINE_LABELS: Record<string, string> = {
  VALOR_ALVO_ANUAL: "Top-Down",
  CRESCIMENTO_MENSAL: "MCDS — Crescimento Mensal",
  CRESCIMENTO_TRIMESTRAL: "MCDS — Crescimento Trimestral",
  MANUAL: "Manual",
  AGRUPAMENTO: "Agrupamento de Metas",
};

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmt(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTH_LABELS[month - 1]}/${year}`;
}

function quarterLabel(key: string): string {
  const [year, quarter] = key.split("-T");
  return `T${quarter}/${year}`;
}

function dayLabel(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

export function GoalLineDetailPage() {
  const { campaignId, entityType, entityId } = useParams<{ campaignId: string; entityType: ScopeType; entityId: string }>();
  const [searchParams] = useSearchParams();
  const queryLineId = searchParams.get("lineId");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dailySeasonalityDraft, setDailySeasonalityDraft] = useState("");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Edição Manual e Quebra de Padrão (spec § Metas/4): editar uma célula do
  // "mensal" de uma Linha calculada automaticamente converte só aquela
  // Linha para o motor MANUAL, preservando os demais meses já calculados —
  // chave = índice do bucket em monthBuckets (mesmo padrão de
  // GoalLineForm.tsx, monthlyValues).
  const [monthlyEdits, setMonthlyEdits] = useState<Record<number, string>>({});
  const [monthlySaveError, setMonthlySaveError] = useState<string | null>(null);

  const { data: campaigns } = useQuery({
    queryKey: ["goal-campaigns"],
    queryFn: async () => {
      const { data } = await api.get<GoalCampaign[]>("/metas");
      return data;
    },
  });

  const campaign = campaigns?.find((c) => c.id === campaignId) ?? null;

  const detailQueryKey = ["goal-line-detail", campaignId, entityType, entityId, queryLineId];

  const { data: detail, isLoading } = useQuery({
    queryKey: detailQueryKey,
    queryFn: async () => {
      const { data } = await api.get<GoalLineDetail>(`/metas/${campaignId}/linha/${entityType}/${entityId}`, {
        params: queryLineId ? { lineId: queryLineId } : undefined,
      });
      return data;
    },
    enabled: Boolean(campaignId && entityType && entityId),
  });

  const { data: seasonalityBases } = useQuery({
    queryKey: ["seasonality-bases"],
    queryFn: async () => {
      const { data } = await api.get<SeasonalityBase[]>("/bases-metas");
      return data;
    },
    enabled: Boolean(detail) && detail?.engineType !== "AGRUPAMENTO",
  });

  const eligibleDailyBases = useMemo(
    () =>
      seasonalityBases?.filter(
        (base) => base.resultType.id === campaign?.resultType.id && SIMPLE_DAILY_ANALYSIS_TYPES.includes(base.analysisType),
      ) ?? [],
    [seasonalityBases, campaign?.resultType.id],
  );

  // Base Combinada ("Meses do Ano e Dias...") já aplica sazonalidade mensal
  // E diária na mesma ação (ver applyGoalLine/PASSO 6) — quando é esse o
  // caso, os dois campos da Linha apontam pra mesma Base.
  const isCombinedSeasonalityApplied = Boolean(
    detail?.seasonalityBaseId && detail.seasonalityBaseId === detail.dailySeasonalityBaseId,
  );

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["goal-line-detail", campaignId, entityType, entityId] });
    queryClient.invalidateQueries({ queryKey: ["goal-lines", campaignId] });
  }

  const dailySeasonalityMutation = useMutation({
    mutationFn: () =>
      api.put(`/metas/lines/${detail!.lineId}/daily-seasonality`, {
        dailySeasonalityBaseId: dailySeasonalityDraft || null,
      }),
    onSuccess: () => {
      invalidateAll();
      setError(null);
    },
    onError: () => setError("Não foi possível aplicar a sazonalidade diária."),
  });

  const activeStatusMutation = useMutation({
    mutationFn: (effectiveDate: string | null) =>
      api.put(`/metas/lines/${detail!.lineId}/active-status`, { effectiveDate }),
    onSuccess: () => {
      invalidateAll();
      setError(null);
    },
    onError: () => setError("Não foi possível alterar o status da linha."),
  });

  const monthlyChartData: ChartPoint[] = useMemo(
    () => detail?.monthly.map((m) => ({ label: monthLabel(m.key), value: Number(m.value) })) ?? [],
    [detail],
  );

  const monthBuckets = useMemo(
    () => (campaign ? buildMonthlyBuckets(campaign.startDate, campaign.endDate) : []),
    [campaign],
  );
  const monthlyByKey = useMemo(() => new Map(detail?.monthly.map((m) => [m.key, m.value]) ?? []), [detail]);
  const isMonthlyDirty = Object.keys(monthlyEdits).length > 0;

  const saveMonthlyMutation = useMutation({
    mutationFn: () => {
      const mergedValues: Record<number, string> = {};
      monthBuckets.forEach((bucket, index) => {
        mergedValues[index] = monthlyEdits[index] ?? monthlyByKey.get(bucket.key) ?? "0";
      });
      return api.post(`/metas/${campaignId}/lines/manual`, {
        entityType,
        entityId,
        dailyValues: expandMonthlyToDaily(monthBuckets, mergedValues),
      });
    },
    onSuccess: () => {
      invalidateAll();
      setMonthlyEdits({});
      setMonthlySaveError(null);
    },
    onError: () => setMonthlySaveError("Não foi possível salvar os valores mensais."),
  });

  const quarterlyChartData: ChartPoint[] = useMemo(
    () => detail?.quarterly.map((q) => ({ label: quarterLabel(q.key), value: Number(q.value) })) ?? [],
    [detail],
  );

  const monthOptions = detail?.monthly.map((m) => m.key) ?? [];
  const activeMonth = selectedMonth ?? monthOptions[0] ?? null;

  const dailyChartData: ChartPoint[] = useMemo(() => {
    if (!detail || !activeMonth) return [];
    return detail.daily
      .filter((d) => d.date.startsWith(activeMonth))
      .map((d) => ({ label: dayLabel(d.date), value: Number(d.value) }));
  }, [detail, activeMonth]);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const isAgrupamento = detail.engineType === "AGRUPAMENTO";

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate(-1)} className="text-sm text-muted-foreground hover:underline">
        ← Voltar
      </button>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{detail.entityName}</h1>
          {detail.isRecalculated && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              Meta Recalculada
            </span>
          )}
          {detail.inactivatedAt && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
              Inativa desde {formatDate(detail.inactivatedAt)}
            </span>
          )}
        </div>
        {campaign && <p className="text-sm text-muted-foreground">{campaign.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <p className="text-xs text-muted-foreground">Motor de Cálculo</p>
          <p className="text-sm font-medium text-foreground">
            {ENGINE_LABELS[detail.engineType]}
            {isAgrupamento && Number(detail.groupDiscountPercentage) > 0
              ? ` (Deságio ${Number(detail.groupDiscountPercentage).toFixed(1)}%)`
              : ""}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Crescimento no Período</p>
          <p className="text-sm font-medium text-foreground">
            {detail.growthInPeriod !== null ? `${(Number(detail.growthInPeriod) * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Inicial</p>
          <p className="text-sm font-medium text-foreground">{fmt(detail.initialAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Final</p>
          <p className="text-sm font-medium text-foreground">{fmt(detail.finalAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Média Mensal</p>
          <p className="text-sm font-semibold text-foreground">{fmt(detail.averageMonthly)}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Status</h3>
        {detail.inactivatedAt ? (
          <button
            type="button"
            onClick={() => activeStatusMutation.mutate(null)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-secondary/50"
          >
            Reativar
          </button>
        ) : (
          <DeactivateInline onConfirm={(date) => activeStatusMutation.mutate(date)} />
        )}
      </div>

      {isAgrupamento && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Origens do Agrupamento</h3>
          <p className="text-xs text-muted-foreground">
            Meta líquida = soma das Linhas abaixo (valor atual de cada uma) × (1 − Deságio). Sempre viva: se uma
            origem mudar, esta linha recalcula sozinha. Bruto antes do Deságio: {fmt(detail.grossTotal)}.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="whitespace-nowrap px-3 py-1.5">Nível</th>
                  <th className="whitespace-nowrap px-3 py-1.5">Entidade</th>
                  <th className="whitespace-nowrap px-3 py-1.5">Campanha</th>
                  <th className="whitespace-nowrap px-3 py-1.5">Valor Atual</th>
                </tr>
              </thead>
              <tbody>
                {detail.groupSources.map((source) => (
                  <tr key={`${source.goalCampaignId}:${source.entityType}:${source.entityId}`} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{LEVEL_LABELS[source.entityType]}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {source.entityName}
                      {!source.hasActiveLine && (
                        <span className="ml-1.5 text-xs text-destructive">(sem Linha ativa — contando 0)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {source.campaignName}
                      {source.goalCampaignId === campaignId ? "" : " (outra campanha)"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">{fmt(source.currentTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Para reconfigurar as origens ou o Deságio, use "Editar" na listagem de Linhas de Meta.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GoalLinePeriodChart title="Mensal" data={monthlyChartData} />
        <GoalLinePeriodChart title="Trimestral" data={quarterlyChartData} />
      </div>

      {!isAgrupamento && !detail.inactivatedAt && monthBuckets.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div>
            <h5 className="text-xs font-semibold text-foreground">Meta por Mês (editável)</h5>
            <p className="text-xs text-muted-foreground">
              {detail.engineType === "MANUAL"
                ? "Edite qualquer mês e salve — motor Manual, os outros meses não mudam."
                : 'Editar um valor aqui converte esta Linha para o motor Manual, preservando os demais meses já calculados ("Quebra de Padrão").'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {monthBuckets.map((bucket, index) => {
              const original = monthlyByKey.get(bucket.key) ?? "0";
              const displayValue = monthlyEdits[index] ?? original;
              return (
                <div key={bucket.key} className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{bucket.label}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={displayValue}
                    onChange={(event) => setMonthlyEdits((prev) => ({ ...prev, [index]: event.target.value }))}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                  />
                </div>
              );
            })}
          </div>

          {monthlySaveError && <p className="text-xs text-destructive">{monthlySaveError}</p>}

          {isMonthlyDirty && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saveMonthlyMutation.isPending}
                onClick={() => saveMonthlyMutation.mutate()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saveMonthlyMutation.isPending ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMonthlyEdits({});
                  setMonthlySaveError(null);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
              >
                Descartar
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold text-foreground">Diário</h5>
          {monthOptions.length > 0 && (
            <select
              value={activeMonth ?? ""}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              {monthOptions.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                </option>
              ))}
            </select>
          )}
        </div>
        <GoalLinePeriodChart title={activeMonth ? monthLabel(activeMonth) : "Diário"} data={dailyChartData} />
      </div>

      {!isAgrupamento && !detail.inactivatedAt && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Sazonalidade Diária (opcional)</h3>
            <p className="text-xs text-muted-foreground">
              Redistribui o valor já calculado de cada mês entre os dias de forma não-uniforme (Dias da Semana, Dias do Mês
              ou Dias do Ano), em vez da divisão igual padrão. Não recalcula a meta — só reparte o que já existe.
              {detail.dailySeasonalityBaseName && (
                <>
                  {" "}
                  Atualmente: <span className="font-medium text-foreground">{detail.dailySeasonalityBaseName}</span>.
                </>
              )}
            </p>
          </div>

          {isCombinedSeasonalityApplied ? (
            <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
              Já aplicada junto com a Sazonalidade Mensal ({detail.seasonalityBaseName}) — é uma Base Combinada, que resolve
              os dois níveis (mês e dia) numa ação só. Pra trocar, escolha uma Base Diária diferente abaixo (substitui só a
              parte diária) ou reaplique a Sazonalidade Mensal.
            </p>
          ) : null}

          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Base de Sazonalidade</label>
              <select
                value={dailySeasonalityDraft || detail.dailySeasonalityBaseId || ""}
                onChange={(event) => setDailySeasonalityDraft(event.target.value)}
                className="w-64 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              >
                <option value="">Divisão igual (padrão)</option>
                {eligibleDailyBases.map((base) => (
                  <option key={base.id} value={base.id}>
                    {base.name} ({DAILY_ANALYSIS_LABELS[base.analysisType]})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={dailySeasonalityMutation.isPending}
              onClick={() => dailySeasonalityMutation.mutate()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {dailySeasonalityMutation.isPending ? "Salvando..." : "Calcular e Salvar"}
            </button>
          </div>
        </div>
      )}

      {!isAgrupamento && !detail.inactivatedAt && (
        <div className="rounded-lg border border-border p-4">
          <ReforecastPanel
            lineId={detail.lineId}
            onClose={() => {}}
            onApplied={(newLine) => {
              navigate(`/metas/${campaignId}/linha/${newLine.entityType}/${newLine.entityId}?lineId=${newLine.lineId}`);
            }}
          />
        </div>
      )}
    </div>
  );
}

// Ação Desativar em 2 passos (mesmo padrão de GoalLinesSection): o campo de
// data só aparece depois de clicar em "Desativar".
function DeactivateInline({ onConfirm }: { onConfirm: (effectiveDate: string) => void }) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [date, setDate] = useState("");

  if (!showDatePicker) {
    return (
      <button
        type="button"
        onClick={() => setShowDatePicker(true)}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive hover:bg-secondary/50"
      >
        Desativar
      </button>
    );
  }

  return (
    <>
      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
      />
      <button
        type="button"
        disabled={!date}
        onClick={() => onConfirm(date)}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive hover:bg-secondary/50 disabled:opacity-50"
      >
        Confirmar
      </button>
    </>
  );
}
