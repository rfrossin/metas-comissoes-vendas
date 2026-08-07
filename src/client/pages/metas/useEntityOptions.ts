import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";

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

export interface NodeResponsibleRef {
  nodeType: "EMPRESA" | "CANAL" | "DEPARTAMENTO" | "TIME";
  channelId: string | null;
  departmentId: string | null;
  teamId: string | null;
}

interface MemberOption {
  id: string;
  fullName: string;
  cargo: { id: string; name: string } | null;
  team: { id: string; name: string; department: { id: string; name: string; channel: { id: string; name: string } } } | null;
  nodeResponsibleFor: NodeResponsibleRef[];
}

export interface EntityOption {
  entityType: ScopeType;
  entityId: string;
  label: string;
  // Caminho hierárquico completo (Canal > Departamento > Time > Cargo) —
  // essencial para o gestor saber a que hierarquia a entidade pertence ao
  // selecioná-la, sobretudo quando há nomes duplicados em ramos diferentes.
  breadcrumb: string | null;
  // Id bruto do nó-pai imediato (Canal de um Departamento, Departamento de
  // um Time, Time de um Membro) — usado para filtros em cascata sem
  // depender de comparação de texto no breadcrumb. null para Canal/Empresa
  // (topo) e Membro do Time Gestão (sem Time).
  parentId: string | null;
  // Só preenchido para MEMBRO: nós dos quais este Membro é Líder
  // (NodeResponsible) — um Coordenador/Gerente/Diretor/Presidente do Time
  // Gestão não tem parentId (sem Time), mas ainda deve aparecer nos filtros
  // em cascata de Canal/Departamento/Time que ele lidera. Todo filtro de
  // Membros por hierarquia no client deve considerar esta lista além do
  // parentId estrutural.
  nodeResponsibleFor?: NodeResponsibleRef[];
  // Só preenchido para MEMBRO — usado para filtro/resumo por Cargo.
  cargo?: { id: string; name: string } | null;
}

// Fonte única das entidades selecionáveis diretamente numa Linha de Meta
// (Empresa/Canal/Departamento/Time/Membro) — substitui o antigo pré-filtro
// de Escopo da Campanha (GoalScopeEntity): a seleção agora é livre e
// acontece inline, na própria Linha.
export function useEntityOptions(companyId: string) {
  const { data: tree, isLoading: isLoadingTree } = useQuery({
    queryKey: ["org-tree"],
    queryFn: async () => {
      const { data } = await api.get<OrgTree>("/estrutura-organizacional/tree");
      return data;
    },
  });

  const { data: members, isLoading: isLoadingMembers } = useQuery({
    queryKey: ["all-members"],
    queryFn: async () => {
      const { data } = await api.get<MemberOption[]>("/estrutura-organizacional/members/all");
      return data;
    },
  });

  const options = useMemo<Record<ScopeType, EntityOption[]>>(() => {
    const empresa: EntityOption[] = [
      { entityType: "EMPRESA", entityId: companyId, label: "Empresa (Geral)", breadcrumb: null, parentId: null },
    ];

    const canal: EntityOption[] = (tree?.channels ?? []).map((c) => ({
      entityType: "CANAL",
      entityId: c.id,
      label: c.name,
      breadcrumb: null,
      parentId: null,
    }));

    const departamento: EntityOption[] = (tree?.channels ?? []).flatMap((c) =>
      c.departments.map((d) => ({
        entityType: "DEPARTAMENTO" as const,
        entityId: d.id,
        label: d.name,
        breadcrumb: `Canal: ${c.name}`,
        parentId: c.id,
      })),
    );

    const time: EntityOption[] = (tree?.channels ?? []).flatMap((c) =>
      c.departments.flatMap((d) =>
        d.teams.map((t) => ({
          entityType: "TIME" as const,
          entityId: t.id,
          label: t.name,
          breadcrumb: `Canal: ${c.name} > Departamento: ${d.name}`,
          parentId: d.id,
        })),
      ),
    );

    // Caminho PARCIAL do líder (Membro sem Time): ele não pertence a um nó,
    // lidera um — Líder de Time aparece em Canal>Departamento>Time, de
    // Departamento em Canal>Departamento, de Canal só no Canal. Mesmo
    // critério de resolveAncestorIds no backend. Os nomes saem da árvore já
    // carregada acima.
    const teamPathById = new Map<string, string[]>();
    const departmentPathById = new Map<string, string[]>();
    const channelPathById = new Map<string, string[]>();
    for (const c of tree?.channels ?? []) {
      channelPathById.set(c.id, [`Canal: ${c.name}`]);
      for (const d of c.departments) {
        departmentPathById.set(d.id, [`Canal: ${c.name}`, `Departamento: ${d.name}`]);
        for (const t of d.teams) {
          teamPathById.set(t.id, [`Canal: ${c.name}`, `Departamento: ${d.name}`, `Time: ${t.name}`]);
        }
      }
    }

    function leadershipParts(refs: NodeResponsibleRef[]): string[] {
      const teamRef = refs.find((r) => r.nodeType === "TIME" && r.teamId);
      if (teamRef?.teamId && teamPathById.has(teamRef.teamId)) return teamPathById.get(teamRef.teamId)!;

      const departmentRef = refs.find((r) => r.nodeType === "DEPARTAMENTO" && r.departmentId);
      if (departmentRef?.departmentId && departmentPathById.has(departmentRef.departmentId)) {
        return departmentPathById.get(departmentRef.departmentId)!;
      }

      const channelRef = refs.find((r) => r.nodeType === "CANAL" && r.channelId);
      if (channelRef?.channelId && channelPathById.has(channelRef.channelId)) return channelPathById.get(channelRef.channelId)!;

      if (refs.some((r) => r.nodeType === "EMPRESA")) return ["Empresa"];

      return [];
    }

    const membro: EntityOption[] = (members ?? []).map((m) => {
      const parts: string[] = [];
      if (m.team) {
        parts.push(`Canal: ${m.team.department.channel.name}`);
        parts.push(`Departamento: ${m.team.department.name}`);
        parts.push(`Time: ${m.team.name}`);
      } else {
        const led = leadershipParts(m.nodeResponsibleFor);
        parts.push(...(led.length > 0 ? led : ["Time Gestão"]));
      }
      parts.push(`Cargo: ${m.cargo?.name ?? "—"}`);

      return {
        entityType: "MEMBRO" as const,
        entityId: m.id,
        label: m.fullName,
        breadcrumb: parts.join(" > "),
        parentId: m.team?.id ?? null,
        nodeResponsibleFor: m.nodeResponsibleFor,
        cargo: m.cargo,
      };
    });

    return { EMPRESA: empresa, CANAL: canal, DEPARTAMENTO: departamento, TIME: time, MEMBRO: membro };
  }, [tree, members, companyId]);

  const allOptions = useMemo<EntityOption[]>(
    () => [...options.EMPRESA, ...options.CANAL, ...options.DEPARTAMENTO, ...options.TIME, ...options.MEMBRO],
    [options],
  );

  return { options, allOptions, isLoading: isLoadingTree || isLoadingMembers };
}

// Todo filtro de Membros por Canal/Departamento/Time no client deve usar
// esta função (em vez de reimplementar) — inclui tanto quem pertence
// estruturalmente (via parentId, subindo Time→Departamento→Canal) quanto
// quem é Líder de Nó (NodeResponsible) do próprio escopo ou de qualquer nó
// abaixo dele, mesmo sem estar estruturalmente dentro da hierarquia (ex:
// Time Gestão). Mesma semântica de buildMemberScopeFilter no backend.
export function isMemberInScope(
  member: EntityOption,
  teamById: Map<string, EntityOption>,
  departmentById: Map<string, EntityOption>,
  scopeType: "CANAL" | "DEPARTAMENTO" | "TIME",
  scopeId: string,
): boolean {
  const team = member.parentId ? teamById.get(member.parentId) : null;

  if (scopeType === "TIME") {
    if (member.parentId === scopeId) return true;
    return (member.nodeResponsibleFor ?? []).some((node) => node.nodeType === "TIME" && node.teamId === scopeId);
  }

  if (scopeType === "DEPARTAMENTO") {
    if (team?.parentId === scopeId) return true;
    return (member.nodeResponsibleFor ?? []).some((node) => {
      if (node.nodeType === "DEPARTAMENTO") return node.departmentId === scopeId;
      if (node.nodeType === "TIME" && node.teamId) return teamById.get(node.teamId)?.parentId === scopeId;
      return false;
    });
  }

  // CANAL
  const department = team?.parentId ? departmentById.get(team.parentId) : null;
  if (department?.parentId === scopeId) return true;
  return (member.nodeResponsibleFor ?? []).some((node) => {
    if (node.nodeType === "CANAL") return node.channelId === scopeId;
    if (node.nodeType === "DEPARTAMENTO" && node.departmentId) return departmentById.get(node.departmentId)?.parentId === scopeId;
    if (node.nodeType === "TIME" && node.teamId) {
      const nodeTeam = teamById.get(node.teamId);
      const nodeDepartment = nodeTeam?.parentId ? departmentById.get(nodeTeam.parentId) : null;
      return nodeDepartment?.parentId === scopeId;
    }
    return false;
  });
}

// Espelho, no client, de resolveMemberLevelEntity (bases-recebiveis.service.ts):
// dado um Membro (EntityOption de MEMBRO) e um Nível, resolve a que
// Entidade DAQUELE PRÓPRIO Membro ela corresponde — sobe a ancestralidade
// estrutural (Time→Departamento→Canal), caindo para NodeResponsible quando
// o Membro é Líder de um nó sem estar estruturalmente dentro dele (ex:
// Time Gestão). null = não resolvível (ex: Líder de Canal sem Departamento
// mapeado, dado inconsistente).
export function resolveMemberLevelEntity(
  member: EntityOption,
  level: ScopeType,
  teamById: Map<string, EntityOption>,
  departmentById: Map<string, EntityOption>,
  companyId: string,
): string | null {
  if (level === "EMPRESA") return companyId;
  if (level === "MEMBRO") return member.entityId;

  const team = member.parentId ? teamById.get(member.parentId) : null;

  if (level === "TIME") {
    if (member.parentId) return member.parentId;
    return (member.nodeResponsibleFor ?? []).find((node) => node.nodeType === "TIME")?.teamId ?? null;
  }

  if (level === "DEPARTAMENTO") {
    if (team?.parentId) return team.parentId;
    for (const node of member.nodeResponsibleFor ?? []) {
      if (node.nodeType === "DEPARTAMENTO" && node.departmentId) return node.departmentId;
      if (node.nodeType === "TIME" && node.teamId) {
        const nodeDepartmentId = teamById.get(node.teamId)?.parentId;
        if (nodeDepartmentId) return nodeDepartmentId;
      }
    }
    return null;
  }

  // CANAL
  const department = team?.parentId ? departmentById.get(team.parentId) : null;
  if (department?.parentId) return department.parentId;
  for (const node of member.nodeResponsibleFor ?? []) {
    if (node.nodeType === "CANAL" && node.channelId) return node.channelId;
    if (node.nodeType === "DEPARTAMENTO" && node.departmentId) {
      const channelId = departmentById.get(node.departmentId)?.parentId;
      if (channelId) return channelId;
    }
    if (node.nodeType === "TIME" && node.teamId) {
      const nodeTeam = teamById.get(node.teamId);
      const nodeDepartment = nodeTeam?.parentId ? departmentById.get(nodeTeam.parentId) : null;
      if (nodeDepartment?.parentId) return nodeDepartment.parentId;
    }
  }
  return null;
}
