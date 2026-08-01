import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ResultType } from "@/pages/resultados/ResultTypesSection";
import { ScopeSelector, type ScopeType } from "./ScopeSelector";
import { SeasonalityWeeklyChart, type WeightPoint } from "./SeasonalityWeeklyChart";

export type AnalysisType =
  | "DIAS_SEMANA"
  | "DIAS_ANO"
  | "DIAS_MES"
  | "MESES_ANO"
  | "MESES_DIAS_SEMANA"
  | "MESES_DIAS_MES"
  | "TRIMESTRES";

const COMBINED_ANALYSIS_TYPES: AnalysisType[] = ["MESES_DIAS_SEMANA", "MESES_DIAS_MES"];

const ANALYSIS_OPTIONS: { value: AnalysisType; label: string }[] = [
  { value: "DIAS_SEMANA", label: "Dias da Semana" },
  { value: "DIAS_ANO", label: "Dias do Ano" },
  { value: "DIAS_MES", label: "Dias do Mês" },
  { value: "MESES_ANO", label: "Meses do Ano" },
  { value: "MESES_DIAS_SEMANA", label: "Meses do Ano e Dias da Semana (Combinada)" },
  { value: "MESES_DIAS_MES", label: "Meses do Ano e Dias do Mês (Combinada)" },
  { value: "TRIMESTRES", label: "Trimestres do Ano" },
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => ({
  key: index + 1,
  label: String(index + 1),
}));

const DAYS_OF_YEAR = Array.from({ length: 365 }, (_, index) => ({
  key: index + 1,
  label: `Dia ${index + 1}`,
}));

// Tipos Combinados não têm uma lista de baldes própria — são 12×7 ou 12×31
// células (mês × balde diário), sempre calculadas do histórico (sem modo
// Manual, ver isManual mais abaixo). BUCKETS só serve os tipos simples.
const BUCKETS: Partial<Record<AnalysisType, { key: number; label: string }[]>> = {
  DIAS_SEMANA: [
    { key: 1, label: "Segunda" },
    { key: 2, label: "Terça" },
    { key: 3, label: "Quarta" },
    { key: 4, label: "Quinta" },
    { key: 5, label: "Sexta" },
    { key: 6, label: "Sábado" },
    { key: 7, label: "Domingo" },
  ],
  DIAS_ANO: DAYS_OF_YEAR,
  DIAS_MES: DAYS_OF_MONTH,
  MESES_ANO: [
    { key: 1, label: "Jan" },
    { key: 2, label: "Fev" },
    { key: 3, label: "Mar" },
    { key: 4, label: "Abr" },
    { key: 5, label: "Mai" },
    { key: 6, label: "Jun" },
    { key: 7, label: "Jul" },
    { key: 8, label: "Ago" },
    { key: 9, label: "Set" },
    { key: 10, label: "Out" },
    { key: 11, label: "Nov" },
    { key: 12, label: "Dez" },
  ],
  TRIMESTRES: [
    { key: 1, label: "T1" },
    { key: 2, label: "T2" },
    { key: 3, label: "T3" },
    { key: 4, label: "T4" },
  ],
};

const WEEKDAY_LABELS: Record<number, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom" };
const MONTH_LABELS: Record<number, string> = {
  1: "Jan",
  2: "Fev",
  3: "Mar",
  4: "Abr",
  5: "Mai",
  6: "Jun",
  7: "Jul",
  8: "Ago",
  9: "Set",
  10: "Out",
  11: "Nov",
  12: "Dez",
};
const QUARTER_LABELS: Record<number, string> = { 1: "T1", 2: "T2", 3: "T3", 4: "T4" };
const DAY_OF_YEAR_LABELS: Record<number, string> = Object.fromEntries(DAYS_OF_YEAR.map((d) => [d.key, d.label]));

function chartLabels(analysisType: AnalysisType): Record<number, string> {
  const buckets = BUCKETS[analysisType];
  return buckets ? Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.label])) : {};
}

interface AllPreviewSeries {
  weekly: WeightPoint[];
  dailyOfYear: WeightPoint[];
  monthly: WeightPoint[];
  quarterly: WeightPoint[];
}

interface PreviewResponse {
  weights: { referenceMonth: number | null; referenceKey: number; weight: number }[];
  allSeries: AllPreviewSeries;
}

// PASSO 9.6: dados de uma Base já existente, pra abrir o formulário em modo
// edição (mesmo componente usado pra criar) — vem direto da listagem já
// carregada por BasesMetasPage.tsx (GET /bases-metas já inclui weights e
// tudo mais, sem precisar de uma busca extra).
export interface EditingSeasonalityBase {
  id: string;
  name: string;
  resultType: { id: string };
  analysisType: AnalysisType;
  scopeType: ScopeType;
  scopeId: string | null;
  isManual: boolean;
  startDate: string | null;
  endDate: string | null;
  weights: { referenceMonth: number | null; referenceKey: number; weight: string }[];
}

export function SeasonalityBaseForm({
  editingBase,
  onDone,
  onCancel,
}: {
  editingBase?: EditingSeasonalityBase;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(editingBase?.name ?? "");
  const [resultTypeId, setResultTypeId] = useState(editingBase?.resultType.id ?? "");
  const [analysisType, setAnalysisType] = useState<AnalysisType>(editingBase?.analysisType ?? "DIAS_SEMANA");
  const [scopeType, setScopeType] = useState<ScopeType>(editingBase?.scopeType ?? "EMPRESA");
  const [scopeId, setScopeId] = useState<string | null>(editingBase?.scopeId ?? null);
  const [isManual, setIsManual] = useState(editingBase?.isManual ?? false);
  const [startDate, setStartDate] = useState(editingBase?.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(editingBase?.endDate?.slice(0, 10) ?? "");
  const [manualWeights, setManualWeights] = useState<Record<number, string>>(() => {
    if (!editingBase?.isManual) return {};
    return Object.fromEntries(editingBase.weights.map((w) => [w.referenceKey, String(Number(w.weight) * 100)]));
  });
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCombined = COMBINED_ANALYSIS_TYPES.includes(analysisType);
  const buckets = BUCKETS[analysisType] ?? null;

  const { data: types } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<PreviewResponse>("/bases-metas/preview", {
        resultTypeId,
        analysisType,
        scopeType,
        scopeId,
        startDate,
        endDate,
      });
      return data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: () => {
      setError("Não foi possível calcular: confirme se há Resultados lançados no período/escopo.");
      setPreview(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        resultTypeId,
        analysisType,
        scopeType,
        scopeId,
        isManual,
        ...(isManual && buckets
          ? {
              manualWeights: buckets.map((bucket) => ({
                referenceKey: bucket.key,
                percentage: Number(manualWeights[bucket.key] ?? 0),
              })),
            }
          : { startDate, endDate }),
      };
      return editingBase ? api.put(`/bases-metas/${editingBase.id}`, payload) : api.post("/bases-metas", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seasonality-bases"] });
      onDone();
    },
    onError: () => {
      setError("Não foi possível salvar a base de sazonalidade.");
    },
  });

  const manualSum = (buckets ?? []).reduce((total, bucket) => total + Number(manualWeights[bucket.key] || 0), 0);
  const manualSumOk = Math.abs(manualSum - 100) <= 0.01;

  const canSave = Boolean(
    name && resultTypeId && (isManual && !isCombined ? manualSumOk : preview) && (scopeType === "EMPRESA" || scopeId),
  );

  function handleSave() {
    if (!canSave) {
      return;
    }

    saveMutation.mutate();
  }

  function handleAnalysisTypeChange(value: AnalysisType) {
    setAnalysisType(value);
    setPreview(null);
    setManualWeights({});
    setError(null);
    if (COMBINED_ANALYSIS_TYPES.includes(value)) {
      setIsManual(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {editingBase ? "Editar Base de Sazonalidade" : "Nova Base de Sazonalidade"}
        </h2>
        <p className="text-xs text-muted-foreground">
          Calcula o peso de cada período a partir do histórico de Resultados, ou permite digitar os
          percentuais manualmente.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Nome</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo de Resultado</label>
          <select
            value={resultTypeId}
            onChange={(event) => setResultTypeId(event.target.value)}
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

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo de Análise</label>
          <select
            value={analysisType}
            onChange={(event) => handleAnalysisTypeChange(event.target.value as AnalysisType)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            {ANALYSIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ScopeSelector
        scopeType={scopeType}
        scopeId={scopeId}
        onScopeTypeChange={setScopeType}
        onScopeIdChange={setScopeId}
      />

      {isCombined ? (
        <p className="text-xs text-muted-foreground">
          Sazonalidades Combinadas são sempre calculadas do histórico (sem modo Manual) — cada Mês pode ter um padrão de dias
          diferente, então não faz sentido digitar os percentuais à mão.
        </p>
      ) : (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={isManual}
            onChange={(event) => {
              setIsManual(event.target.checked);
              setPreview(null);
              setError(null);
            }}
          />
          Sazonalidade Manual (digitar percentuais em vez de calcular do histórico)
        </label>
      )}

      {(!isManual || isCombined) && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Período de Análise — Início</label>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Fim</label>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
            <button
              type="button"
              disabled={!resultTypeId || !startDate || !endDate || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
            >
              {previewMutation.isPending ? "Calculando..." : "Calcular Prévia"}
            </button>
          </div>

          {preview && (
            <div className="space-y-4">
              {isCombined ? (
                <p className="text-xs text-muted-foreground">
                  {preview.weights.length} células (Mês × balde diário) calculadas — confira os 4 gráficos de contexto abaixo
                  antes de salvar.
                </p>
              ) : (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Prévia — Peso por Período ({ANALYSIS_OPTIONS.find((o) => o.value === analysisType)?.label})</p>
                  <SeasonalityWeeklyChart weights={preview.weights} labels={chartLabels(analysisType)} />
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold text-foreground">
                  Conferência — 4 gráficos simultâneos (mesmo dado bruto, 4 lentes diferentes)
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Semanal</p>
                    <SeasonalityWeeklyChart weights={preview.allSeries.weekly} labels={WEEKDAY_LABELS} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Diário do Ano</p>
                    <SeasonalityWeeklyChart weights={preview.allSeries.dailyOfYear} labels={DAY_OF_YEAR_LABELS} tickInterval={29} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Mensal</p>
                    <SeasonalityWeeklyChart weights={preview.allSeries.monthly} labels={MONTH_LABELS} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Trimestral</p>
                    <SeasonalityWeeklyChart weights={preview.allSeries.quarterly} labels={QUARTER_LABELS} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isManual && !isCombined && buckets && (
        <div className="space-y-2">
          <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{bucket.label}</label>
                <input
                  type="number"
                  step="0.01"
                  value={manualWeights[bucket.key] ?? ""}
                  onChange={(event) =>
                    setManualWeights((prev) => ({ ...prev, [bucket.key]: event.target.value }))
                  }
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                />
              </div>
            ))}
          </div>
          <p className={`text-xs ${manualSumOk ? "text-success" : "text-destructive"}`}>
            Soma atual: {manualSum.toFixed(2)}% {manualSumOk ? "✓" : "(precisa fechar em 100%)"}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!canSave || saveMutation.isPending}
          onClick={handleSave}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saveMutation.isPending ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
