import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

export const LEVEL_LABEL: Record<ScopeType, string> = {
  EMPRESA: "Empresa",
  CANAL: "Canal",
  DEPARTAMENTO: "Departamento",
  TIME: "Time",
  MEMBRO: "Membro",
};

// hierarchyPath vem do backend como "ancestral imediato → topo" (ex.:
// "Hospitalar>Atacado" para um Time — mesmo formato usado em Metas/
// Fechamento). O formato de exibição em Bases de Recebível é o inverso, com
// o nome da própria Entidade e seu nível no final: "Atacado>Hospitalar>São
// Paulo (Time)".
export function formatFullHierarchy(hierarchyPath: string | null, entityType: ScopeType, entityName: string): string {
  const own = `${entityName} (${LEVEL_LABEL[entityType]})`;
  if (!hierarchyPath) return own;
  return [...hierarchyPath.split(">").reverse(), own].join(">");
}
