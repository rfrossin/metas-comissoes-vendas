import { useEntityOptions } from "@/pages/metas/useEntityOptions";
import { useScopedEntityOptions, type ScopedOptionsMode } from "@/pages/metas/useScopedEntityOptions";
import type { LeadershipTarget } from "./MemberForm";

type LeadershipLevel = LeadershipTarget["nodeType"];

const LEVEL_LABELS: Record<LeadershipLevel, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
};
const ALL_LEVELS: LeadershipLevel[] = ["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME"];

function targetId(target: LeadershipTarget): string | null {
  if (target.nodeType === "EMPRESA") return null;
  if (target.nodeType === "CANAL") return target.channelId;
  if (target.nodeType === "DEPARTAMENTO") return target.departmentId;
  return target.teamId;
}

function buildTarget(nodeType: LeadershipLevel, id: string): LeadershipTarget {
  switch (nodeType) {
    case "EMPRESA":
      return { nodeType: "EMPRESA" };
    case "CANAL":
      return { nodeType: "CANAL", channelId: id };
    case "DEPARTAMENTO":
      return { nodeType: "DEPARTAMENTO", departmentId: id };
    case "TIME":
      return { nodeType: "TIME", teamId: id };
  }
}

// Editor de MÚLTIPLAS lideranças (hierarquias que um Membro Tipo GESTOR
// lidera) — mesmo idioma de ScopeAssignmentEditor (nível + entidade, várias
// linhas repetíveis), mas sem coluna de nível de acesso: liderar não tem
// VISUALIZAR/EDITAR, é binário (lidera ou não lidera aquele nó).
//
// PASSO 9.1: prop `scoped` opcional (ver EntityPicker.tsx para o mesmo
// racional) — usado pela aba Membros (PASSO 9.4) pra restringir as
// hierarquias oferecidas ao que o Gestor que está criando/editando o
// Membro lidera (modo "led"; Admin continua vendo tudo, "led" já devolve
// irrestrito pra ele).
export function LeadershipEditor({
  companyId,
  leaderships,
  onChange,
  scoped,
}: {
  companyId: string;
  leaderships: LeadershipTarget[];
  onChange: (next: LeadershipTarget[]) => void;
  scoped?: ScopedOptionsMode;
}) {
  const unscopedResult = useEntityOptions(companyId);
  const scopedResult = useScopedEntityOptions(companyId, scoped ?? "led");
  const { options, isLoading, unrestricted } = scoped ? { ...scopedResult } : { ...unscopedResult, unrestricted: true };
  const levelOrder = scoped && !unrestricted ? ALL_LEVELS.filter((level) => level !== "EMPRESA") : ALL_LEVELS;

  function updateLevel(index: number, nodeType: LeadershipLevel) {
    onChange(leaderships.map((target, i) => (i === index ? buildTarget(nodeType, "") : target)));
  }

  function updateId(index: number, id: string) {
    onChange(leaderships.map((target, i) => (i === index ? buildTarget(target.nodeType, id) : target)));
  }

  function removeRow(index: number) {
    onChange(leaderships.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...leaderships, { nodeType: "TIME", teamId: "" }]);
  }

  const keyOf = (target: LeadershipTarget) => `${target.nodeType}:${targetId(target) ?? ""}`;
  const occurrences = new Map<string, number>();
  for (const target of leaderships) {
    const key = keyOf(target);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-2">
      {leaderships.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhuma liderança atribuída ainda.</p>
      )}

      {leaderships.map((target, index) => {
        const isDuplicate = (occurrences.get(keyOf(target)) ?? 0) > 1;
        const levelOptions = target.nodeType === "EMPRESA" ? [] : options[target.nodeType];

        return (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
            <select
              value={target.nodeType}
              onChange={(event) => updateLevel(index, event.target.value as LeadershipLevel)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              {levelOrder.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </select>

            {target.nodeType === "EMPRESA" ? (
              <span className="min-w-[16rem] flex-1 rounded-md border border-input bg-secondary/30 px-2 py-1 text-sm text-foreground">
                Empresa (Geral)
              </span>
            ) : (
              <select
                disabled={isLoading}
                value={targetId(target) ?? ""}
                onChange={(event) => updateId(index, event.target.value)}
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

            <button
              type="button"
              onClick={() => removeRow(index)}
              className="ml-auto text-xs text-destructive hover:underline"
            >
              Remover
            </button>

            {isDuplicate && (
              <p className="w-full text-xs text-destructive">Esta hierarquia já foi atribuída em outra linha acima.</p>
            )}
            {target.nodeType !== "EMPRESA" && !targetId(target) && (
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
        + Adicionar liderança
      </button>
    </div>
  );
}
