import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { TeamSelect } from "@/pages/usuarios/TeamSelect";
import { LeadershipEditor } from "./LeadershipEditor";

interface CargoOption {
  id: string;
  name: string;
}

export type MemberType = "OPERADOR" | "GESTOR";

// Uma hierarquia que um Membro Tipo GESTOR lidera — mesmo formato de nó
// usado no resto da Estrutura Organizacional (sem memberId, é sempre o
// próprio Membro sendo criado/editado neste formulário).
export type LeadershipTarget =
  | { nodeType: "EMPRESA" }
  | { nodeType: "CANAL"; channelId: string }
  | { nodeType: "DEPARTAMENTO"; departmentId: string }
  | { nodeType: "TIME"; teamId: string };

export interface MemberFormValues {
  fullName: string;
  cargoId: string;
  teamId: string | null;
  memberType: MemberType;
  status: "ATIVO" | "INATIVO";
  customFixedSalary: number | null;
  leaderships: LeadershipTarget[];
}

interface MemberFormProps {
  companyId: string;
  initialValues?: Partial<MemberFormValues>;
  showStatus?: boolean;
  showTeamSelect?: boolean;
  submitLabel: string;
  onSubmit: (values: MemberFormValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function MemberForm({
  companyId,
  initialValues,
  showStatus = false,
  showTeamSelect = false,
  submitLabel,
  onSubmit,
  onCancel,
  isSubmitting,
}: MemberFormProps) {
  const { data: cargos } = useQuery({
    queryKey: ["cargos"],
    queryFn: async () => {
      const { data } = await api.get<CargoOption[]>("/cargos");
      return data;
    },
  });

  const [fullName, setFullName] = useState(initialValues?.fullName ?? "");
  const [cargoId, setCargoId] = useState(initialValues?.cargoId ?? "");
  const [teamId, setTeamId] = useState(initialValues?.teamId ?? "");
  const [memberType, setMemberType] = useState<MemberType>(initialValues?.memberType ?? "OPERADOR");
  const [status, setStatus] = useState<"ATIVO" | "INATIVO">(initialValues?.status ?? "ATIVO");
  const [useCustomSalary, setUseCustomSalary] = useState(initialValues?.customFixedSalary != null);
  const [customFixedSalary, setCustomFixedSalary] = useState(
    initialValues?.customFixedSalary != null ? String(initialValues.customFixedSalary) : "",
  );
  const [leaderships, setLeaderships] = useState<LeadershipTarget[]>(initialValues?.leaderships ?? []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!fullName.trim() || !cargoId) {
      return;
    }

    onSubmit({
      fullName: fullName.trim(),
      cargoId,
      teamId: teamId || null,
      memberType,
      status,
      customFixedSalary: useCustomSalary && customFixedSalary !== "" ? Number(customFixedSalary) : null,
      leaderships: memberType === "GESTOR" ? leaderships : [],
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Nome completo</label>
          <input
            autoFocus
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Cargo</label>
          <select
            value={cargoId}
            onChange={(event) => setCargoId(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Selecione...</option>
            {cargos?.map((cargo) => (
              <option key={cargo.id} value={cargo.id}>
                {cargo.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo</label>
          <select
            value={memberType}
            onChange={(event) => setMemberType(event.target.value as MemberType)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="OPERADOR">Operador</option>
            <option value="GESTOR">Gestor</option>
          </select>
        </div>

        {showTeamSelect && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Time (opcional — vazio = sem Time, só Admin)</label>
            {/* PASSO 9.4: escopado ao que o Gestor lidera — "led" já devolve
                irrestrito pra Admin, então não precisa de ramificação aqui. */}
            <TeamSelect value={teamId} onChange={setTeamId} companyId={companyId} scoped="led" />
          </div>
        )}

        {showStatus && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "ATIVO" | "INATIVO")}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={useCustomSalary}
            onChange={(event) => setUseCustomSalary(event.target.checked)}
          />
          Customizar salário fixo (senão usa o padrão do cargo)
        </label>

        {useCustomSalary && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Salário fixo customizado (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={customFixedSalary}
              onChange={(event) => setCustomFixedSalary(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        )}
      </div>

      {memberType === "GESTOR" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            Lideranças (hierarquias que este Gestor lidera — pode ser mais de uma)
          </label>
          <LeadershipEditor companyId={companyId} leaderships={leaderships} onChange={setLeaderships} scoped="led" />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
