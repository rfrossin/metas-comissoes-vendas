import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { EntityOption, NodeResponsibleRef } from "./useEntityOptions";

export type ScopedOptionsMode = "led" | "visible" | "editable" | "native" | "results";

interface ScopedChannel {
  id: string;
  name: string;
}
interface ScopedDepartment {
  id: string;
  name: string;
  channelId: string;
  channel: { name: string };
}
interface ScopedTeam {
  id: string;
  name: string;
  departmentId: string;
  department: { name: string; channel: { name: string } };
}
interface ScopedMember {
  id: string;
  fullName: string;
  cargo: { id: string; name: string } | null;
  team: { id: string; name: string; department: { id: string; name: string; channel: { id: string; name: string } } } | null;
  nodeResponsibleFor: NodeResponsibleRef[];
}
interface ScopedOptionsResponse {
  unrestricted: boolean;
  channels: ScopedChannel[];
  departments: ScopedDepartment[];
  teams: ScopedTeam[];
  members: ScopedMember[];
}

// Igual a useEntityOptions (mesma forma de retorno — options/allOptions —
// pra servir de fonte alternativa "drop-in" pros mesmos componentes:
// EntityPicker/EntityMultiPicker/LeadershipEditor/TeamSelect, quando
// recebem a prop `scoped`), mas a fonte é o endpoint já podado ao escopo do
// usuário (PASSO 9.1: GET /estrutura-organizacional/scoped-options), em vez
// da árvore inteira da empresa. "Empresa (Geral)" só entra como opção
// quando `unrestricted` (Admin, ou atribuição de nível EMPRESA) — do
// contrário o usuário poderia escolher um nó fora do que lidera/vê/edita.
export function useScopedEntityOptions(companyId: string, mode: ScopedOptionsMode) {
  const { data, isLoading } = useQuery({
    queryKey: ["scoped-org-options", mode],
    queryFn: async () => {
      const { data } = await api.get<ScopedOptionsResponse>("/estrutura-organizacional/scoped-options", {
        params: { mode },
      });
      return data;
    },
  });

  const options = useMemo<Record<ScopeType, EntityOption[]>>(() => {
    const empresa: EntityOption[] = data?.unrestricted
      ? [{ entityType: "EMPRESA", entityId: companyId, label: "Empresa (Geral)", breadcrumb: null, parentId: null }]
      : [];

    const canal: EntityOption[] = (data?.channels ?? []).map((c) => ({
      entityType: "CANAL",
      entityId: c.id,
      label: c.name,
      breadcrumb: null,
      parentId: null,
    }));

    const departamento: EntityOption[] = (data?.departments ?? []).map((d) => ({
      entityType: "DEPARTAMENTO",
      entityId: d.id,
      label: d.name,
      breadcrumb: `Canal: ${d.channel.name}`,
      parentId: d.channelId,
    }));

    const time: EntityOption[] = (data?.teams ?? []).map((t) => ({
      entityType: "TIME",
      entityId: t.id,
      label: t.name,
      breadcrumb: `Canal: ${t.department.channel.name} > Departamento: ${t.department.name}`,
      parentId: t.departmentId,
    }));

    // Índices por id para posicionar o Membro sem Time pelo nó que ele
    // LIDERA — os nós já vêm carregados acima, então não custa consulta
    // nenhuma.
    const teamById = new Map((data?.teams ?? []).map((t) => [t.id, t]));
    const departmentById = new Map((data?.departments ?? []).map((d) => [d.id, d]));
    const channelById = new Map((data?.channels ?? []).map((c) => [c.id, c]));

    // Caminho PARCIAL do líder: ele não pertence a um nó, lidera um. Líder
    // de Time aparece com Canal>Departamento>Time; de Departamento, com
    // Canal>Departamento; de Canal, só com o Canal. Sem isto todos caíam em
    // "Sem Time", fora de qualquer hierarquia.
    function leadershipParts(refs: NodeResponsibleRef[]): string[] {
      const teamRef = refs.find((r) => r.nodeType === "TIME" && r.teamId);
      const team = teamRef?.teamId ? teamById.get(teamRef.teamId) : undefined;
      if (team) {
        return [`Canal: ${team.department.channel.name}`, `Departamento: ${team.department.name}`, `Time: ${team.name}`];
      }

      const departmentRef = refs.find((r) => r.nodeType === "DEPARTAMENTO" && r.departmentId);
      const department = departmentRef?.departmentId ? departmentById.get(departmentRef.departmentId) : undefined;
      if (department) {
        return [`Canal: ${department.channel.name}`, `Departamento: ${department.name}`];
      }

      const channelRef = refs.find((r) => r.nodeType === "CANAL" && r.channelId);
      const channel = channelRef?.channelId ? channelById.get(channelRef.channelId) : undefined;
      if (channel) return [`Canal: ${channel.name}`];

      if (refs.some((r) => r.nodeType === "EMPRESA")) return ["Empresa"];

      return [];
    }

    const membro: EntityOption[] = (data?.members ?? []).map((m) => {
      const parts: string[] = [];
      if (m.team) {
        parts.push(`Canal: ${m.team.department.channel.name}`);
        parts.push(`Departamento: ${m.team.department.name}`);
        parts.push(`Time: ${m.team.name}`);
      } else {
        const led = leadershipParts(m.nodeResponsibleFor);
        // "Sem Time" só para quem não tem Time NEM lidera nada — aí de fato
        // não há hierarquia a mostrar.
        parts.push(...(led.length > 0 ? led : ["Sem Time"]));
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
  }, [data, companyId]);

  const allOptions = useMemo<EntityOption[]>(
    () => [...options.EMPRESA, ...options.CANAL, ...options.DEPARTAMENTO, ...options.TIME, ...options.MEMBRO],
    [options],
  );

  return { options, allOptions, unrestricted: data?.unrestricted ?? false, isLoading };
}
