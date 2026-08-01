import { useMemo, useState } from "react";
import { useAuthStore } from "@/store/auth.store";
import { useScopedEntityOptions } from "@/pages/metas/useScopedEntityOptions";
import { EMPTY_HIERARCHY_FILTER, HierarchyFilter, matchesHierarchyFilter, useHierarchyAncestorMaps } from "@/pages/metas/HierarchyFilter";
import { LaunchEntryForm } from "./LaunchEntryForm";
import { HistoryTable } from "./HistoryTable";

// PASSO 9.5: o seletor de Membro só mostra quem o usuário pode de fato
// lançar Resultado (modo "results" — equivalente a
// resolveResultsEditableMemberFilter, o mesmo filtro que o servidor já usa
// pra validar o lançamento), em vez da empresa inteira. Filtro de
// hierarquia acima ajuda a achar o Membro em listas grandes.
export function LaunchSection() {
  const companyId = useAuthStore((state) => state.user!.companyId);
  const [memberId, setMemberId] = useState("");
  const [hierarchyFilter, setHierarchyFilter] = useState(EMPTY_HIERARCHY_FILTER);

  const { options, isLoading } = useScopedEntityOptions(companyId, "results");
  const { teamById, departmentById } = useHierarchyAncestorMaps(options);
  const members = useMemo(
    () => options.MEMBRO.filter((member) => matchesHierarchyFilter(member, teamById, departmentById, hierarchyFilter)),
    [options.MEMBRO, teamById, departmentById, hierarchyFilter],
  );

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Lançamento por Membro</h2>
        <p className="text-xs text-muted-foreground">
          Selecione um membro para lançar Resultados e Deságios. O Resumo de Realizado Líquido está em "Todos os Resultados".
        </p>
      </div>

      <HierarchyFilter companyId={companyId} scoped="results" value={hierarchyFilter} onChange={setHierarchyFilter} />

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="member-select">
          Membro
        </label>
        <select
          id="member-select"
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          disabled={isLoading}
          className="max-w-sm rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">Selecione um membro...</option>
          {members.map((member) => (
            <option key={member.entityId} value={member.entityId}>
              {member.label}
              {member.breadcrumb ? ` — ${member.breadcrumb}` : ""}
            </option>
          ))}
        </select>
        {!isLoading && members.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhum Membro disponível para lançamento.</p>
        )}
      </div>

      {memberId && (
        <div className="space-y-4">
          <LaunchEntryForm memberId={memberId} />

          <HistoryTable memberId={memberId} />
        </div>
      )}
    </div>
  );
}
