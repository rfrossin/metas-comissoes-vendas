import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { SeasonalityBaseForm, type EditingSeasonalityBase } from "./SeasonalityBaseForm";
import type { ScopeType } from "./ScopeSelector";

type ResultUnit = "MOEDA" | "NUMERAL";
type AnalysisType =
  | "DIAS_SEMANA"
  | "DIAS_ANO"
  | "DIAS_MES"
  | "MESES_ANO"
  | "MESES_DIAS_SEMANA"
  | "MESES_DIAS_MES"
  | "TRIMESTRES";

interface SeasonalityBase {
  id: string;
  name: string;
  analysisType: AnalysisType;
  scopeType: ScopeType;
  scopeId: string | null;
  isManual: boolean;
  startDate: string | null;
  endDate: string | null;
  scopeName: string;
  resultType: { id: string; name: string; unit: ResultUnit };
  weights: { referenceMonth: number | null; referenceKey: number; weight: string }[];
}

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  DIAS_SEMANA: "Dias da Semana",
  DIAS_ANO: "Dias do Ano",
  DIAS_MES: "Dias do Mês",
  MESES_ANO: "Meses do Ano",
  MESES_DIAS_SEMANA: "Meses do Ano e Dias da Semana (Combinada)",
  MESES_DIAS_MES: "Meses do Ano e Dias do Mês (Combinada)",
  TRIMESTRES: "Trimestres do Ano",
};

export function BasesMetasPage() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingBase, setEditingBase] = useState<EditingSeasonalityBase | null>(null);

  const { data: bases, isLoading } = useQuery({
    queryKey: ["seasonality-bases"],
    queryFn: async () => {
      const { data } = await api.get<SeasonalityBase[]>("/bases-metas");
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/bases-metas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seasonality-bases"] });
    },
  });

  function closeForm() {
    setIsCreating(false);
    setEditingBase(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bases para Metas</h1>
          <p className="text-sm text-muted-foreground">
            Sazonalidade: um ativo matemático reutilizável que decompõe uma meta macro em frações micro
            com base no peso real do histórico de Resultados.
          </p>
        </div>

        {!isCreating && !editingBase && (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            + Nova Sazonalidade
          </button>
        )}
      </div>

      {isCreating && <SeasonalityBaseForm onDone={closeForm} onCancel={closeForm} />}
      {editingBase && <SeasonalityBaseForm editingBase={editingBase} onDone={closeForm} onCancel={closeForm} />}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">Nome</th>
              <th className="px-3 py-1.5">Tipo de Análise</th>
              <th className="px-3 py-1.5">Tipo de Resultado</th>
              <th className="px-3 py-1.5">Escopo</th>
              <th className="px-3 py-1.5">Origem</th>
              <th className="px-3 py-1.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-2 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}

            {!isLoading && bases?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-2 text-muted-foreground">
                  Nenhuma base de sazonalidade cadastrada ainda.
                </td>
              </tr>
            )}

            {bases?.map((base) => (
              <tr key={base.id} className="border-t border-border">
                <td className="px-3 py-1.5">{base.name}</td>
                <td className="px-3 py-1.5">{ANALYSIS_LABELS[base.analysisType]}</td>
                <td className="px-3 py-1.5">{base.resultType.name}</td>
                <td className="px-3 py-1.5">{base.scopeName}</td>
                <td className="px-3 py-1.5">{base.isManual ? "Manual" : "Histórico"}</td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreating(false);
                        setEditingBase(base);
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(base.id)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
