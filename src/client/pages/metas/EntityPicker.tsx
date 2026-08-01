import { useState } from "react";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { useEntityOptions } from "./useEntityOptions";
import { useScopedEntityOptions, type ScopedOptionsMode } from "./useScopedEntityOptions";

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
  const normalizedSearch = search.trim().toLowerCase();
  const levelOrder = scoped && !unrestricted ? ALL_LEVELS.filter((level) => level !== "EMPRESA") : ALL_LEVELS;
  const levelOptions = options[entityType]
    .filter((o) => !excludeEntityIds.includes(o.entityId))
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
