import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

interface PreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  memberName: string;
  typeName: string;
  date: string | null;
  value: number | null;
  reason: string | null;
  kind: "resultado" | "desagio" | null;
}

interface PreviewResponse {
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    newResultEntries: number;
    newAdjustments: number;
  };
}

// Achado da critique: esta era a única tabela do módulo cuja coluna de
// Valor não seguia a convenção já usada nas outras três (right-aligned +
// tabular-nums). A prévia ainda não conhece a unidade (Moeda/Numeral) do
// Tipo — só é resolvida junto da validação — então aqui é sempre um número
// pt-BR puro (sem símbolo de moeda), não um `formatValue` completo.
function formatPreviewValue(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

const TEMPLATE_HEADERS = ["Membro", "Tipo", "Data", "Valor", "Motivo"];

const TEMPLATE_EXAMPLE_ROWS = [
  ["João Silva", "Valor Vendido", "01/03/2026", "5000", ""],
  ["João Silva", "Valor Vendido", "05/03/2026", "-200", "Estorno de venda cancelada"],
];

function downloadTemplate() {
  const lines = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS].map((cols) => cols.join(";"));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "modelo-importacao-resultados.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ResultsBulkImportPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post<PreviewResponse>("/resultados/bulk-import/preview", formData);
      return data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: () => {
      setError("Não foi possível ler a planilha. Confirme se é um CSV ou Excel válido.");
      setPreview(null);
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      const validRows = preview!.rows.filter((row) => row.valid);
      await api.post("/resultados/bulk-import/commit", { rows: validRows });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-results"] });
      setPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onClose();
    },
    onError: () => {
      setError("Não foi possível confirmar a importação.");
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setError(null);
    previewMutation.mutate(file);
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Adicionar em Massa</h2>
          <p className="text-xs text-muted-foreground">
            Membro e Tipo de Resultado precisam já existir (não são criados automaticamente).
            Valor negativo é lançado como Deságio (Motivo é opcional). Data aceita AAAA-MM-DD ou
            DD/MM/AAAA.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          Fechar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={downloadTemplate}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50"
        >
          Baixar modelo (.csv)
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={handleFileChange}
          className="text-xs text-muted-foreground"
        />
      </div>

      {previewMutation.isPending && (
        <p className="text-sm text-muted-foreground">Analisando planilha...</p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 text-xs sm:grid-cols-4">
            <span>
              Linhas válidas: <strong className="text-foreground">{preview.summary.validRows}</strong>
            </span>
            <span>
              Linhas com erro:{" "}
              <strong className="text-destructive">{preview.summary.invalidRows}</strong>
            </span>
            <span>
              Novos Resultados:{" "}
              <strong className="text-foreground">{preview.summary.newResultEntries}</strong>
            </span>
            <span>
              Novos Deságios:{" "}
              <strong className="text-foreground">{preview.summary.newAdjustments}</strong>
            </span>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-2 py-1.5">Linha</th>
                  <th className="px-2 py-1.5">Membro</th>
                  <th className="px-2 py-1.5">Tipo</th>
                  <th className="px-2 py-1.5">Data</th>
                  <th className="px-2 py-1.5 text-right">Valor</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`border-t border-border ${row.valid ? "" : "bg-destructive/10"}`}
                  >
                    <td className="px-2 py-1.5">{row.rowNumber}</td>
                    <td className="px-2 py-1.5">{row.memberName}</td>
                    <td className="px-2 py-1.5">{row.typeName}</td>
                    <td className="px-2 py-1.5">{row.date ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatPreviewValue(row.value)}{" "}
                      {row.kind === "desagio" && <span className="text-muted-foreground">(deságio)</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.valid ? (
                        <span className="text-success">OK</span>
                      ) : (
                        <span className="text-destructive">{row.errors.join(" ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={preview.summary.invalidRows > 0 || commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {commitMutation.isPending ? "Importando..." : "Confirmar importação"}
            </button>

            {/* Achado da critique: o código já filtrava pra `row.valid` antes de
                comitar (linha do commitMutation abaixo), mas a UI só permitia
                confirmar com 0 erros — 1 linha ruim numa planilha grande
                bloqueava todas as válidas. Agora a ação parcial é explícita,
                não a única saída. */}
            {preview.summary.invalidRows > 0 && preview.summary.validRows > 0 && (
              <button
                type="button"
                disabled={commitMutation.isPending}
                onClick={() => commitMutation.mutate()}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
              >
                Importar apenas as {preview.summary.validRows} linhas válidas
              </button>
            )}

            {preview.summary.invalidRows > 0 && (
              <span className="text-xs text-destructive">
                {preview.summary.validRows > 0
                  ? "Corrija as linhas com erro e envie novamente, ou importe só as válidas."
                  : "Corrija as linhas com erro e envie a planilha novamente."}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
