import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { AcumuladoChart } from "./AcumuladoChart";
import { ErrorState, LoadingState } from "./AsyncState";
import { ComparativoChart } from "./ComparativoChart";
import { SELECT_ENTITY_TEXT, SELECT_RESULT_TYPE_TEXT } from "./copy";
import { EntityMultiPicker } from "./EntityMultiPicker";
import { GranularityChartSection } from "./GranularityChartSection";
import { HierarquiaTable } from "./HierarquiaTable";
import { KpiCardsRow } from "./KpiCardsRow";
import { MetaCampaignMultiSelect } from "./MetaCampaignMultiSelect";
import { RecalculadaChart } from "./RecalculadaChart";
import type { Granularity } from "./types";
import {
  useAvailableCampaigns,
  useComparativoSeries,
  useCumulativeSeries,
  useOverview,
  useRecalculatedSeries,
} from "./useAcompanhamentoQueries";

interface ResultType {
  id: string;
  name: string;
  unit: "MOEDA" | "NUMERAL";
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstDayOfYear(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}
function lastDayOfYear(): string {
  return `${new Date().getUTCFullYear()}-12-31`;
}

// Ambiente de B.I./Analytics: Período+Tipo+Realizado até no topo, seleção de
// Entidade em cascata (1 nível, multi-select), Metas disponíveis para essa
// seleção, KPIs resumo, gráfico/tabela por granularidade (paginado em
// Dia/Semana), Acumulado (sempre mensal), Comparativo anual, e drill-down
// hierárquico de Realizado.
//
// Todo o filtro vive na URL (useSearchParams), não em useState: é um item
// do menu principal — sair para outra tela e voltar (botão Voltar do
// navegador) remonta o componente do zero, e sem isso o filtro inteiro se
// perderia (mesmo bug corrigido em Fechamento/Metas).
export function AcompanhamentoPage() {
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const [searchParams, setSearchParams] = useSearchParams();

  function updateParams(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  const periodStart = searchParams.get("periodStart") || firstDayOfYear();
  const periodEnd = searchParams.get("periodEnd") || lastDayOfYear();
  const resultTypeId = searchParams.get("resultTypeId") ?? "";
  const realizadoAte = searchParams.get("realizadoAte") || isoToday();

  // Cold start (nenhum entityType na URL ainda) assume Empresa inteira em vez
  // de Membro vazio — a visita mais comum a esta tela é "como estamos indo",
  // não "como está o Fulano". Uma vez que o usuário troca de nível
  // explicitamente (mesmo que sem nada selecionado ainda), entityType passa
  // a existir na URL e este default para de se aplicar.
  const isColdStart = searchParams.get("entityType") === null;
  const entityType = (searchParams.get("entityType") as ScopeType | null) ?? "EMPRESA";
  const entityIds = useMemo(() => {
    const raw = searchParams.get("entityIds");
    if (raw) return raw.split(",");
    if (isColdStart && companyId) return [companyId];
    return [];
  }, [searchParams, isColdStart, companyId]);
  const goalCampaignIds = useMemo(() => {
    const raw = searchParams.get("goalCampaignIds");
    return raw ? raw.split(",") : [];
  }, [searchParams]);

  const granularity = (searchParams.get("granularity") as Granularity | null) ?? "MES";
  const monthOffset = Number(searchParams.get("monthOffset") ?? "0");
  const comparativoYear = Number(searchParams.get("comparativoYear") ?? String(new Date().getUTCFullYear()));

  const { data: resultTypes } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });
  const unit = resultTypes?.find((type) => type.id === resultTypeId)?.unit;

  const filters = useMemo(
    () => ({ resultTypeId, periodStart, periodEnd, realizadoAte, entityType, entityIds, goalCampaignIds }),
    [resultTypeId, periodStart, periodEnd, realizadoAte, entityType, entityIds, goalCampaignIds],
  );

  const {
    data: availableCampaigns,
    isLoading: isLoadingCampaigns,
    isError: isErrorCampaigns,
    refetch: refetchCampaigns,
  } = useAvailableCampaigns(filters);
  const {
    data: overview,
    isLoading: isLoadingOverview,
    isError: isErrorOverview,
    refetch: refetchOverview,
  } = useOverview(filters, granularity, monthOffset);
  const {
    data: cumulative,
    isLoading: isLoadingCumulative,
    isError: isErrorCumulative,
    refetch: refetchCumulative,
  } = useCumulativeSeries(filters);
  const {
    data: comparativo,
    isLoading: isLoadingComparativo,
    isError: isErrorComparativo,
    refetch: refetchComparativo,
  } = useComparativoSeries(filters, comparativoYear);
  const {
    data: recalculada,
    isLoading: isLoadingRecalculada,
    isError: isErrorRecalculada,
    refetch: refetchRecalculada,
  } = useRecalculatedSeries(filters);

  function handleEntityChange(next: { entityType: ScopeType; entityIds: string[] }) {
    updateParams({ entityType: next.entityType, entityIds: next.entityIds.join(","), goalCampaignIds: null });
  }

  function handleGranularityChange(next: Granularity) {
    updateParams({ granularity: next, monthOffset: "0" });
  }

  const hierarchyRoots = (overview?.entities ?? []).map((entity) => ({
    entityType: entity.entityType,
    entityId: entity.entityId,
    label: entity.label,
    realizado: entity.realizadoCorrido,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Acompanhamento Meta x Resultados</h1>
        <p className="text-sm text-muted-foreground">
          Compare Realizado e Meta em tempo real para o período, Tipo de Resultado e Entidade selecionados abaixo.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Data Inicial</label>
          <input
            type="date"
            value={periodStart}
            onChange={(event) => updateParams({ periodStart: event.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Data Final</label>
          <input
            type="date"
            value={periodEnd}
            onChange={(event) => updateParams({ periodEnd: event.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo de Resultado</label>
          <select
            value={resultTypeId}
            onChange={(event) => updateParams({ resultTypeId: event.target.value })}
            className="w-52 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Selecione...</option>
            {(resultTypes ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Realizado Até</label>
          <input
            type="date"
            value={realizadoAte}
            onChange={(event) => updateParams({ realizadoAte: event.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Entidades</h2>
          {/* PASSO 9.9: só entidades que o usuário tem acesso de visualização
              OU edição (EDITAR sempre conta como VISUALIZAR também) — antes
              mostrava a árvore inteira da empresa sem filtro. */}
          <EntityMultiPicker
            companyId={companyId}
            entityType={entityType}
            entityIds={entityIds}
            onChange={handleEntityChange}
            scoped="visible"
          />
        </div>
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Metas</h2>
          {isErrorCampaigns ? (
            <ErrorState onRetry={() => refetchCampaigns()} />
          ) : (
            <MetaCampaignMultiSelect
              campaigns={availableCampaigns ?? []}
              isLoading={isLoadingCampaigns}
              selectedIds={goalCampaignIds}
              onChange={(ids) => updateParams({ goalCampaignIds: ids.join(",") || null })}
              disabledReason={!resultTypeId ? SELECT_RESULT_TYPE_TEXT : entityIds.length === 0 ? SELECT_ENTITY_TEXT : null}
            />
          )}
        </div>
      </div>

      {entityIds.length === 0 && <p className="text-sm text-muted-foreground">{SELECT_ENTITY_TEXT}</p>}

      {entityIds.length > 0 && resultTypeId && isErrorOverview && <ErrorState onRetry={() => refetchOverview()} />}

      {entityIds.length > 0 && resultTypeId && isLoadingOverview && <LoadingState />}

      {entityIds.length > 0 && resultTypeId && overview && (
        <>
          <KpiCardsRow kpis={overview.kpis} unit={unit} realizadoAte={realizadoAte} />

          <GranularityChartSection
            overview={overview}
            isLoading={isLoadingOverview}
            unit={unit}
            granularity={granularity}
            onGranularityChange={handleGranularityChange}
            onMonthOffsetChange={(offset) => updateParams({ monthOffset: String(offset) })}
          />

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Acumulado no Período</h2>
            {isErrorCumulative ? (
              <ErrorState onRetry={() => refetchCumulative()} />
            ) : (
              <AcumuladoChart points={cumulative} isLoading={isLoadingCumulative} unit={unit} />
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Comparativo Anual</h2>
            {isErrorComparativo ? (
              <ErrorState onRetry={() => refetchComparativo()} />
            ) : (
              <ComparativoChart
                points={comparativo}
                isLoading={isLoadingComparativo}
                unit={unit}
                year={comparativoYear}
                onYearChange={(year) => updateParams({ comparativoYear: String(year) })}
              />
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold text-foreground">Meta Recalculada</h2>
            <p className="mb-2 text-xs text-muted-foreground">Meses restantes após a data de corte ("Realizado Até").</p>
            {isErrorRecalculada ? (
              <ErrorState onRetry={() => refetchRecalculada()} />
            ) : (
              <RecalculadaChart points={recalculada} isLoading={isLoadingRecalculada} unit={unit} />
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Detalhamento por Hierarquia</h2>
            <HierarquiaTable
              roots={hierarchyRoots}
              resultTypeId={resultTypeId}
              periodStart={periodStart}
              realizadoAte={realizadoAte}
              unit={unit}
            />
          </div>
        </>
      )}
    </div>
  );
}
