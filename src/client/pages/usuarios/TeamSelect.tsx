import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useScopedEntityOptions, type ScopedOptionsMode } from "@/pages/metas/useScopedEntityOptions";

interface OrgTree {
  channels: {
    name: string;
    departments: {
      name: string;
      teams: { id: string; name: string }[];
    }[];
  }[];
}

interface TeamOption {
  id: string;
  label: string;
}

// PASSO 9.1: prop `scoped` opcional (ver EntityPicker.tsx para o mesmo
// racional) — quando presente, `companyId` passa a ser obrigatório e a
// lista de Times vem de `useScopedEntityOptions` em vez da árvore inteira
// da empresa. Modo padrão (sem `scoped`) preserva o comportamento atual.
export function TeamSelect({
  value,
  onChange,
  companyId,
  scoped,
}: {
  value: string;
  onChange: (teamId: string) => void;
  companyId?: string;
  scoped?: ScopedOptionsMode;
}) {
  const { data: tree } = useQuery({
    queryKey: ["org-tree"],
    queryFn: async () => {
      const { data } = await api.get<OrgTree>("/estrutura-organizacional/tree");
      return data;
    },
    enabled: !scoped,
  });

  const scopedResult = useScopedEntityOptions(companyId ?? "", scoped ?? "led");

  const unscopedOptions = useMemo<TeamOption[]>(() => {
    if (!tree) return [];
    return tree.channels.flatMap((channel) =>
      channel.departments.flatMap((department) =>
        department.teams.map((team) => ({
          id: team.id,
          label: `${channel.name} / ${department.name} / ${team.name}`,
        })),
      ),
    );
  }, [tree]);

  const options: TeamOption[] = scoped
    ? scopedResult.options.TIME.map((option) => ({ id: option.entityId, label: `${option.breadcrumb} > ${option.label}` }))
    : unscopedOptions;

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
    >
      <option value="">Selecione o Time...</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
