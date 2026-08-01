import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { BeneficiaryEntityFilter, emptyBeneficiaryFilter, type BeneficiaryFilter } from "./BeneficiaryEntityFilter";
import { useSetBeneficiaries } from "./useReceivablesQueries";
import { isMemberInScope, type EntityOption } from "@/pages/metas/useEntityOptions";
import { useScopedEntityOptions } from "@/pages/metas/useScopedEntityOptions";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { BeneficiaryInput, BeneficiaryRow } from "./types";

function filterMembers(members: EntityOption[], teams: EntityOption[], departments: EntityOption[], filter: BeneficiaryFilter): EntityOption[] {
  let result = members;

  if (filter.channelId || filter.departmentId || filter.teamId) {
    const teamById = new Map(teams.map((team) => [team.entityId, team]));
    const departmentById = new Map(departments.map((department) => [department.entityId, department]));
    const [scopeType, scopeId] = filter.teamId
      ? (["TIME", filter.teamId] as const)
      : filter.departmentId
        ? (["DEPARTAMENTO", filter.departmentId] as const)
        : (["CANAL", filter.channelId!] as const);
    result = result.filter((member) => isMemberInScope(member, teamById, departmentById, scopeType, scopeId));
  }

  if (filter.cargoId) {
    result = result.filter((member) => member.cargo?.id === filter.cargoId);
  }

  if (filter.search.trim()) {
    const needle = filter.search.trim().toLowerCase();
    result = result.filter((member) => member.label.toLowerCase().includes(needle));
  }

  return result;
}

function toInput(beneficiary: BeneficiaryRow): BeneficiaryInput {
  return { memberId: beneficiary.memberId, entityType: beneficiary.entityType, entityId: beneficiary.entityId };
}

// Beneficiados (Bases de Recebível §1) — quem recebe, sempre Membros. A
// Entidade de Análise de cada um (o que ele precisa bater) é configurada à
// parte, em Entidades Analisadas — este pop-up só decide QUEM está dentro.
export function BeneficiariesModal({
  baseId,
  companyId,
  beneficiaries,
  editableBeneficiaryMemberIds = null,
  onClose,
}: {
  baseId: string;
  companyId: string;
  beneficiaries: BeneficiaryRow[];
  // null = acesso FULL (Admin, ou Gestor com todos os Beneficiários) — tudo
  // editável. Array = acesso PARCIAL — Beneficiários fora destes ids ficam
  // travados (🔒), preservados como estão, e o picker só oferece Membros
  // dentro do escopo editável do requisitante (backend também garante).
  editableBeneficiaryMemberIds?: string[] | null;
  onClose: () => void;
}) {
  const isPartial = editableBeneficiaryMemberIds !== null;
  const { options: entityOptions, isLoading: isLoadingOptions } = useScopedEntityOptions(companyId, "editable");
  const setBeneficiaries = useSetBeneficiaries(baseId);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BeneficiaryFilter>(emptyBeneficiaryFilter());
  const ownedBeneficiaries = isPartial ? beneficiaries.filter((b) => editableBeneficiaryMemberIds!.includes(b.memberId)) : beneficiaries;
  const lockedBeneficiaries = isPartial ? beneficiaries.filter((b) => !editableBeneficiaryMemberIds!.includes(b.memberId)) : [];
  const [selectedIds, setSelectedIds] = useState<string[]>(() => ownedBeneficiaries.map((b) => b.memberId));

  const cargoOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const member of entityOptions.MEMBRO) {
      if (member.cargo) seen.set(member.cargo.id, member.cargo);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entityOptions.MEMBRO]);

  const filteredMembers = useMemo(
    () => filterMembers(entityOptions.MEMBRO, entityOptions.TIME, entityOptions.DEPARTAMENTO, filter),
    [entityOptions, filter],
  );

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const member of filteredMembers) next.add(member.entityId);
      return [...next];
    });
  }

  function save() {
    const removedIds = new Set(ownedBeneficiaries.map((b) => b.memberId).filter((id) => !selectedIds.includes(id)));
    const addedIds = selectedIds.filter((id) => !ownedBeneficiaries.some((b) => b.memberId === id));
    const next: BeneficiaryInput[] = [
      // Beneficiários fora do escopo editável são sempre reenviados
      // intactos — o backend também os preserva independente disso, mas a
      // tela sempre resubmete a lista inteira (mesmo idioma de Gatilhos
      // Condicionais em acesso PARCIAL).
      ...lockedBeneficiaries.map(toInput),
      ...ownedBeneficiaries.filter((b) => !removedIds.has(b.memberId)).map(toInput),
      // Entidade nasce como o próprio Membro (avaliação individual) — troca
      // depois em Entidades Analisadas.
      ...addedIds.map((memberId) => ({ memberId, entityType: "MEMBRO" as ScopeType, entityId: memberId })),
    ];
    setBeneficiaries.mutate(next, {
      onSuccess: () => onClose(),
      onError: () => setError("Não foi possível salvar os Beneficiados."),
    });
  }

  return (
    <Modal title="Beneficiados" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Os Beneficiados são sempre Membros. Filtre e marque quem participa desta Base de Recebível.
        </p>

        {isPartial && (
          <p className="text-xs text-muted-foreground">
            Você só gerencia parte dos Beneficiários desta Base — o seletor abaixo mostra só Membros dentro do seu escopo. Os
            Beneficiários de fora (🔒) ficam preservados como estão.
          </p>
        )}

        {lockedBeneficiaries.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground">Fora do seu escopo (preservados)</h4>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {lockedBeneficiaries.map((b) => (
                <li key={b.memberId}>🔒 {b.member.fullName}</li>
              ))}
            </ul>
          </div>
        )}

        <BeneficiaryEntityFilter
          options={{ CANAL: entityOptions.CANAL, DEPARTAMENTO: entityOptions.DEPARTAMENTO, TIME: entityOptions.TIME }}
          cargoOptions={cargoOptions}
          filter={filter}
          onChange={setFilter}
        />

        <button type="button" onClick={selectAllFiltered} className="text-xs text-primary hover:underline">
          Selecionar Todos ({filteredMembers.length} filtrado{filteredMembers.length === 1 ? "" : "s"})
        </button>

        <div className="max-h-72 w-full overflow-y-auto rounded-md border border-input bg-background p-1.5">
          {isLoadingOptions && <p className="px-1 py-0.5 text-xs text-muted-foreground">Carregando...</p>}
          {!isLoadingOptions && filteredMembers.length === 0 && (
            <p className="px-1 py-0.5 text-xs text-muted-foreground">Nenhum Membro encontrado para este filtro.</p>
          )}
          {filteredMembers.map((member) => (
            <label key={member.entityId} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-secondary/50">
              <input type="checkbox" checked={selectedIds.includes(member.entityId)} onChange={() => toggle(member.entityId)} />
              <span>
                {member.label}
                {member.cargo ? <span className="text-muted-foreground"> — {member.cargo.name}</span> : null}
                {member.breadcrumb ? <span className="text-muted-foreground"> ({member.breadcrumb})</span> : null}
              </span>
            </label>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{selectedIds.length} Beneficiado(s) selecionado(s).</p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={save}
            disabled={setBeneficiaries.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {setBeneficiaries.isPending ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
