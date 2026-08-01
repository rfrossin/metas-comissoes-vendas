import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/services/api";

interface ReforecastPeriod {
  period: number;
  value: string;
}

interface ReforecastResult {
  annualTarget: string;
  realizedAccumulated: string;
  balance: string;
  remainingPeriods: number;
  pressureFactor: string;
  recalculatedPeriods: ReforecastPeriod[];
}

interface RecalculatedLineResult {
  lineId: string;
  entityType: string;
  entityId: string;
}

function formatCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export function ReforecastPanel({
  lineId,
  onClose,
  onApplied,
  initialReferenceDate,
}: {
  lineId: string;
  onClose: () => void;
  onApplied?: (result: RecalculatedLineResult) => void;
  // Filtro "Data de Corte" do Acompanhamento (spec § Acompanhamento/1) —
  // opcional: sem ele, o painel continua abrindo com a data de hoje.
  initialReferenceDate?: string;
}) {
  const [referenceDate, setReferenceDate] = useState(initialReferenceDate ?? new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<ReforecastResult>(`/metas/lines/${lineId}/reforecast/preview`, {
        referenceDate,
      });
      return data;
    },
    onError: () => setError("Não foi possível calcular o reforecast para esta data."),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<RecalculatedLineResult>(`/metas/lines/${lineId}/reforecast/apply`, {
        referenceDate,
      });
      return data;
    },
    onSuccess: (data) => {
      setError(null);
      onApplied?.(data);
    },
    onError: () => setError("Não foi possível criar a Meta Recalculada para esta data."),
  });

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-foreground">Reforecast</h5>
          <p className="text-xs text-muted-foreground">
            Recalibração do saldo restante do ano a partir da data informada — somente cálculo, não altera a
            meta gravada.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:underline">
          Fechar
        </button>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Data de Referência</label>
          <input
            type="date"
            value={referenceDate}
            onChange={(event) => setReferenceDate(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {mutation.isPending ? "Calculando..." : "Calcular"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {mutation.data && (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Meta Anual</p>
              <p className="font-medium text-foreground">{formatCurrency(mutation.data.annualTarget)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Realizado Acumulado</p>
              <p className="font-medium text-foreground">{formatCurrency(mutation.data.realizedAccumulated)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saldo Restante</p>
              <p className="font-medium text-foreground">{formatCurrency(mutation.data.balance)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fator de Pressão</p>
              <p className={`font-medium ${Number(mutation.data.pressureFactor) > 1 ? "text-destructive" : "text-success"}`}>
                {Number(mutation.data.pressureFactor).toFixed(2)}x
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-2 py-1">Período</th>
                  <th className="px-2 py-1">Meta Recalculada</th>
                </tr>
              </thead>
              <tbody>
                {mutation.data.recalculatedPeriods.map((p) => (
                  <tr key={p.period} className="border-t border-border">
                    <td className="px-2 py-1">{p.period}</td>
                    <td className="px-2 py-1">{formatCurrency(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 rounded-md border border-dashed border-border p-2">
            <p className="text-xs text-muted-foreground">
              Ao criar, a linha atual é desativada a partir de {referenceDate} e uma nova linha nasce cobrindo o
              período completo da campanha: até essa data, a meta passa a valer o que já foi Realizado (100% de
              atingimento); daí em diante, vale a Meta Recalculada acima.
            </p>
            <button
              type="button"
              disabled={applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {applyMutation.isPending ? "Criando..." : "Criar Meta Recalculada"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
