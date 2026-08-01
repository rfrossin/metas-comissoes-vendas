import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";

export type ScopeType = "EMPRESA" | "CANAL" | "DEPARTAMENTO" | "TIME" | "MEMBRO";

interface Team {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
  teams: Team[];
}

interface Channel {
  id: string;
  name: string;
  departments: Department[];
}

interface OrgTree {
  channels: Channel[];
}

interface MemberOption {
  id: string;
  fullName: string;
}

interface ScopeSelectorProps {
  scopeType: ScopeType;
  scopeId: string | null;
  onScopeTypeChange: (type: ScopeType) => void;
  onScopeIdChange: (id: string | null) => void;
}

export function ScopeSelector({
  scopeType,
  scopeId,
  onScopeTypeChange,
  onScopeIdChange,
}: ScopeSelectorProps) {
  const { data: tree } = useQuery({
    queryKey: ["org-tree"],
    queryFn: async () => {
      const { data } = await api.get<OrgTree>("/estrutura-organizacional/tree");
      return data;
    },
    enabled: scopeType === "CANAL" || scopeType === "DEPARTAMENTO" || scopeType === "TIME",
  });

  const { data: members } = useQuery({
    queryKey: ["all-members"],
    queryFn: async () => {
      const { data } = await api.get<MemberOption[]>("/estrutura-organizacional/members/all");
      return data;
    },
    enabled: scopeType === "MEMBRO",
  });

  const orgOptions = useMemo(() => {
    if (!tree) {
      return [];
    }

    if (scopeType === "CANAL") {
      return tree.channels.map((channel) => ({ id: channel.id, label: channel.name }));
    }

    if (scopeType === "DEPARTAMENTO") {
      return tree.channels.flatMap((channel) =>
        channel.departments.map((department) => ({
          id: department.id,
          label: `${department.name} (${channel.name})`,
        })),
      );
    }

    if (scopeType === "TIME") {
      return tree.channels.flatMap((channel) =>
        channel.departments.flatMap((department) =>
          department.teams.map((team) => ({
            id: team.id,
            label: `${team.name} (${department.name})`,
          })),
        ),
      );
    }

    return [];
  }, [tree, scopeType]);

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Escopo</label>
        <select
          value={scopeType}
          onChange={(event) => {
            onScopeTypeChange(event.target.value as ScopeType);
            onScopeIdChange(null);
          }}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="EMPRESA">Geral (Empresa)</option>
          <option value="CANAL">Canal</option>
          <option value="DEPARTAMENTO">Departamento</option>
          <option value="TIME">Time</option>
          <option value="MEMBRO">Membro</option>
        </select>
      </div>

      {scopeType !== "EMPRESA" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Entidade</label>
          <select
            value={scopeId ?? ""}
            onChange={(event) => onScopeIdChange(event.target.value || null)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Selecione...</option>
            {scopeType === "MEMBRO"
              ? members?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))
              : orgOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
          </select>
        </div>
      )}
    </div>
  );
}
