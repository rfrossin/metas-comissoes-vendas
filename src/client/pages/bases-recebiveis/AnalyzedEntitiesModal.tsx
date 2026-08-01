import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { EntityPicker } from "@/pages/metas/EntityPicker";
import { resolveMemberLevelEntity, useEntityOptions, type EntityOption } from "@/pages/metas/useEntityOptions";
import { useSetBeneficiaries } from "./useReceivablesQueries";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import type { BeneficiaryInput, BeneficiaryRow } from "./types";

interface Group {
  key: string;
  label: string;
  members: BeneficiaryRow[];
}

const SHORTCUTS: { level: ScopeType; label: string }[] = [
  { level: "MEMBRO", label: "Análise Individual" },
  { level: "TIME", label: "Por Time" },
  { level: "DEPARTAMENTO", label: "Por Departamento" },
  { level: "CANAL", label: "Por Canal" },
  { level: "EMPRESA", label: "Por Empresa" },
];

function buildGroups(beneficiaries: BeneficiaryRow[], membersByCargo: Map<string, EntityOption>): Group[] {
  const groups = new Map<string, Group>();
  for (const beneficiary of beneficiaries) {
    const member = membersByCargo.get(beneficiary.memberId);
    const label = member?.breadcrumb ?? "Sem Time / Time Gestão";
    const key = label;
    if (!groups.has(key)) groups.set(key, { key, label, members: [] });
    groups.get(key)!.members.push(beneficiary);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function toInput(beneficiary: BeneficiaryRow): BeneficiaryInput {
  return { memberId: beneficiary.memberId, entityType: beneficiary.entityType, entityId: beneficiary.entityId };
}

// Entidades Analisadas (Bases de Recebível §1) — o que CADA Beneficiário
// precisa bater (a si mesmo ou o resultado de um Time/Departamento/Canal/
// Empresa). Agrupado por hierarquia para facilitar a leitura; atalhos
// aplicam o mesmo Nível a todos de uma vez, editável manualmente depois.
export function AnalyzedEntitiesModal({
  baseId,
  companyId,
  beneficiaries,
  editableBeneficiaryMemberIds = null,
  onClose,
}: {
  baseId: string;
  companyId: string;
  beneficiaries: BeneficiaryRow[];
  // null = acesso FULL — tudo editável. Array = acesso PARCIAL — só a
  // Entidade Analisada de Beneficiários dentro destes ids pode ser trocada;
  // os demais aparecem travados (🔒), preservados como estão.
  editableBeneficiaryMemberIds?: string[] | null;
  onClose: () => void;
}) {
  const isPartial = editableBeneficiaryMemberIds !== null;
  const isOwned = (memberId: string) => !isPartial || editableBeneficiaryMemberIds!.includes(memberId);
  const { options: entityOptions } = useEntityOptions(companyId);
  const setBeneficiaries = useSetBeneficiaries(baseId);
  const [error, setError] = useState<string | null>(null);
  const [pendingEntities, setPendingEntities] = useState<Record<string, { entityType: ScopeType; entityId: string }>>({});

  const memberById = useMemo(() => new Map(entityOptions.MEMBRO.map((m) => [m.entityId, m])), [entityOptions.MEMBRO]);
  const teamById = useMemo(() => new Map(entityOptions.TIME.map((t) => [t.entityId, t])), [entityOptions.TIME]);
  const departmentById = useMemo(() => new Map(entityOptions.DEPARTAMENTO.map((d) => [d.entityId, d])), [entityOptions.DEPARTAMENTO]);

  const groups = useMemo(() => buildGroups(beneficiaries, memberById), [beneficiaries, memberById]);

  function currentEntityOf(beneficiary: BeneficiaryRow): { entityType: ScopeType; entityId: string } {
    return pendingEntities[beneficiary.memberId] ?? { entityType: beneficiary.entityType, entityId: beneficiary.entityId };
  }

  function isLeader(memberId: string): boolean {
    return (memberById.get(memberId)?.nodeResponsibleFor ?? []).length > 0;
  }

  function updateEntity(memberId: string, entityType: ScopeType, entityId: string) {
    setPendingEntities((prev) => ({ ...prev, [memberId]: { entityType, entityId } }));
  }

  function applyShortcut(level: ScopeType) {
    setPendingEntities((prev) => {
      const next = { ...prev };
      for (const beneficiary of beneficiaries) {
        if (!isOwned(beneficiary.memberId)) continue;
        const member = memberById.get(beneficiary.memberId);
        if (!member) continue;
        const resolvedId = resolveMemberLevelEntity(member, level, teamById, departmentById, companyId);
        if (resolvedId) next[beneficiary.memberId] = { entityType: level, entityId: resolvedId };
      }
      return next;
    });
  }

  function save() {
    const next: BeneficiaryInput[] = beneficiaries.map((beneficiary) => {
      const current = currentEntityOf(beneficiary);
      return current.entityId ? { memberId: beneficiary.memberId, ...current } : toInput(beneficiary);
    });
    setBeneficiaries.mutate(next, {
      onSuccess: () => onClose(),
      onError: () => setError("Não foi possível salvar as Entidades Analisadas."),
    });
  }

  if (beneficiaries.length === 0) {
    return (
      <Modal title="Entidades Analisadas" onClose={onClose}>
        <p className="text-sm text-muted-foreground">Cadastre Beneficiados primeiro, em "Beneficiados".</p>
      </Modal>
    );
  }

  return (
    <Modal title="Entidades Analisadas" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Aplique um atalho para definir de uma vez o que todos precisam bater, depois ajuste manualmente quem precisar. ⭐(L) marca quem é
          Líder do próprio nó.
        </p>

        {isPartial && (
          <p className="text-xs text-muted-foreground">
            Você só gerencia parte dos Beneficiários desta Base — os de fora (🔒) ficam travados, preservados como estão.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.level}
              type="button"
              onClick={() => applyShortcut(shortcut.level)}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary/50"
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">{group.label}</h4>
              {group.members.map((beneficiary) => {
                const owned = isOwned(beneficiary.memberId);
                return (
                  <div key={beneficiary.memberId} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                    <div className="w-44 shrink-0 text-sm font-medium text-foreground">
                      {!owned && <span title="Somente consulta">🔒 </span>}
                      {beneficiary.member.fullName}
                      {isLeader(beneficiary.memberId) && <span title="Líder de Nó"> ⭐(L)</span>}
                    </div>
                    {owned ? (
                      <EntityPicker
                        companyId={companyId}
                        entityType={currentEntityOf(beneficiary).entityType}
                        entityId={currentEntityOf(beneficiary).entityId}
                        onChange={(next) => updateEntity(beneficiary.memberId, next.entityType, next.entityId)}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">{beneficiary.entityName}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

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
