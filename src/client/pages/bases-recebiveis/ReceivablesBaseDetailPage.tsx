import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { Modal } from "./Modal";
import { BaseFormFields } from "./BaseFormFields";
import { BeneficiariesModal } from "./BeneficiariesModal";
import { BeneficiariesSummaryTable } from "./BeneficiariesSummaryTable";
import { AnalyzedEntitiesModal } from "./AnalyzedEntitiesModal";
import { ConditionalTriggersModal } from "./ConditionalTriggersModal";
import { TierLadderModal } from "./TierLadderModal";
import {
  useDeleteReceivablesBase,
  useDuplicateReceivablesBase,
  useReceivablesBaseDetail,
  useSaveReceivablesBase,
  useSetReceivablesBaseStatus,
} from "./useReceivablesQueries";
import type { ReceivablesBaseInput, ReceivablesStatus } from "./types";

const STATUS_LABELS: Record<ReceivablesStatus, string> = {
  ATIVO: "Ativo",
  DESATIVADO: "Desativado",
  ENCERRADO: "Encerrado",
};

type OpenModal = "editar" | "beneficiados" | "entidades" | "gatilhos" | "degraus" | null;

function toInput(base: {
  name: string;
  indicatorType: ReceivablesBaseInput["indicatorType"];
  primaryGoalCampaignId: string | null;
  resultTypeId: string | null;
  periodicity: ReceivablesBaseInput["periodicity"];
  triggerMode: ReceivablesBaseInput["triggerMode"];
  startDate: string | null;
  endDate: string | null;
}): ReceivablesBaseInput {
  return {
    name: base.name,
    indicatorType: base.indicatorType,
    primaryGoalCampaignId: base.primaryGoalCampaignId,
    resultTypeId: base.resultTypeId,
    periodicity: base.periodicity,
    triggerMode: base.triggerMode,
    startDate: base.startDate ? base.startDate.slice(0, 10) : null,
    endDate: base.endDate ? base.endDate.slice(0, 10) : null,
  };
}

// Tela de Configuração de uma Base de Recebível: cabeçalho com ações
// (Editar/Desativar/Duplicar/Excluir) + grid de 5 cards clicáveis, cada um
// abrindo seu próprio pop-up de edição (Beneficiados, Entidades Analisadas,
// Gatilhos Condicionais, Degraus e Recompensas, Simulador).
export function ReceivablesBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const { data: base, isLoading } = useReceivablesBaseDetail(id ?? null);

  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [editForm, setEditForm] = useState<ReceivablesBaseInput | null>(null);
  const [editOpenEnded, setEditOpenEnded] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const saveMutation = useSaveReceivablesBase();
  const deleteMutation = useDeleteReceivablesBase();
  const statusMutation = useSetReceivablesBaseStatus();
  const duplicateMutation = useDuplicateReceivablesBase();

  const cargoSummary = useMemo(() => {
    if (!base) return [];
    const counts = new Map<string, number>();
    for (const beneficiary of base.beneficiaries) {
      const name = beneficiary.member.cargo?.name ?? "Sem Cargo";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [base]);

  if (isLoading || !base) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const isPartial = base.access === "PARTIAL";

  function openEdit() {
    if (!base) return;
    setEditForm(toInput(base));
    setEditOpenEnded(!base.endDate);
    setEditError(null);
    setOpenModal("editar");
  }

  function saveEdit() {
    if (!editForm) return;
    saveMutation.mutate(
      { id: base!.id, input: { ...editForm, endDate: editOpenEnded ? null : editForm.endDate } },
      {
        onSuccess: () => setOpenModal(null),
        onError: () => setEditError("Não foi possível salvar: confira a Campanha/Tipo de Resultado e as datas."),
      },
    );
  }

  function handleDelete() {
    deleteMutation.mutate(base!.id, { onSuccess: () => navigate("/bases-recebiveis") });
  }

  function handleDuplicate() {
    duplicateMutation.mutate(base!.id, {
      onSuccess: (response) => {
        const clone = response.data as { id: string };
        navigate(`/bases-recebiveis/${clone.id}`);
      },
    });
  }

  const canSaveEdit =
    !!editForm?.name &&
    (editForm.indicatorType === "META" ? !!editForm.primaryGoalCampaignId : !!editForm.resultTypeId) &&
    (editOpenEnded || !!editForm.startDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" onClick={() => navigate(-1)} className="mb-1 text-xs text-primary hover:underline">
            ← Voltar para Bases de Recebível
          </button>
          <h1 className="text-xl font-semibold text-foreground">{base.name}</h1>
          <p className="text-sm text-muted-foreground">
            {base.indicatorType === "META" ? `Meta: ${base.primaryGoal?.name ?? "—"}` : `Resultado: ${base.resultType?.name ?? "—"}`} ·{" "}
            {STATUS_LABELS[base.status]}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={isPartial}
            title={isPartial ? "Só quem gerencia todos os Beneficiários pode editar o cabeçalho." : undefined}
            onClick={openEdit}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Editar
          </button>
          <button
            type="button"
            disabled={isPartial}
            title={isPartial ? "Só quem gerencia todos os Beneficiários pode alterar o status." : undefined}
            onClick={() => statusMutation.mutate({ id: base.id, status: base.status === "ATIVO" ? "DESATIVADO" : "ATIVO" })}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            {base.status === "ATIVO" ? "Desativar" : "Ativar"}
          </button>
          <button
            type="button"
            disabled={isPartial}
            title={isPartial ? "Só quem gerencia todos os Beneficiários pode duplicar." : undefined}
            onClick={handleDuplicate}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Duplicar
          </button>
          <button
            type="button"
            disabled={isPartial}
            title={isPartial ? "Só quem gerencia todos os Beneficiários pode excluir." : undefined}
            onClick={handleDelete}
            className="rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>

      {isPartial && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Você gerencia só parte dos Beneficiários desta Base — pode consultar tudo e editar Beneficiados/Entidades Analisadas/Gatilhos
          dos seus próprios Beneficiários (🔒 nos demais). Cabeçalho e Degraus ficam travados (afetam outros Gestores).
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => setOpenModal("beneficiados")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Beneficiados</h3>
          <p className="mt-1 text-xs text-muted-foreground">{base.beneficiaries.length} Beneficiário(s)</p>
          {cargoSummary.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {cargoSummary.map(([cargo, count]) => `${count} ${cargo}`).join(", ")}
            </p>
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("entidades")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Entidades Analisadas</h3>
          <p className="mt-1 text-xs text-muted-foreground">Configure o que cada Beneficiário deve bater</p>
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("gatilhos")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Gatilhos Condicionais</h3>
          <p className="mt-1 text-xs text-muted-foreground">{base.conditionalTriggers.length} Condição(ões)</p>
        </button>

        <button
          type="button"
          onClick={() => setOpenModal("degraus")}
          className="rounded-lg border border-border p-4 text-left hover:bg-secondary/30"
        >
          <h3 className="text-sm font-semibold text-foreground">Degraus e Recompensas</h3>
          <p className="mt-1 text-xs text-muted-foreground">{base.tierRules.length} Degrau(s)</p>
        </button>
      </div>

      <BeneficiariesSummaryTable
        baseId={base.id}
        indicatorType={base.indicatorType}
        beneficiaries={base.beneficiaries}
        conditionalTriggers={base.conditionalTriggers}
        access={base.access}
        editableBeneficiaryMemberIds={base.editableBeneficiaryMemberIds}
      />

      {openModal === "editar" && editForm && (
        <Modal title="Editar Base de Recebível" onClose={() => setOpenModal(null)}>
          <div className="space-y-4">
            <BaseFormFields form={editForm} setForm={setEditForm} openEnded={editOpenEnded} setOpenEnded={setEditOpenEnded} />
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                disabled={!canSaveEdit || saveMutation.isPending}
                onClick={saveEdit}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saveMutation.isPending ? "Salvando..." : "Salvar"}
              </button>
              <button type="button" onClick={() => setOpenModal(null)} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {openModal === "beneficiados" && (
        <BeneficiariesModal
          baseId={base.id}
          companyId={companyId}
          beneficiaries={base.beneficiaries}
          editableBeneficiaryMemberIds={isPartial ? base.editableBeneficiaryMemberIds : null}
          onClose={() => setOpenModal(null)}
        />
      )}

      {openModal === "entidades" && (
        <AnalyzedEntitiesModal
          baseId={base.id}
          companyId={companyId}
          beneficiaries={base.beneficiaries}
          editableBeneficiaryMemberIds={isPartial ? base.editableBeneficiaryMemberIds : null}
          onClose={() => setOpenModal(null)}
        />
      )}

      {openModal === "gatilhos" && (
        <ConditionalTriggersModal
          baseId={base.id}
          triggers={base.conditionalTriggers}
          beneficiaries={base.beneficiaries}
          editableBeneficiaryMemberIds={isPartial ? base.editableBeneficiaryMemberIds : null}
          onClose={() => setOpenModal(null)}
        />
      )}

      {openModal === "degraus" && <TierLadderModal base={base} readOnly={isPartial} onClose={() => setOpenModal(null)} />}
    </div>
  );
}
