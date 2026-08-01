import type { EntityOption } from "@/pages/metas/useEntityOptions";

export interface BeneficiaryFilter {
  channelId: string | null;
  departmentId: string | null;
  teamId: string | null;
  cargoId: string | null;
  search: string;
}

export function emptyBeneficiaryFilter(): BeneficiaryFilter {
  return { channelId: null, departmentId: null, teamId: null, cargoId: null, search: "" };
}

// Filtro de navegação (Canal/Departamento/Time em cascata, mais Cargo e
// Nome) para achar mais rápido quem marcar na lista de Beneficiários — não
// restringe a seleção final: o gestor pode continuar escolhendo Membros de
// entidades diferentes como Beneficiários da mesma Base, o filtro só
// encolhe a lista visível.
export function BeneficiaryEntityFilter({
  options,
  cargoOptions,
  filter,
  onChange,
}: {
  options: { CANAL: EntityOption[]; DEPARTAMENTO: EntityOption[]; TIME: EntityOption[] };
  cargoOptions: { id: string; name: string }[];
  filter: BeneficiaryFilter;
  onChange: (next: BeneficiaryFilter) => void;
}) {
  const departmentOptions = filter.channelId ? options.DEPARTAMENTO.filter((d) => d.parentId === filter.channelId) : options.DEPARTAMENTO;
  const teamOptions = filter.departmentId ? options.TIME.filter((t) => t.parentId === filter.departmentId) : options.TIME;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Buscar por Nome</label>
        <input
          value={filter.search}
          onChange={(event) => onChange({ ...filter, search: event.target.value })}
          placeholder="Nome do Membro"
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Filtrar por Cargo</label>
        <select
          value={filter.cargoId ?? ""}
          onChange={(event) => onChange({ ...filter, cargoId: event.target.value || null })}
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="">Todos</option>
          {cargoOptions.map((cargo) => (
            <option key={cargo.id} value={cargo.id}>
              {cargo.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Filtrar por Canal</label>
        <select
          value={filter.channelId ?? ""}
          onChange={(event) => onChange({ ...filter, channelId: event.target.value || null, departmentId: null, teamId: null })}
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="">Todos</option>
          {options.CANAL.map((option) => (
            <option key={option.entityId} value={option.entityId}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Filtrar por Departamento</label>
        <select
          value={filter.departmentId ?? ""}
          onChange={(event) => onChange({ ...filter, departmentId: event.target.value || null, teamId: null })}
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="">Todos</option>
          {departmentOptions.map((option) => (
            <option key={option.entityId} value={option.entityId}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Filtrar por Time</label>
        <select
          value={filter.teamId ?? ""}
          onChange={(event) => onChange({ ...filter, teamId: event.target.value || null })}
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="">Todos</option>
          {teamOptions.map((option) => (
            <option key={option.entityId} value={option.entityId}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {(filter.channelId || filter.departmentId || filter.teamId || filter.cargoId || filter.search) && (
        <button type="button" onClick={() => onChange(emptyBeneficiaryFilter())} className="text-xs text-primary hover:underline">
          Limpar filtro
        </button>
      )}
    </div>
  );
}
