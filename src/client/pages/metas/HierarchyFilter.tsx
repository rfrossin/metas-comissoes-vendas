import { useMemo } from "react";
import { useScopedEntityOptions, type ScopedOptionsMode } from "./useScopedEntityOptions";
import type { EntityOption } from "./useEntityOptions";

export interface HierarchyFilterValue {
  channelId: string | null;
  departmentId: string | null;
  teamId: string | null;
}

export const EMPTY_HIERARCHY_FILTER: HierarchyFilterValue = { channelId: null, departmentId: null, teamId: null };

// Canal→Departamento→Time em cascata, cada nível opcional ("Todos") — para
// achar um Membro em listas grandes (Resultados: Lançamento por Membro e
// Todos os Resultados, PASSO 9.5). Não filtra nada sozinho — só produz o
// HierarchyFilterValue; a tela consumidora aplica `matchesHierarchyFilter`
// sobre a lista de Membros que já tem (ou envia como filtro pro backend).
export function HierarchyFilter({
  companyId,
  scoped,
  value,
  onChange,
}: {
  companyId: string;
  scoped: ScopedOptionsMode;
  value: HierarchyFilterValue;
  onChange: (next: HierarchyFilterValue) => void;
}) {
  const { options, isLoading } = useScopedEntityOptions(companyId, scoped);

  const departmentOptions = options.DEPARTAMENTO.filter((d) => !value.channelId || d.parentId === value.channelId);
  const departmentIdsInChannel = useMemo(
    () => new Set(departmentOptions.map((d) => d.entityId)),
    [departmentOptions],
  );
  const teamOptions = options.TIME.filter((t) => {
    if (value.departmentId) return t.parentId === value.departmentId;
    if (value.channelId) return t.parentId != null && departmentIdsInChannel.has(t.parentId);
    return true;
  });

  const hasFilter = Boolean(value.channelId || value.departmentId || value.teamId);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="hierarchy-filter-canal">
          Canal
        </label>
        <select
          id="hierarchy-filter-canal"
          value={value.channelId ?? ""}
          onChange={(event) => onChange({ channelId: event.target.value || null, departmentId: null, teamId: null })}
          disabled={isLoading}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">Todos</option>
          {options.CANAL.map((c) => (
            <option key={c.entityId} value={c.entityId}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="hierarchy-filter-departamento">
          Departamento
        </label>
        <select
          id="hierarchy-filter-departamento"
          value={value.departmentId ?? ""}
          onChange={(event) => onChange({ ...value, departmentId: event.target.value || null, teamId: null })}
          disabled={isLoading}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">Todos</option>
          {departmentOptions.map((d) => (
            <option key={d.entityId} value={d.entityId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="hierarchy-filter-time">
          Time
        </label>
        <select
          id="hierarchy-filter-time"
          value={value.teamId ?? ""}
          onChange={(event) => onChange({ ...value, teamId: event.target.value || null })}
          disabled={isLoading}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">Todos</option>
          {teamOptions.map((t) => (
            <option key={t.entityId} value={t.entityId}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {hasFilter && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_HIERARCHY_FILTER)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Limpar filtro
        </button>
      )}
    </div>
  );
}

// Reaproveitado pelas telas que já têm a lista de Membros (EntityOption,
// entityType MEMBRO) vinda de `useScopedEntityOptions`/`useEntityOptions` e
// só precisam aplicar o HierarchyFilterValue localmente, sem round-trip
// novo ao servidor — mesma subida de ancestralidade (Membro→Time→
// Departamento→Canal via `parentId`) já usada por `isMemberInScope`/
// `resolveMemberLevelEntity` em `useEntityOptions.ts`, aqui reaproveitada
// com `teamById`/`departmentById` em vez de reconstruir a árvore aninhada.
export function matchesHierarchyFilter(
  member: EntityOption,
  teamById: Map<string, EntityOption>,
  departmentById: Map<string, EntityOption>,
  filter: HierarchyFilterValue,
): boolean {
  if (!filter.channelId && !filter.departmentId && !filter.teamId) return true;
  if (!member.parentId) return false;
  if (filter.teamId) return member.parentId === filter.teamId;

  const team = teamById.get(member.parentId);
  if (!team?.parentId) return false;
  if (filter.departmentId) return team.parentId === filter.departmentId;

  const department = departmentById.get(team.parentId);
  if (!department?.parentId) return false;
  if (filter.channelId) return department.parentId === filter.channelId;
  return true;
}

// Monta os mapas entityId→EntityOption de TIME/DEPARTAMENTO necessários
// pra `matchesHierarchyFilter` subir a ancestralidade de um Membro.
export function useHierarchyAncestorMaps(options: Record<"TIME" | "DEPARTAMENTO", EntityOption[]>) {
  const teamById = useMemo(() => new Map(options.TIME.map((t) => [t.entityId, t])), [options.TIME]);
  const departmentById = useMemo(() => new Map(options.DEPARTAMENTO.map((d) => [d.entityId, d])), [options.DEPARTAMENTO]);
  return { teamById, departmentById };
}
