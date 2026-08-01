import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { useEntityOptions } from "@/pages/metas/useEntityOptions";
import { useScopedEntityOptions, type ScopedOptionsMode } from "@/pages/metas/useScopedEntityOptions";

const ALL_LEVELS: ScopeType[] = ["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"];
const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

// Seleção em cascata: o usuário escolhe UM nível (Empresa/Canal/Departamento/
// Time/Membro) e, dentro dele, uma ou mais entidades — nunca mistura níveis.
// Trocar de nível limpa a seleção anterior. Reaproveita useEntityOptions
// (mesma fonte de dados do EntityPicker de Metas, que é single-select) sem
// tocar naquele componente.
//
// PASSO 9.1: prop `scoped` opcional (ver EntityPicker.tsx para o mesmo
// racional) — usado por Acompanhamento/Recebíveis/Fechamento pra restringir
// a seleção ao que o usuário tem permissão de ver/editar.
export function EntityMultiPicker({
  companyId,
  entityType,
  entityIds,
  onChange,
  scoped,
}: {
  companyId: string;
  entityType: ScopeType;
  entityIds: string[];
  onChange: (next: { entityType: ScopeType; entityIds: string[] }) => void;
  scoped?: ScopedOptionsMode;
}) {
  const unscopedResult = useEntityOptions(companyId);
  const scopedResult = useScopedEntityOptions(companyId, scoped ?? "visible");
  const { options, isLoading, unrestricted } = scoped ? { ...scopedResult } : { ...unscopedResult, unrestricted: true };
  const levelOptions = options[entityType];
  const levelOrder = scoped && !unrestricted ? ALL_LEVELS.filter((level) => level !== "EMPRESA") : ALL_LEVELS;

  function selectLevel(level: ScopeType) {
    if (level === entityType) return;
    onChange({ entityType: level, entityIds: level === "EMPRESA" ? [companyId] : [] });
  }

  function toggle(id: string) {
    if (entityIds.includes(id)) {
      onChange({ entityType, entityIds: entityIds.filter((existing) => existing !== id) });
    } else {
      onChange({ entityType, entityIds: [...entityIds, id] });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {levelOrder.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => selectLevel(level)}
            className={`rounded-md border px-2 py-1 text-xs ${
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
        <p className="rounded-md border border-input bg-secondary/30 px-2 py-1 text-sm text-foreground">Empresa Inteira</p>
      ) : (
        <div className="max-h-56 w-full max-w-md overflow-y-auto rounded-md border border-input bg-background p-1.5">
          {isLoading && <p className="px-1 py-0.5 text-xs text-muted-foreground">Carregando dados...</p>}
          {!isLoading && levelOptions.length === 0 && (
            <p className="px-1 py-0.5 text-xs text-muted-foreground">Nenhuma entidade disponível neste nível.</p>
          )}
          {levelOptions.map((option) => (
            <label
              key={option.entityId}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-secondary/50"
            >
              <input type="checkbox" checked={entityIds.includes(option.entityId)} onChange={() => toggle(option.entityId)} />
              <span>
                {option.label}
                {option.breadcrumb && <span className="ml-1 text-muted-foreground">({option.breadcrumb})</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
