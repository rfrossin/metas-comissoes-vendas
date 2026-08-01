import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BaseFormFields, PERIODICITY_LABELS } from "./BaseFormFields";
import { useReceivablesBases, useSaveReceivablesBase } from "./useReceivablesQueries";
import type { ReceivablesBaseInput, ReceivablesStatus } from "./types";

const STATUS_LABELS: Record<ReceivablesStatus, string> = {
  ATIVO: "Ativo",
  DESATIVADO: "Desativado",
  ENCERRADO: "Encerrado",
};

function emptyForm(): ReceivablesBaseInput {
  return {
    name: "",
    indicatorType: "META",
    primaryGoalCampaignId: null,
    resultTypeId: null,
    periodicity: "MENSAL",
    triggerMode: "CUMULATIVO",
    startDate: null,
    endDate: null,
  };
}

// Lista + Criação (Bases de Recebível): a configuração detalhada de cada
// Base (Beneficiados, Entidades Analisadas, Gatilhos Condicionais, Degraus,
// Simulador) vive numa tela dedicada — clicar numa linha navega para lá.
export function ManageBasesTab() {
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ReceivablesBaseInput>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [openEnded, setOpenEnded] = useState(false);

  const { data: bases, isLoading } = useReceivablesBases();
  const saveMutation = useSaveReceivablesBase();

  function openCreate() {
    setForm(emptyForm());
    setOpenEnded(false);
    setFormOpen(true);
    setError(null);
  }

  function save() {
    saveMutation.mutate(
      { id: null, input: { ...form, endDate: openEnded ? null : form.endDate } },
      {
        onSuccess: () => {
          setFormOpen(false);
          setError(null);
        },
        onError: () => setError("Não foi possível salvar: confira a Campanha/Tipo de Resultado e as datas."),
      },
    );
  }

  const canSave =
    !!form.name &&
    (form.indicatorType === "META" ? !!form.primaryGoalCampaignId : !!form.resultTypeId) &&
    (openEnded || !!form.startDate);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Crie a Base e clique numa linha para configurar Beneficiados, Entidades Analisadas, Gatilhos Condicionais, Degraus e Simulador.
        </p>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            + Nova Base de Recebível
          </button>
        )}
      </div>

      {formOpen && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Nova Base de Recebível</h2>

          <BaseFormFields form={form} setForm={setForm} openEnded={openEnded} setOpenEnded={setOpenEnded} />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              disabled={!canSave || saveMutation.isPending}
              onClick={save}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setError(null);
              }}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">Nome</th>
              <th className="px-3 py-1.5">Indicador</th>
              <th className="px-3 py-1.5">Periodicidade</th>
              <th className="px-3 py-1.5">Beneficiários</th>
              <th className="px-3 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && bases?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                  Nenhuma Base de Recebível cadastrada ainda.
                </td>
              </tr>
            )}
            {bases?.map((base) => (
              <tr
                key={base.id}
                onClick={() => navigate(`/bases-recebiveis/${base.id}`)}
                className="cursor-pointer border-t border-border hover:bg-secondary/30"
              >
                <td className="px-3 py-1.5">{base.name}</td>
                <td className="px-3 py-1.5">
                  {base.indicatorType === "META" ? `Meta: ${base.primaryGoal?.name ?? "—"}` : `Resultado: ${base.resultType?.name ?? "—"}`}
                </td>
                <td className="px-3 py-1.5">{PERIODICITY_LABELS[base.periodicity]}</td>
                <td className="px-3 py-1.5">{base._count.beneficiaries}</td>
                <td className="px-3 py-1.5">{STATUS_LABELS[base.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
