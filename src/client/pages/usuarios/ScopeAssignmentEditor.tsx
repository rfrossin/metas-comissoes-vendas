import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { useEntityOptions } from "@/pages/metas/useEntityOptions";
import { ACCESS_LEVEL_LABELS, type AccessLevel } from "./types";

const LEVEL_LABELS: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};
const LEVEL_ORDER: ScopeType[] = ["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME", "MEMBRO"];

export interface DraftAssignment {
  scopeType: ScopeType;
  scopeId: string | null;
  accessLevel: AccessLevel;
}

// Editor de MÚLTIPLAS atribuições heterogêneas (várias hierarquias/Membros
// simultâneos, em níveis diferentes) — diferente do EntityPicker (1 entidade
// só) e do EntityMultiPicker (várias entidades, mas 1 nível só por vez).
// Reaproveita useEntityOptions como fonte de dados.
//
// Quando `forcedAccessLevel` é passado (editando um Gestor), o seletor de
// nível de acesso some — toda atribuição de Gestor é EDITAR, sempre (o
// backend também força isso na gravação, isto aqui é só refletir a regra na
// UI).
export function ScopeAssignmentEditor({
  companyId,
  assignments,
  onChange,
  forcedAccessLevel,
}: {
  companyId: string;
  assignments: DraftAssignment[];
  onChange: (next: DraftAssignment[]) => void;
  forcedAccessLevel?: AccessLevel;
}) {
  const { options, isLoading } = useEntityOptions(companyId);

  function updateRow(index: number, patch: Partial<DraftAssignment>) {
    onChange(assignments.map((assignment, i) => (i === index ? { ...assignment, ...patch } : assignment)));
  }

  function removeRow(index: number) {
    onChange(assignments.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...assignments, { scopeType: "TIME", scopeId: null, accessLevel: forcedAccessLevel ?? "VISUALIZAR" }]);
  }

  const keyOf = (assignment: DraftAssignment) => `${assignment.scopeType}:${assignment.scopeId ?? ""}`;
  const occurrences = new Map<string, number>();
  for (const assignment of assignments) {
    const key = keyOf(assignment);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-2">
      {assignments.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhuma hierarquia/Membro atribuído ainda — sem atribuição, este usuário não vê nem edita nenhum dado.</p>
      )}

      {assignments.map((assignment, index) => {
        const isDuplicate = (occurrences.get(keyOf(assignment)) ?? 0) > 1;
        const levelOptions = assignment.scopeType === "EMPRESA" ? [] : options[assignment.scopeType];

        return (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
            <select
              value={assignment.scopeType}
              onChange={(event) => {
                const scopeType = event.target.value as ScopeType;
                updateRow(index, { scopeType, scopeId: null });
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              {LEVEL_ORDER.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </select>

            {assignment.scopeType === "EMPRESA" ? (
              <span className="min-w-[16rem] flex-1 rounded-md border border-input bg-secondary/30 px-2 py-1 text-sm text-foreground">
                Empresa (Geral)
              </span>
            ) : (
              <select
                disabled={isLoading}
                value={assignment.scopeId ?? ""}
                onChange={(event) => updateRow(index, { scopeId: event.target.value || null })}
                className="min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
              >
                <option value="">Selecione...</option>
                {levelOptions.map((option) => (
                  <option key={option.entityId} value={option.entityId}>
                    {option.label}
                    {option.breadcrumb ? ` (${option.breadcrumb})` : ""}
                  </option>
                ))}
              </select>
            )}

            {forcedAccessLevel ? (
              <span className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                {ACCESS_LEVEL_LABELS[forcedAccessLevel]}
              </span>
            ) : (
              <select
                value={assignment.accessLevel}
                onChange={(event) => updateRow(index, { accessLevel: event.target.value as AccessLevel })}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              >
                <option value="VISUALIZAR">{ACCESS_LEVEL_LABELS.VISUALIZAR}</option>
                <option value="EDITAR">{ACCESS_LEVEL_LABELS.EDITAR}</option>
              </select>
            )}

            <button
              type="button"
              onClick={() => removeRow(index)}
              className="ml-auto text-xs text-destructive hover:underline"
            >
              Remover
            </button>

            {isDuplicate && (
              <p className="w-full text-xs text-destructive">Esta hierarquia/Membro já foi atribuído em outra linha acima.</p>
            )}
            {assignment.scopeType !== "EMPRESA" && !assignment.scopeId && (
              <p className="w-full text-xs text-muted-foreground">Selecione a entidade para esta linha.</p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50"
      >
        + Adicionar atribuição
      </button>
    </div>
  );
}
