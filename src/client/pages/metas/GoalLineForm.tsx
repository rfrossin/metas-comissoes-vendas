import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { GoalCampaign } from "./MetasPage";
import type { GoalLine } from "./GoalLinesSection";
import { EntityPicker } from "./EntityPicker";

type AutoEngineType = "VALOR_ALVO_ANUAL" | "CRESCIMENTO_MENSAL" | "CRESCIMENTO_TRIMESTRAL";
type EngineType = AutoEngineType | "MANUAL" | "AGRUPAMENTO";

type SeasonalityAnalysisType =
  | "DIAS_SEMANA"
  | "DIAS_ANO"
  | "DIAS_MES"
  | "MESES_ANO"
  | "MESES_DIAS_SEMANA"
  | "MESES_DIAS_MES"
  | "TRIMESTRES";

const MONTHLY_ANALYSIS_TYPES: SeasonalityAnalysisType[] = ["MESES_ANO", "MESES_DIAS_SEMANA", "MESES_DIAS_MES"];
const MONTHLY_ANALYSIS_LABELS: Partial<Record<SeasonalityAnalysisType, string>> = {
  MESES_ANO: "Meses do Ano",
  MESES_DIAS_SEMANA: "Combinada — Meses + Dias da Semana",
  MESES_DIAS_MES: "Combinada — Meses + Dias do Mês",
};

interface SeasonalityBase {
  id: string;
  name: string;
  analysisType: SeasonalityAnalysisType;
  resultType: { id: string };
}

interface PreviewPeriod {
  period: number;
  value: string;
  startDate: string | null;
  endDate: string | null;
}

interface PreviewResult {
  total: string;
  periods: PreviewPeriod[];
}

interface GroupPreviewPeriod {
  period: number;
  key: string;
  value: string;
}

interface GroupPreviewResult {
  total: string;
  periods: GroupPreviewPeriod[];
}

interface GroupSourceDetail {
  goalCampaignId: string;
  campaignName: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
}

interface SelectedSource {
  goalCampaignId: string;
  campaignName: string;
  entityType: ScopeType;
  entityId: string;
  entityName: string;
  hierarchyPath: string | null;
}

function sourceKey(goalCampaignId: string, entityType: ScopeType, entityId: string): string {
  return `${goalCampaignId}:${entityType}:${entityId}`;
}

const ENGINE_LABELS: Record<EngineType, string> = {
  VALOR_ALVO_ANUAL: "Top-Down (Valor Alvo)",
  CRESCIMENTO_MENSAL: "MCDS — Crescimento Mensal",
  CRESCIMENTO_TRIMESTRAL: "MCDS — Crescimento Trimestral (subdivide por mês)",
  MANUAL: "Manual (digitar por mês)",
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

function toUtcDate(iso: string): Date {
  // `iso` pode chegar como data pura ("2026-01-01", ex: PreviewPeriod) ou
  // como datetime ISO completo ("2026-01-01T00:00:00.000Z", ex: GoalCampaign
  // vindo direto da serialização do Prisma) — normaliza para os 10
  // primeiros caracteres antes de anexar o horário, senão a concatenação
  // gera uma string inválida (2 timestamps) e Date vira Invalid Date.
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonthClient(year: number, month1based: number): number {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

export interface MonthBucket {
  key: string; // "YYYY-MM"
  label: string;
  days: string[];
}

// Espelha (em JS puro, sem Decimal) a divisão em meses que o servidor faz em
// buildMonthlyPeriods — usado para desenhar os campos do modo Manual e
// depois expandir os valores digitados em GoalDailyValue. Exportada:
// reaproveitada por GoalLineDetailPage.tsx (Edição Manual e Quebra de
// Padrão — editar uma célula do "mensal" de uma Linha já calculada).
export function buildMonthlyBuckets(startDateIso: string, endDateIso: string): MonthBucket[] {
  const start = toUtcDate(startDateIso);
  const end = toUtcDate(endDateIso);
  const buckets: MonthBucket[] = [];

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const total = daysInMonthClient(year, month);
    const days: string[] = [];

    for (let day = 1; day <= total; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date >= start && date <= end) {
        days.push(isoKey(date));
      }
    }

    buckets.push({ key: `${year}-${String(month).padStart(2, "0")}`, label: `${MONTH_LABELS[month - 1]}/${year}`, days });

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return buckets;
}

export function expandMonthlyToDaily(buckets: MonthBucket[], monthlyValues: Record<number, string>) {
  const result: { date: string; value: number }[] = [];

  buckets.forEach((bucket, index) => {
    const raw = monthlyValues[index];
    if (!raw || bucket.days.length === 0) return;

    const total = Number(raw);
    if (Number.isNaN(total)) return;

    const base = Math.floor((total / bucket.days.length) * 100) / 100;
    let running = 0;

    bucket.days.forEach((date, dayIndex) => {
      if (dayIndex === bucket.days.length - 1) {
        result.push({ date, value: Number((total - running).toFixed(2)) });
      } else {
        result.push({ date, value: base });
        running += base;
      }
    });
  });

  return result;
}

// O backend recusa combinações de Agrupamento inválidas (auto-referência,
// ciclo transitivo entre Linhas Agrupadas aninhadas, Tipo de Resultado
// divergente entre campanhas) com uma mensagem específica via ConflictError
// (409) — sem isso, todo erro parece um genérico "botão travado".
function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

function formatPeriodLabel(period: PreviewPeriod): string {
  if (!period.startDate) return String(period.period);
  const start = toUtcDate(period.startDate);
  return `${MONTH_LABELS[start.getUTCMonth()]}/${start.getUTCFullYear()}`;
}

interface GoalLineFormProps {
  campaign: GoalCampaign;
  campaignLines: GoalLine[];
  existingLine?: GoalLine;
  onDone: () => void;
  onCancel: () => void;
}

export function GoalLineForm({ campaign, campaignLines, existingLine, onDone, onCancel }: GoalLineFormProps) {
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const queryClient = useQueryClient();
  const isEditing = Boolean(existingLine);

  // Dentro da MESMA Campanha, só pode haver 1 Linha por Entidade — ao criar
  // uma Linha nova (não editar), exclui do seletor as Entidades que já têm
  // uma Linha ativa nesta campanha (linhas inativas/histórico não contam,
  // podem ser substituídas por uma nova). Ao editar, a Entidade já vem
  // travada (EntityPicker disabled abaixo), então não há nada a excluir.
  const usedEntityIds = isEditing ? [] : campaignLines.filter((line) => !line.inactivatedAt).map((line) => line.entityId);

  const [entityType, setEntityType] = useState<ScopeType>(existingLine?.entityType ?? "MEMBRO");
  const [entityId, setEntityId] = useState(existingLine?.entityId ?? "");
  const [engineType, setEngineType] = useState<EngineType>(existingLine?.engineType ?? "CRESCIMENTO_MENSAL");
  const [semSazonalidade, setSemSazonalidade] = useState(existingLine ? !existingLine.seasonalityBaseId : false);
  const [seasonalityBaseId, setSeasonalityBaseId] = useState(existingLine?.seasonalityBaseId ?? "");
  const [initialValue, setInitialValue] = useState(existingLine?.initialAmount ?? "");
  const [showHistoricalPull, setShowHistoricalPull] = useState(false);
  const [historicalStartDate, setHistoricalStartDate] = useState("");
  const [historicalEndDate, setHistoricalEndDate] = useState("");
  const [growthRatePercent, setGrowthRatePercent] = useState(
    existingLine?.growthRate ? String(Number(existingLine.growthRate) * 100) : "",
  );
  const [monthlyValues, setMonthlyValues] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [browseCampaignId, setBrowseCampaignId] = useState(campaign.id);
  const [selectedSources, setSelectedSources] = useState<Record<string, SelectedSource>>({});
  const [groupDiscountPercent, setGroupDiscountPercent] = useState(existingLine?.groupDiscountPercentage ?? "0");
  const [groupPreview, setGroupPreview] = useState<GroupPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Campanhas com o MESMO Tipo de Resultado da atual — só entre elas faz
  // sentido agrupar Linhas (validado também no servidor).
  const { data: allCampaigns } = useQuery({
    queryKey: ["goal-campaigns"],
    queryFn: async () => {
      const { data } = await api.get<GoalCampaign[]>("/metas");
      return data;
    },
  });
  const sameResultTypeCampaigns = useMemo(
    () => (allCampaigns ?? []).filter((c) => c.resultType.id === campaign.resultType.id),
    [allCampaigns, campaign.resultType.id],
  );

  // Linhas candidatas a origem da campanha que está sendo NAVEGADA no
  // seletor (pode ser a atual ou qualquer outra do mesmo Tipo de Resultado)
  // — a campanha atual já vem pronta via `campaignLines`, evitando refetch.
  const { data: browsedLines } = useQuery({
    queryKey: ["goal-lines", browseCampaignId],
    queryFn: async () => {
      const { data } = await api.get<GoalLine[]>(`/metas/${browseCampaignId}/lines`);
      return data;
    },
    enabled: browseCampaignId !== campaign.id,
  });
  const linesOfBrowsedCampaign = browseCampaignId === campaign.id ? campaignLines : browsedLines ?? [];

  // Prefill das origens ao editar uma Linha Agrupada existente — a lista
  // plana de GoalLinesSection não carrega isso, só o detalhe da própria
  // linha (mesma rota usada pela tela de detalhe).
  const { data: existingDetail } = useQuery({
    queryKey: ["goal-line-detail-for-edit", campaign.id, existingLine?.id],
    queryFn: async () => {
      const { data } = await api.get<{ groupSources: GroupSourceDetail[] }>(
        `/metas/${campaign.id}/linha/${existingLine!.entityType}/${existingLine!.entityId}`,
        { params: { lineId: existingLine!.id } },
      );
      return data;
    },
    enabled: Boolean(existingLine) && existingLine?.engineType === "AGRUPAMENTO",
  });

  useEffect(() => {
    if (!existingDetail) return;

    const prefilled: Record<string, SelectedSource> = {};
    for (const source of existingDetail.groupSources) {
      const key = sourceKey(source.goalCampaignId, source.entityType, source.entityId);
      prefilled[key] = {
        goalCampaignId: source.goalCampaignId,
        campaignName: source.campaignName,
        entityType: source.entityType,
        entityId: source.entityId,
        entityName: source.entityName,
        hierarchyPath: null,
      };
    }
    setSelectedSources(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDetail]);

  const { data: seasonalityBases } = useQuery({
    queryKey: ["seasonality-bases"],
    queryFn: async () => {
      const { data } = await api.get<SeasonalityBase[]>("/bases-metas");
      return data;
    },
    enabled: engineType !== "MANUAL" && engineType !== "AGRUPAMENTO" && !semSazonalidade,
  });

  const eligibleBases = useMemo(
    () =>
      seasonalityBases?.filter(
        (base) => base.resultType.id === campaign.resultType.id && MONTHLY_ANALYSIS_TYPES.includes(base.analysisType),
      ) ?? [],
    [seasonalityBases, campaign.resultType.id],
  );

  const monthlyBuckets = useMemo(
    () => (engineType === "MANUAL" ? buildMonthlyBuckets(campaign.startDate, campaign.endDate) : []),
    [engineType, campaign.startDate, campaign.endDate],
  );

  // Pré-preenche os campos mensais do modo Manual a partir dos valores já
  // salvos da linha (agrupados por mês em `existingLine.monthly`).
  useEffect(() => {
    if (!existingLine || engineType !== "MANUAL" || monthlyBuckets.length === 0) return;

    const byMonth = new Map(existingLine.monthly.map((m) => [m.key, m.value]));
    const prefilled: Record<number, string> = {};

    monthlyBuckets.forEach((bucket, index) => {
      const value = byMonth.get(bucket.key);
      if (value) prefilled[index] = value;
    });

    setMonthlyValues(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingLine, engineType, monthlyBuckets.length]);

  const candidateSources = linesOfBrowsedCampaign.filter(
    (line) => !line.inactivatedAt && !(browseCampaignId === campaign.id && line.entityType === entityType && line.entityId === entityId),
  );
  const selectedSourceList = Object.values(selectedSources);

  const calcPayload = {
    entityType,
    entityId,
    engineType: engineType as AutoEngineType,
    seasonalityBaseId: semSazonalidade ? null : seasonalityBaseId || null,
    initialValue: Number(initialValue),
    growthRate: Number(growthRatePercent) / 100,
  };

  const groupPayload = {
    entityType,
    entityId,
    sources: selectedSourceList.map((s) => ({ goalCampaignId: s.goalCampaignId, entityType: s.entityType, entityId: s.entityId })),
    discountPercentage: Number(groupDiscountPercent || 0),
  };

  const historicalValueMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ value: string }>(`/metas/${campaign.id}/historical-value`, {
        entityType,
        entityId,
        startDate: historicalStartDate,
        endDate: historicalEndDate,
      });
      return data;
    },
    onSuccess: (data) => {
      setInitialValue(data.value);
      setError(null);
    },
    onError: () => setError("Não foi possível buscar o histórico para este período."),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<PreviewResult>(`/metas/${campaign.id}/lines/preview`, calcPayload);
      return data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: () => {
      setError("Não foi possível calcular: confira Valor Inicial, Crescimento e a Base de Sazonalidade.");
      setPreview(null);
    },
  });

  const groupPreviewMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<GroupPreviewResult>(`/metas/${campaign.id}/lines/group/preview`, groupPayload);
      return data;
    },
    onSuccess: (data) => {
      setGroupPreview(data);
      setError(null);
    },
    onError: (mutationError) => {
      setError(
        extractErrorMessage(mutationError, "Não foi possível calcular: confira as Linhas selecionadas e o Deságio."),
      );
      setGroupPreview(null);
    },
  });

  // Botão "Puxar Período Anterior": sugere, para cada mês do período da
  // campanha atual, o Realizado do mesmo mês exatamente um ano antes. Só
  // preenche os campos — continuam editáveis antes de Aplicar.
  const previousPeriodMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<{ period: number; key: string; value: string }[]>(
        `/metas/${campaign.id}/previous-period-values`,
        { params: { entityType, entityId } },
      );
      return data;
    },
    onSuccess: (data) => {
      const byKey = new Map(data.map((d) => [d.key, d.value]));
      setMonthlyValues((prev) => {
        const next = { ...prev };
        monthlyBuckets.forEach((bucket, index) => {
          const value = byKey.get(bucket.key);
          if (value !== undefined) next[index] = value;
        });
        return next;
      });
      setError(null);
    },
    onError: () => setError("Não foi possível puxar os valores do período anterior."),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (engineType === "MANUAL") {
        return api.post(`/metas/${campaign.id}/lines/manual`, {
          entityType,
          entityId,
          dailyValues: expandMonthlyToDaily(monthlyBuckets, monthlyValues),
        });
      }
      if (engineType === "AGRUPAMENTO") {
        return api.post(`/metas/${campaign.id}/lines/group/apply`, groupPayload);
      }
      return api.post(`/metas/${campaign.id}/lines/apply`, calcPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goal-lines", campaign.id] });
      onDone();
    },
    onError: (mutationError) => setError(extractErrorMessage(mutationError, "Não foi possível salvar a Linha de Meta.")),
  });

  const canPreview = Boolean(entityId && initialValue && growthRatePercent && (semSazonalidade || seasonalityBaseId));
  const canApplyAuto = Boolean(preview && canPreview);
  const canApplyManual = Boolean(entityId && Object.values(monthlyValues).some((v) => v));
  const canPreviewGroup = Boolean(entityId && selectedSourceList.length > 0);
  const canApplyGroup = Boolean(groupPreview && canPreviewGroup);
  const canApply =
    engineType === "MANUAL" ? canApplyManual : engineType === "AGRUPAMENTO" ? canApplyGroup : canApplyAuto;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h4 className="text-sm font-semibold text-foreground">{isEditing ? "Editar Linha de Meta" : "Nova Linha de Meta"}</h4>

      <div className="flex flex-wrap gap-3">
        {/* PASSO 9.8: entidade da própria Linha escopada ao que o usuário
            pode editar (mesmo escopo que assertNodeWithinEditableScope já
            valida no save) — diferente da Sazonalidade e das fontes de
            Agrupamento abaixo, que continuam sem filtro de propósito. */}
        <EntityPicker
          companyId={companyId}
          entityType={entityType}
          entityId={entityId}
          disabled={isEditing}
          excludeEntityIds={usedEntityIds}
          scoped="editable"
          onChange={({ entityType: nextType, entityId: nextId }) => {
            setEntityType(nextType);
            setEntityId(nextId);
            setPreview(null);
            setGroupPreview(null);
          }}
        />
        {!isEditing && usedEntityIds.length > 0 && (
          <p className="w-full text-xs text-muted-foreground">
            Entidades que já têm uma Linha ativa nesta Campanha não aparecem na lista — edite a Linha existente em vez de criar outra para a mesma Entidade.
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Motor de Cálculo</label>
          <select
            value={engineType}
            onChange={(event) => {
              setEngineType(event.target.value as EngineType);
              setPreview(null);
              setGroupPreview(null);
              setSeasonalityBaseId("");
            }}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            {(Object.keys(ENGINE_LABELS) as EngineType[]).map((engine) => (
              <option key={engine} value={engine}>
                {ENGINE_LABELS[engine]}
              </option>
            ))}
          </select>
        </div>

        {engineType !== "MANUAL" && engineType !== "AGRUPAMENTO" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Valor Inicial</label>
              <input
                type="number"
                step="0.01"
                value={initialValue}
                onChange={(event) => setInitialValue(event.target.value)}
                className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
              {entityId && (
                <button
                  type="button"
                  onClick={() => setShowHistoricalPull((prev) => !prev)}
                  className="text-left text-xs text-primary hover:underline"
                >
                  Puxar do histórico...
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                {engineType === "VALOR_ALVO_ANUAL" ? "Crescimento Total (%)" : "Crescimento por Período (%)"}
              </label>
              <input
                type="number"
                step="0.01"
                value={growthRatePercent}
                onChange={(event) => setGrowthRatePercent(event.target.value)}
                className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
          </>
        )}
      </div>

      {showHistoricalPull && entityId && engineType !== "MANUAL" && engineType !== "AGRUPAMENTO" && (
        <div className="flex flex-wrap items-end gap-3 rounded-md bg-secondary/30 p-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Histórico — Data Inicial</label>
            <input
              type="date"
              value={historicalStartDate}
              onChange={(event) => setHistoricalStartDate(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Final</label>
            <input
              type="date"
              value={historicalEndDate}
              onChange={(event) => setHistoricalEndDate(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <button
            type="button"
            disabled={!historicalStartDate || !historicalEndDate || historicalValueMutation.isPending}
            onClick={() => historicalValueMutation.mutate()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            {historicalValueMutation.isPending ? "Buscando..." : "Buscar"}
          </button>
          {historicalValueMutation.data && (
            <p className="text-xs text-muted-foreground">
              Encontrado: {Number(historicalValueMutation.data.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}{" "}
              — já preenchido no Valor Inicial.
            </p>
          )}
        </div>
      )}

      {engineType !== "MANUAL" && engineType !== "AGRUPAMENTO" && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={semSazonalidade}
              onChange={(event) => {
                setSemSazonalidade(event.target.checked);
                setSeasonalityBaseId("");
                setPreview(null);
              }}
            />
            Sem Sazonalidade (peso igual entre todos os meses do período
            {engineType === "CRESCIMENTO_TRIMESTRAL" ? ", e entre os meses de cada trimestre" : ""})
          </label>

          {!semSazonalidade && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Base de Sazonalidade (Meses do Ano ou Combinada)</label>
              <select
                value={seasonalityBaseId}
                onChange={(event) => setSeasonalityBaseId(event.target.value)}
                className="w-64 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              >
                <option value="">Selecione...</option>
                {eligibleBases.map((base) => (
                  <option key={base.id} value={base.id}>
                    {base.name} ({MONTHLY_ANALYSIS_LABELS[base.analysisType]})
                  </option>
                ))}
              </select>
              {eligibleBases.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma Base "Meses do Ano" (ou Combinada) para "{campaign.resultType.name}". Cadastre uma em Bases para
                  Metas, ou marque Sem Sazonalidade.
                </p>
              )}
              {eligibleBases.find((b) => b.id === seasonalityBaseId) &&
                (eligibleBases.find((b) => b.id === seasonalityBaseId)!.analysisType === "MESES_DIAS_SEMANA" ||
                  eligibleBases.find((b) => b.id === seasonalityBaseId)!.analysisType === "MESES_DIAS_MES") && (
                  <p className="text-xs text-muted-foreground">
                    Base Combinada — ao aplicar, a Sazonalidade Diária já é resolvida junto (não precisa de um 2º passo).
                  </p>
                )}
              {engineType === "CRESCIMENTO_TRIMESTRAL" && (
                <p className="text-xs text-muted-foreground">
                  O crescimento acelera por trimestre; a Base define como o total de cada trimestre se reparte entre
                  os 3 meses.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {engineType === "MANUAL" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!entityId || previousPeriodMutation.isPending}
            onClick={() => previousPeriodMutation.mutate()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            {previousPeriodMutation.isPending ? "Buscando..." : "Puxar Período Anterior"}
          </button>
          <p className="text-xs text-muted-foreground">
            Preenche cada mês com o Realizado do mesmo mês um ano antes — os valores continuam editáveis.
          </p>
        </div>
      )}

      {engineType === "MANUAL" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {monthlyBuckets.map((bucket, index) => (
            <div key={bucket.key} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{bucket.label}</label>
              <input
                type="number"
                step="0.01"
                value={monthlyValues[index] ?? ""}
                onChange={(event) => setMonthlyValues((prev) => ({ ...prev, [index]: event.target.value }))}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
          ))}
        </div>
      )}

      {engineType === "AGRUPAMENTO" && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Linhas de Meta a agrupar</p>
            <p className="text-xs text-muted-foreground">
              A meta desta entidade será a soma das Linhas selecionadas, com o Deságio abaixo — e permanece viva:
              se uma origem mudar (editar, recalcular, desativar), esta linha recalcula sozinha. Pode agrupar
              Linhas de outras campanhas, desde que o Tipo de Resultado seja o mesmo.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Campanha de origem (navegar)</label>
            <select
              value={browseCampaignId}
              onChange={(event) => setBrowseCampaignId(event.target.value)}
              className="w-72 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              {sameResultTypeCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.id === campaign.id ? " (atual)" : ""}
                </option>
              ))}
            </select>
          </div>

          {candidateSources.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma outra Linha de Meta disponível nesta campanha ainda.</p>
          )}

          <div className="max-h-48 w-full max-w-xl overflow-y-auto rounded-md border border-input bg-background p-1.5">
            {candidateSources.map((line) => {
              const key = sourceKey(browseCampaignId, line.entityType, line.entityId);
              const browsedCampaignName = sameResultTypeCampaigns.find((c) => c.id === browseCampaignId)?.name ?? "";
              return (
                <label
                  key={line.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-secondary/50"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selectedSources[key])}
                    onChange={(event) => {
                      setSelectedSources((prev) => {
                        const next = { ...prev };
                        if (event.target.checked) {
                          next[key] = {
                            goalCampaignId: browseCampaignId,
                            campaignName: browsedCampaignName,
                            entityType: line.entityType,
                            entityId: line.entityId,
                            entityName: line.entityName,
                            hierarchyPath: line.hierarchyPath,
                          };
                        } else {
                          delete next[key];
                        }
                        return next;
                      });
                      setGroupPreview(null);
                    }}
                  />
                  <span>
                    {LEVEL_LABELS[line.entityType]}: {line.entityName}
                    {line.hierarchyPath && <span className="ml-1 text-muted-foreground">({line.hierarchyPath})</span>}
                  </span>
                </label>
              );
            })}
          </div>

          {selectedSourceList.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedSourceList.map((source) => {
                const key = sourceKey(source.goalCampaignId, source.entityType, source.entityId);
                return (
                  <span
                    key={key}
                    className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                  >
                    {LEVEL_LABELS[source.entityType]}: {source.entityName}
                    {source.goalCampaignId !== campaign.id && (
                      <span className="text-muted-foreground">[{source.campaignName}]</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSources((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                        setGroupPreview(null);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Deságio (%)</label>
            <input
              type="number"
              step="0.1"
              value={groupDiscountPercent}
              onChange={(event) => {
                setGroupDiscountPercent(event.target.value);
                setGroupPreview(null);
              }}
              className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>

          <button
            type="button"
            disabled={!canPreviewGroup || groupPreviewMutation.isPending}
            onClick={() => groupPreviewMutation.mutate()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            {groupPreviewMutation.isPending ? "Calculando..." : "Calcular"}
          </button>
        </div>
      )}

      {engineType !== "MANUAL" && engineType !== "AGRUPAMENTO" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canPreview || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            {previewMutation.isPending ? "Calculando..." : "Calcular Prévia"}
          </button>
        </div>
      )}

      {preview && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                {preview.periods.map((p) => (
                  <th key={p.period} className="whitespace-nowrap px-2 py-1">
                    {formatPeriodLabel(p)}
                  </th>
                ))}
                <th className="whitespace-nowrap px-2 py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                {preview.periods.map((p) => (
                  <td key={p.period} className="whitespace-nowrap px-2 py-1">
                    {Number(p.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1 font-medium">
                  {Number(preview.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {groupPreview && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                {groupPreview.periods.map((p) => (
                  <th key={p.key} className="whitespace-nowrap px-2 py-1">
                    {p.key}
                  </th>
                ))}
                <th className="whitespace-nowrap px-2 py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                {groupPreview.periods.map((p) => (
                  <td key={p.key} className="whitespace-nowrap px-2 py-1">
                    {Number(p.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1 font-medium">
                  {Number(groupPreview.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!canApply || applyMutation.isPending}
          onClick={() => applyMutation.mutate()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {applyMutation.isPending ? "Salvando..." : isEditing ? "Salvar Alterações" : "Aplicar"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
          Cancelar
        </button>
      </div>
    </div>
  );
}
