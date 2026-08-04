import { useEffect, useState } from "react";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { useEntityOptions } from "./useEntityOptions";
import { useScopedEntityOptions, type ScopedOptionsMode } from "./useScopedEntityOptions";
import {
  EMPTY_HIERARCHY_FILTER,
  matchesHierarchyFilter,
  useHierarchyAncestorMaps,
  type HierarchyFilterValue,
} from "./HierarchyFilter";

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};
const ALL_LEVELS: ScopeType[] = ["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"];

// Seletor de UMA entidade (Empresa/Canal/Departamento/Time/Membro), livre e
// direto na Linha de Meta — sem pré-filtro de escopo da campanha. Primeiro
// escolhe o nível, depois a entidade daquele nível; o rótulo de cada opção
// mostra o caminho hierárquico completo (e o Cargo, no caso de Membro) para
// deixar claro a que hierarquia ela pertence.
//
// PASSO 9.1: prop `scoped` opcional — quando presente, troca a fonte de
// dados de `useEntityOptions` (empresa inteira, sem filtro — usado hoje por
// Sazonalidade/Agrupamento de Meta/Entidades Analisadas de Recebível, que
// devem CONTINUAR sem filtro) para `useScopedEntityOptions` (só o que o
// usuário lidera/vê/edita). Em modo escopado, o nível Empresa só aparece
// como opção quando o escopo é irrestrito (Admin ou atribuição EMPRESA).
export function EntityPicker({
  companyId,
  entityType,
  entityId,
  onChange,
  excludeEntityIds = [],
  disabled = false,
  scoped,
}: {
  companyId: string;
  entityType: ScopeType;
  entityId: string;
  onChange: (next: { entityType: ScopeType; entityId: string }) => void;
  excludeEntityIds?: string[];
  disabled?: boolean;
  scoped?: ScopedOptionsMode;
}) {
  const unscopedResult = useEntityOptions(companyId);
  const scopedResult = useScopedEntityOptions(companyId, scoped ?? "visible");
  const { options, isLoading, unrestricted } = scoped ? { ...scopedResult } : { ...unscopedResult, unrestricted: true };
  const [search, setSearch] = useState("");
  // Filtros extras, só usados quando entityType === "MEMBRO" — Canal/
  // Departamento/Time como tipos irmãos continuam sem eles, preservando o
  // comportamento atual desses níveis.
  const [cargoId, setCargoId] = useState<string | null>(null);
  const [hierarchyFilter, setHierarchyFilter] = useState<HierarchyFilterValue>(EMPTY_HIERARCHY_FILTER);
  const { teamById, departmentById } = useHierarchyAncestorMaps(options);

  // Trocar de nível (ex.: Membro → Time → Membro) limpa os filtros — sem
  // isto, um filtro de Cargo/Hierarquia escolhido antes ficaria "vazado"
  // e escondendo membros na volta, sem nenhuma indicação visual do porquê.
  useEffect(() => {
    setCargoId(null);
    setHierarchyFilter(EMPTY_HIERARCHY_FILTER);
  }, [entityType]);

  const normalizedSearch = search.trim().toLowerCase();
  const levelOrder = scoped && !unrestricted ? ALL_LEVELS.filter((level) => level !== "EMPRESA") : ALL_LEVELS;
  // Dedupe local dos Cargos presentes nas opções de Membro — não é uma
  // chamada nova a GET /cargos: a lista fica restrita a quem já aparece no
  // escopo atual, coerente com o resto do seletor.
  const cargoOptions = Array.from(
    new Map(
      options.MEMBRO.map((m) => m.cargo).filter((c): c is { id: string; name: string } => c != null).map((c) => [c.id, c]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const levelOptions = options[entityType]
    .filter((o) => !excludeEntityIds.includes(o.entityId))
    .filter((o) => entityType !== "MEMBRO" || !cargoId || o.cargo?.id === cargoId)
    .filter((o) => entityType !== "MEMBRO" || matchesHierarchyFilter(o, teamById, departmentById, hierarchyFilter))
    .filter(
      (o) =>
        !normalizedSearch ||
        o.label.toLowerCase().includes(normalizedSearch) ||
        o.breadcrumb?.toLowerCase().includes(normalizedSearch),
    );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">Entidade</label>
      <div className="flex flex-wrap gap-1">
        {levelOrder.map((level) => (
          <button
            key={level}
            type="button"
            disabled={disabled}
            // Empresa não tem um <select> próprio (é sempre 1 única opção, o
            // Tenant) — precisa preencher o entityId com o companyId aqui
            // mesmo, senão fica "" para sempre e nenhum botão que depende de
            // entityId (Calcular/Aplicar) libera.
            onClick={() => onChange({ entityType: level, entityId: level === "EMPRESA" ? companyId : "" })}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
              entityType === level
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-foreground hover:bg-secondary/50"
            }`}
          >
            {LEVEL_LABELS[level]}
          </button>
        ))}
      </div>

      {entityType === "EMPRESA" ? (
        <p className="rounded-md border border-input bg-secondary/30 px-2 py-1 text-sm text-foreground">Empresa (Geral)</p>
      ) : (
        <>
          {/* Filtros extras só fazem sentido para Membro: Canal/Departamento/
              Time já SÃO a hierarquia, filtrar por hierarquia sobre eles não
              teria efeito distinto do próprio nível selecionado. */}
          {entityType === "MEMBRO" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Filtrar por</label>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="entity-picker-cargo">
                    Cargo
                  </label>
                  <select
                    id="entity-picker-cargo"
                    value={cargoId ?? ""}
                    onChange={(event) => setCargoId(event.target.value || null)}
                    disabled={disabled || isLoading}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Todos</option>
                    {cargoOptions.map((cargo) => (
                      <option key={cargo.id} value={cargo.id}>
                        {cargo.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Cascata Canal→Departamento→Time montada sobre os MESMOS
                    `options` já carregados acima (useEntityOptions ou
                    useScopedEntityOptions, conforme a prop `scoped`) — não
                    o componente <HierarchyFilter/>, que busca sua própria
                    fonte sempre escopada. Usar aquele aqui quebraria o
                    consumidor não-escopado (AnalyzedEntitiesModal): o
                    filtro filtraria contra uma árvore diferente da que
                    preenche a lista de Membros exibida. */}
                {(["CANAL", "DEPARTAMENTO", "TIME"] as const).map((level) => {
                  const fieldKey = level === "CANAL" ? "channelId" : level === "DEPARTAMENTO" ? "departmentId" : "teamId";
                  const levelOptionsForFilter = options[level].filter((o) => {
                    if (level === "DEPARTAMENTO") return !hierarchyFilter.channelId || o.parentId === hierarchyFilter.channelId;
                    if (level === "TIME") return !hierarchyFilter.departmentId || o.parentId === hierarchyFilter.departmentId;
                    return true;
                  });
                  return (
                    <div key={level} className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`entity-picker-hierarquia-${level}`}>
                        {LEVEL_LABELS[level]}
                      </label>
                      <select
                        id={`entity-picker-hierarquia-${level}`}
                        value={hierarchyFilter[fieldKey] ?? ""}
                        onChange={(event) => {
                          const next = event.target.value || null;
                          // Escolher um nível de cima reseta os de baixo —
                          // igual à cascata do HierarchyFilter original.
                          setHierarchyFilter(
                            level === "CANAL"
                              ? { channelId: next, departmentId: null, teamId: null }
                              : level === "DEPARTAMENTO"
                                ? { ...hierarchyFilter, departmentId: next, teamId: null }
                                : { ...hierarchyFilter, teamId: next },
                          );
                        }}
                        disabled={disabled || isLoading}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                      >
                        <option value="">Todos</option>
                        {levelOptionsForFilter.map((o) => (
                          <option key={o.entityId} value={o.entityId}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {(hierarchyFilter.channelId || hierarchyFilter.departmentId || hierarchyFilter.teamId || cargoId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCargoId(null);
                      setHierarchyFilter(EMPTY_HIERARCHY_FILTER);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Limpar filtro
                  </button>
                )}
              </div>
            </div>
          )}

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={disabled || isLoading}
            placeholder="Buscar por nome..."
            className="w-full max-w-md rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
          <select
            disabled={disabled || isLoading}
            value={entityId}
            onChange={(event) => onChange({ entityType, entityId: event.target.value })}
            className="w-full max-w-md rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          >
            <option value="">Selecione...</option>
            {levelOptions.map((option) => (
              <option key={option.entityId} value={option.entityId}>
                {option.label}
                {option.breadcrumb ? ` (${option.breadcrumb})` : ""}
              </option>
            ))}
          </select>
          {normalizedSearch && levelOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma entidade encontrada para "{search}".</p>
          )}
        </>
      )}
    </div>
  );
}
