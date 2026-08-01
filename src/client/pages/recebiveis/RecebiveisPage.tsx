import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { EntityMultiPicker } from "@/pages/acompanhamento/EntityMultiPicker";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { RecebiveisKpiCardsRow } from "./RecebiveisKpiCardsRow";
import { FechamentoCompositionChart } from "./FechamentoCompositionChart";
import { AcumuladoFixoBeneficiosChart } from "./AcumuladoFixoBeneficiosChart";
import { GanhoPorMetaTable } from "./GanhoPorMetaTable";
import { DistribuicaoTable } from "./DistribuicaoTable";
import { Metas360Table } from "./Metas360Table";
import { ModelosBeneficioChart } from "./ModelosBeneficioChart";
import { PremiosFisicosList } from "./PremiosFisicosList";
import { useRecebiveisOverview } from "./useRecebiveisQueries";
import type { RecebiveisFilters } from "./types";

function firstDayOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

function lastDayOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
}

// Recebíveis (macroambiente 8, spec §1-4): tela de consulta financeira em
// tempo real — Fechado+Aberto somam nos totais oficiais, Previsto (janela
// em andamento) fica só como informação à parte. Por padrão mostra o
// fechamento do mês corrente; o Escopo pode ser 1 Beneficiado ou um
// agrupamento (vários Membros, ou por Time/Departamento/Canal).
//
// Filtro na URL (useSearchParams), não em useState: item do menu principal
// — sair para outra tela e voltar remonta o componente do zero, e sem isso
// o filtro se perderia (mesmo bug corrigido em Fechamento/Metas/Acompanhamento).
export function RecebiveisPage() {
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const role = useAuthStore((state) => state.user?.role);
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  // Usuário só enxerga o próprio Recebível — nem escolhe, o escopo é fixo
  // no próprio Membro vinculado a ele.
  const isSelfOnly = role === "OPERACIONAL";
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

  const entityType: ScopeType = isSelfOnly ? "MEMBRO" : ((searchParams.get("entityType") as ScopeType | null) ?? "MEMBRO");
  const entityIds = useMemo(() => {
    if (isSelfOnly) return ownMemberId ? [ownMemberId] : [];
    const raw = searchParams.get("entityIds");
    return raw ? raw.split(",") : [];
  }, [isSelfOnly, ownMemberId, searchParams]);
  const periodStart = searchParams.get("periodStart") || firstDayOfCurrentMonthIso();
  const periodEnd = searchParams.get("periodEnd") || lastDayOfCurrentMonthIso();
  const highlightBaseId = searchParams.get("highlightBaseId");
  const highlightPeriodStart = searchParams.get("highlightPeriodStart");

  const filters: RecebiveisFilters = useMemo(
    () => ({ entityType, entityIds, periodStart, periodEnd }),
    [entityType, entityIds, periodStart, periodEnd],
  );

  const { data: overview, isLoading } = useRecebiveisOverview(filters);

  const bases = useMemo(() => {
    if (!overview) return [];
    const seen = new Map<string, string>();
    for (const bucket of overview.fechamentoBuckets) {
      if (!seen.has(bucket.receivablesBaseId)) seen.set(bucket.receivablesBaseId, bucket.baseName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [overview]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Recebíveis</h1>
        <p className="text-sm text-muted-foreground">
          Ganho Atual (Fechado + Aberto), o Fixo e os benefícios de cada Beneficiado ou grupo, por Período de Fechamento.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Período — Data Inicial</label>
            <input
              type="date"
              value={periodStart}
              onChange={(event) => updateParams({ periodStart: event.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Período — Data Final</label>
            <input
              type="date"
              value={periodEnd}
              onChange={(event) => updateParams({ periodEnd: event.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        </div>

        {isSelfOnly ? (
          <p className="text-xs text-muted-foreground">Mostrando os seus próprios Recebíveis.</p>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground">Escopo — 1 Beneficiado ou um agrupamento (vários, Time, Departamento ou Canal)</label>
            {/* PASSO 9.11: escopo nativo (Usuário sempre só o próprio Membro,
                nunca por atribuição de hierarquia; Gestor soma atribuições +
                o próprio Membro) — antes mostrava a árvore inteira da
                empresa sem filtro pra Admin/Gestor escolherem. */}
            <EntityMultiPicker
              companyId={companyId}
              entityType={entityType}
              entityIds={entityIds}
              onChange={(next) => updateParams({ entityType: next.entityType, entityIds: next.entityIds.join(",") })}
              scoped="native"
            />
          </div>
        )}
      </div>

      {entityIds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isSelfOnly
            ? "Seu usuário ainda não está vinculado a um Membro — peça a um Administrador para configurar."
            : "Selecione ao menos uma entidade no Escopo para ver os Recebíveis."}
        </p>
      )}

      {isLoading && entityIds.length > 0 && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {overview && (
        <div className="space-y-6">
          <RecebiveisKpiCardsRow kpis={overview.kpis} />

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Benefícios por Fechamento</h3>
            <FechamentoCompositionChart buckets={overview.fechamentoBuckets} bases={bases} />
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Acumulado no Período — Fixo x Benefícios</h3>
            <AcumuladoFixoBeneficiosChart points={overview.cumulativeSeries} />
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">{overview.table.kind === "GANHO_POR_META" ? "Recebíveis por Campanha" : "Distribuição"}</h3>
            {overview.table.kind === "GANHO_POR_META" ? (
              <GanhoPorMetaTable
                rows={overview.table.rows}
                memberId={overview.table.member.id}
                highlightBaseId={highlightBaseId}
                highlightPeriodStart={highlightPeriodStart}
              />
            ) : (
              <DistribuicaoTable rows={overview.table.rows} periodStart={periodStart} periodEnd={periodEnd} />
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Visão 360 das Metas</h3>
            <Metas360Table rows={overview.metas360} />
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Modelos de Benefício</h3>
            <ModelosBeneficioChart rows={overview.modelosBeneficio} />
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Prêmios Físicos</h3>
            <PremiosFisicosList items={overview.premiosFisicos} />
          </div>
        </div>
      )}
    </div>
  );
}
