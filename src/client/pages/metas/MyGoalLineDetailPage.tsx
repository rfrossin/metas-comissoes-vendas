import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { GoalCampaign } from "./MetasPage";
import type { PeriodTotal } from "./GoalLinesSection";
import { GoalLinePeriodChart, type ChartPoint } from "./GoalLinePeriodChart";

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
  // Não declarado na interface irmã de GoalLineDetailPage.tsx (nunca usado
  // lá), mas o backend já devolve (buildGoalLineRow inclui no spread) —
  // aqui é exibido como campo próprio.
  hierarchyPath: string | null;
}

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

// Versão somente-leitura de GoalLineDetailPage.tsx, para "Minhas Metas"
// (autoatendimento) — mesmos dados (mesmos 2 endpoints), sem nenhum
// controle de edição (sem Reativar/Desativar, sem grade mensal editável,
// sem formulário de Sazonalidade Diária, sem Reforecast). Arquivo isolado
// de propósito: reduz o risco de um usuário comum acabar vendo — ou
// acionando — um controle de edição por causa de uma condição esquecida.
export function MyGoalLineDetailPage() {
  const { campaignId, entityType, entityId } = useParams<{ campaignId: string; entityType: ScopeType; entityId: string }>();
  const [searchParams] = useSearchParams();
  const queryLineId = searchParams.get("lineId");
  const navigate = useNavigate();

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const { data: campaigns } = useQuery({
    queryKey: ["goal-campaigns"],
    queryFn: async () => {
      const { data } = await api.get<GoalCampaign[]>("/metas");
      return data;
    },
  });

  const campaign = campaigns?.find((c) => c.id === campaignId) ?? null;

  const { data: detail, isLoading } = useQuery({
    queryKey: ["my-goal-line-detail", campaignId, entityType, entityId, queryLineId],
    queryFn: async () => {
      const { data } = await api.get<GoalLineDetail>(`/metas/${campaignId}/linha/${entityType}/${entityId}`, {
        params: queryLineId ? { lineId: queryLineId } : undefined,
      });
      return data;
    },
    enabled: Boolean(campaignId && entityType && entityId),
  });

  const monthlyChartData: ChartPoint[] = useMemo(
    () => detail?.monthly.map((m) => ({ label: monthLabel(m.key), value: Number(m.value) })) ?? [],
    [detail],
  );

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
      <button
        type="button"
        onClick={() => navigate("/metas?tab=minhas")}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Voltar
      </button>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{detail.entityName}</h1>
          {detail.isRecalculated && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">Meta Recalculada</span>
          )}
          {detail.inactivatedAt ? (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
              Inativa desde {formatDate(detail.inactivatedAt)}
            </span>
          ) : (
            <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">Ativa</span>
          )}
        </div>
        {campaign && (
          <p className="text-sm text-muted-foreground">
            {campaign.name} · {LEVEL_LABELS[detail.entityType]}
            {detail.hierarchyPath ? ` (${detail.hierarchyPath})` : ""}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Tipo de Resultado</p>
          <p className="text-sm font-medium text-foreground">{campaign?.resultType.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Período de Vigência</p>
          <p className="text-sm font-medium text-foreground">
            {campaign ? `${formatDate(campaign.startDate)} – ${formatDate(campaign.endDate)}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sazonalidade Mensal</p>
          <p className="text-sm font-medium text-foreground">{detail.seasonalityBaseName ?? "Divisão igual (padrão)"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sazonalidade Diária</p>
          <p className="text-sm font-medium text-foreground">{detail.dailySeasonalityBaseName ?? "Divisão igual (padrão)"}</p>
        </div>
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

      {isAgrupamento && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Origens do Agrupamento</h3>
          <p className="text-xs text-muted-foreground">
            Meta líquida = soma das Linhas abaixo (valor atual de cada uma) × (1 − Deságio). Bruto antes do Deságio:{" "}
            {fmt(detail.grossTotal)}.
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
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GoalLinePeriodChart title="Mensal" data={monthlyChartData} />
        <GoalLinePeriodChart title="Trimestral" data={quarterlyChartData} />
      </div>

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
    </div>
  );
}
