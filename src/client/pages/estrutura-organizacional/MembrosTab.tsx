import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { MemberForm, type LeadershipTarget, type MemberFormValues, type MemberType } from "./MemberForm";
import { BulkImportPanel } from "./BulkImportPanel";

interface NodeResponsibleForEntry {
  nodeType: "EMPRESA" | "CANAL" | "DEPARTAMENTO" | "TIME";
  channelId: string | null;
  departmentId: string | null;
  teamId: string | null;
  channel: { name: string } | null;
  department: { name: string } | null;
  team: { name: string } | null;
}

interface ManagedMember {
  id: string;
  fullName: string;
  status: "ATIVO" | "INATIVO";
  memberType: MemberType;
  customFixedSalary: string | null;
  // ISO vindo da API (DATE no banco); a UI usa só a parte AAAA-MM-DD.
  entryDate: string | null;
  exitDate: string | null;
  cargo: { id: string; name: string };
  team: {
    id: string;
    name: string;
    department: { id: string; name: string; channel: { id: string; name: string } };
  } | null;
  nodeResponsibleFor: NodeResponsibleForEntry[];
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

function hierarchyPath(member: ManagedMember): string {
  if (!member.team) return "—";
  return `${member.team.department.channel.name} / ${member.team.department.name} / ${member.team.name}`;
}

function leadershipNames(member: ManagedMember): string | null {
  if (member.memberType !== "GESTOR" || member.nodeResponsibleFor.length === 0) return null;
  return member.nodeResponsibleFor
    .map((entry) => (entry.nodeType === "EMPRESA" ? "Empresa" : entry.team?.name ?? entry.department?.name ?? entry.channel?.name ?? "—"))
    .join(", ");
}

function toLeadershipTargets(entries: NodeResponsibleForEntry[]): LeadershipTarget[] {
  return entries.map((entry) => {
    if (entry.nodeType === "EMPRESA") return { nodeType: "EMPRESA" };
    if (entry.nodeType === "CANAL") return { nodeType: "CANAL", channelId: entry.channelId! };
    if (entry.nodeType === "DEPARTAMENTO") return { nodeType: "DEPARTAMENTO", departmentId: entry.departmentId! };
    return { nodeType: "TIME", teamId: entry.teamId! };
  });
}

function formatSalary(value: string | null): string {
  if (value == null) return "Padrão do cargo";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

// A API devolve DATE como ISO ("2026-03-01T00:00:00.000Z"); o <input
// type="date"> e o backend trabalham com AAAA-MM-DD. Cortar a string (em vez
// de usar new Date) evita o clássico deslocamento de um dia por fuso.
function toDateInputValue(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function formatEmployment(member: ManagedMember): string {
  const entry = toDateInputValue(member.entryDate);
  const exit = toDateInputValue(member.exitDate);
  if (!entry && !exit) return "—";
  const format = (iso: string) => iso.split("-").reverse().join("/");
  return `${entry ? format(entry) : "—"} → ${exit ? format(exit) : "atual"}`;
}

const TYPE_LABELS: Record<MemberType, string> = { OPERADOR: "Operador", GESTOR: "Gestor" };

// Onde Admin e Gestor criam/editam/desativam/excluem Membros e veem o
// resumo de cada um (Nome, Cargo, Hierarquia, Salário) — a lista já vem
// filtrada pelo backend ao escopo liderado do Gestor (protege Salário de
// quem está fora do escopo dele).
export function MembrosTab() {
  const companyId = useAuthStore((state) => state.user!.companyId);
  // PASSO 11.7: excluir Membro passou a ser Admin-only no servidor
  // (deleteMember) — botão escondido pra Gestor aqui por defesa em
  // profundidade (evita um 403 confuso; Editar/Ativar-Desativar continuam
  // liberados pra Gestor dentro do escopo liderado, sem mudança).
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"TODOS" | MemberType>("TODOS");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data: members, isLoading } = useQuery({
    queryKey: ["members-manage"],
    queryFn: async () => {
      const { data } = await api.get<ManagedMember[]>("/estrutura-organizacional/members/manage");
      return data;
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["members-manage"] });
    queryClient.invalidateQueries({ queryKey: ["org-tree"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: MemberFormValues) =>
      api.post("/estrutura-organizacional/members", {
        fullName: values.fullName,
        cargoId: values.cargoId,
        teamId: values.teamId,
        memberType: values.memberType,
        customFixedSalary: values.customFixedSalary,
        leaderships: values.leaderships,
        entryDate: values.entryDate,
        exitDate: values.exitDate,
      }),
    onSuccess: () => {
      invalidate();
      setIsCreating(false);
      setFormError(null);
    },
    onError: (error) => setFormError(extractErrorMessage(error, "Não foi possível criar o Membro.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: MemberFormValues }) =>
      api.put(`/estrutura-organizacional/members/${id}`, {
        fullName: values.fullName,
        cargoId: values.cargoId,
        memberType: values.memberType,
        customFixedSalary: values.customFixedSalary,
        status: values.status,
        leaderships: values.leaderships,
        entryDate: values.entryDate,
        exitDate: values.exitDate,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setFormError(null);
    },
    onError: (error) => setFormError(extractErrorMessage(error, "Não foi possível salvar o Membro.")),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (member: ManagedMember) =>
      api.put(`/estrutura-organizacional/members/${member.id}`, {
        fullName: member.fullName,
        cargoId: member.cargo.id,
        memberType: member.memberType,
        customFixedSalary: member.customFixedSalary != null ? Number(member.customFixedSalary) : null,
        status: member.status === "ATIVO" ? "INATIVO" : "ATIVO",
        leaderships: toLeadershipTargets(member.nodeResponsibleFor),
        // Reenviados sem alteração: o PUT substitui o Membro inteiro, então
        // omitir as datas aqui apagaria o vínculo ao ativar/desativar.
        entryDate: toDateInputValue(member.entryDate),
        exitDate: toDateInputValue(member.exitDate),
      }),
    onSuccess: () => {
      invalidate();
      setRowError(null);
    },
    onError: (error) => setRowError(extractErrorMessage(error, "Não foi possível alterar o status deste Membro.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/estrutura-organizacional/members/${id}`),
    onSuccess: () => {
      invalidate();
      setRowError(null);
    },
    onError: (error) => setRowError(extractErrorMessage(error, "Não foi possível excluir este Membro.")),
  });

  function handleDelete(member: ManagedMember) {
    if (window.confirm(`Excluir o Membro "${member.fullName}"? Essa ação não pode ser desfeita.`)) {
      setRowError(null);
      deleteMutation.mutate(member.id);
    }
  }

  const filteredMembers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (members ?? []).filter((member) => {
      if (typeFilter !== "TODOS" && member.memberType !== typeFilter) return false;
      if (normalizedSearch && !member.fullName.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [members, search, typeFilter]);

  const editingMember = editingId ? (members ?? []).find((m) => m.id === editingId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Buscar por nome</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Tipo</label>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as "TODOS" | MemberType)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="TODOS">Todos</option>
              <option value="OPERADOR">Operador</option>
              <option value="GESTOR">Gestor</option>
            </select>
          </div>
        </div>

        {!isBulkImportOpen && (
          <button
            type="button"
            onClick={() => setIsBulkImportOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
          >
            Importar planilha
          </button>
        )}
      </div>

      {isBulkImportOpen && <BulkImportPanel onClose={() => setIsBulkImportOpen(false)} />}

      {isCreating && (
        <MemberForm
          companyId={companyId}
          showTeamSelect
          submitLabel="Criar"
          onSubmit={(values) => createMutation.mutate(values)}
          onCancel={() => {
            setIsCreating(false);
            setFormError(null);
          }}
          isSubmitting={createMutation.isPending}
        />
      )}

      {editingMember && (
        <MemberForm
          companyId={companyId}
          showStatus
          initialValues={{
            fullName: editingMember.fullName,
            cargoId: editingMember.cargo.id,
            memberType: editingMember.memberType,
            status: editingMember.status,
            customFixedSalary: editingMember.customFixedSalary != null ? Number(editingMember.customFixedSalary) : null,
            leaderships: toLeadershipTargets(editingMember.nodeResponsibleFor),
            entryDate: toDateInputValue(editingMember.entryDate),
            exitDate: toDateInputValue(editingMember.exitDate),
          }}
          submitLabel="Salvar"
          onSubmit={(values) => updateMutation.mutate({ id: editingMember.id, values })}
          onCancel={() => {
            setEditingId(null);
            setFormError(null);
          }}
          isSubmitting={updateMutation.isPending}
        />
      )}

      {!isCreating && !editingMember && (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
        >
          + Novo Membro
        </button>
      )}

      {formError && <p className="text-xs text-destructive">{formError}</p>}
      {rowError && <p className="text-xs text-destructive">{rowError}</p>}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">Nome</th>
              <th className="px-3 py-1.5">Cargo</th>
              <th className="px-3 py-1.5">Hierarquia</th>
              <th className="px-3 py-1.5">Salário</th>
              <th className="px-3 py-1.5">Vínculo</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-2 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && filteredMembers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-2 text-muted-foreground">
                  Nenhum Membro encontrado.
                </td>
              </tr>
            )}
            {filteredMembers.map((member) => {
              const leaders = leadershipNames(member);
              return (
                <tr key={member.id} className="border-t border-border">
                  <td className="px-3 py-1.5">{member.fullName}</td>
                  <td className="px-3 py-1.5">{member.cargo.name}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-col">
                      <span>{hierarchyPath(member)}</span>
                      {leaders && <span className="text-xs text-muted-foreground">Lidera: {leaders}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">{formatSalary(member.customFixedSalary)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{formatEmployment(member)}</td>
                  <td className="px-3 py-1.5">{TYPE_LABELS[member.memberType]}</td>
                  <td className="px-3 py-1.5">
                    {member.status === "ATIVO" ? (
                      <span className="text-foreground">Ativo</span>
                    ) : (
                      <span className="text-muted-foreground">Inativo</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(member.id);
                          setIsCreating(false);
                          setFormError(null);
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={toggleActiveMutation.isPending}
                        onClick={() => toggleActiveMutation.mutate(member)}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                      >
                        {member.status === "ATIVO" ? "Desativar" : "Reativar"}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDelete(member)}
                          className="text-xs text-destructive hover:underline disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
