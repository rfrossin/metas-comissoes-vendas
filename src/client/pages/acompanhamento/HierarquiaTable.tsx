import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { ErrorState, LoadingState } from "./AsyncState";
import { SELECT_ENTITY_TEXT } from "./copy";
import { formatMetricValue, formatPercent, type ResultUnit } from "./format";
import type { HierarchyRow } from "./types";

interface RootRow {
  entityType: ScopeType;
  entityId: string;
  label: string;
  realizado: string;
}

interface HierarchyRowItemProps {
  entityType: ScopeType;
  entityId: string;
  label: string;
  realizado: string;
  percentDoTotal: string | null;
  percentDaHierarquia: string | null;
  rootTotal: string;
  resultTypeId: string;
  periodStart: string;
  realizadoAte: string;
  unit: ResultUnit | undefined;
  depth: number;
  hasChildren: boolean;
}

function HierarchyRowItem({
  entityType,
  entityId,
  label,
  realizado,
  percentDoTotal,
  percentDaHierarquia,
  rootTotal,
  resultTypeId,
  periodStart,
  realizadoAte,
  unit,
  depth,
  hasChildren,
}: HierarchyRowItemProps) {
  const [expanded, setExpanded] = useState(false);

  const {
    data: children,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["acompanhamento", "hierarquia-filhos", resultTypeId, periodStart, realizadoAte, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.post<HierarchyRow[]>("/acompanhamento/hierarquia/filhos", {
        resultTypeId,
        periodStart,
        realizadoAte,
        parent: { entityType, entityId },
        parentRealizado: realizado,
        rootTotal,
      });
      return data;
    },
    enabled: expanded && hasChildren,
  });

  return (
    <>
      <tr className="border-t border-border">
        <td className="whitespace-nowrap px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 16}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mr-1.5 text-muted-foreground hover:text-foreground"
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="mr-1.5 inline-block w-3" />
          )}
          {label}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right">{formatMetricValue(realizado, unit)}</td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right">{formatPercent(percentDoTotal)}</td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right">{formatPercent(percentDaHierarquia)}</td>
      </tr>

      {expanded && isLoading && (
        <tr className="border-t border-border">
          <td colSpan={4} className="px-3 py-1.5" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
            <LoadingState className="text-xs text-muted-foreground" />
          </td>
        </tr>
      )}

      {expanded && isError && (
        <tr className="border-t border-border">
          <td colSpan={4} className="px-3 py-1.5" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
            <ErrorState onRetry={() => refetch()} className="text-xs text-destructive" />
          </td>
        </tr>
      )}

      {expanded && children?.length === 0 && (
        <tr className="border-t border-border">
          <td colSpan={4} className="px-3 py-1.5 text-xs text-muted-foreground" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
            Nenhuma entidade abaixo deste nível.
          </td>
        </tr>
      )}

      {expanded &&
        children?.map((child) => (
          <HierarchyRowItem
            key={`${child.entityType}:${child.entityId}`}
            entityType={child.entityType}
            entityId={child.entityId}
            label={child.label}
            realizado={child.realizado}
            percentDoTotal={child.percentDoTotal}
            percentDaHierarquia={child.percentDaHierarquia}
            rootTotal={rootTotal}
            resultTypeId={resultTypeId}
            periodStart={periodStart}
            realizadoAte={realizadoAte}
            unit={unit}
            depth={depth + 1}
            hasChildren={child.hasChildren}
          />
        ))}
    </>
  );
}

// Raiz = entidades selecionadas no filtro principal; expande sob demanda
// (1 chamada por clique, sem pré-carregar a árvore inteira). % do Total é
// sempre relativo à soma das raízes (não recalculado a cada nível); % do Pai
// Imediato é sempre relativo ao pai direto (nunca à raiz).
export function HierarquiaTable({
  roots,
  resultTypeId,
  periodStart,
  realizadoAte,
  unit,
}: {
  roots: RootRow[];
  resultTypeId: string;
  periodStart: string;
  realizadoAte: string;
  unit: ResultUnit | undefined;
}) {
  if (roots.length === 0) {
    return <p className="text-xs text-muted-foreground">{SELECT_ENTITY_TEXT}</p>;
  }

  const rootTotal = roots.reduce((acc, root) => acc + Number(root.realizado), 0);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="whitespace-nowrap px-3 py-1.5">Entidade</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right">Realizado</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right">% do Total</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right">% do Pai Imediato</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((root) => (
            <HierarchyRowItem
              key={`${root.entityType}:${root.entityId}`}
              entityType={root.entityType}
              entityId={root.entityId}
              label={root.label}
              realizado={root.realizado}
              percentDoTotal={rootTotal > 0 ? String(Number(root.realizado) / rootTotal) : null}
              percentDaHierarquia={null}
              rootTotal={String(rootTotal)}
              resultTypeId={resultTypeId}
              periodStart={periodStart}
              realizadoAte={realizadoAte}
              unit={unit}
              depth={0}
              hasChildren={root.entityType !== "MEMBRO"}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
