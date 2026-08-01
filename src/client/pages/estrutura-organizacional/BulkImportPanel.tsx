import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

type ResponsibleLevel = "EMPRESA" | "CANAL" | "DEPARTAMENTO" | "TIME";

interface PreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  channelName: string | null;
  departmentName: string | null;
  teamName: string | null;
  memberName: string;
  cargoName: string;
  customFixedSalary: number | null;
  isResponsible: boolean;
  responsibleLevel: ResponsibleLevel | null;
  willCreateChannel: boolean;
  willCreateDepartment: boolean;
  willCreateTeam: boolean;
  willCreateCargo: boolean;
}

interface PreviewResponse {
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    newChannels: number;
    newDepartments: number;
    newTeams: number;
    newCargos: number;
    newMembers: number;
    newResponsibles: number;
  };
}

const TEMPLATE_HEADERS = [
  "Canal",
  "Departamento",
  "Time",
  "Nome",
  "Cargo",
  "SalarioCustomizado",
  "Responsavel",
  "NivelResponsavel",
];

// Tipo do Membro é derivado da coluna Responsavel: "Sim" vira Gestor (lidera
// a hierarquia indicada em NivelResponsavel); o resto vira Operador.
const TEMPLATE_EXAMPLE_ROWS = [
  ["Comercial", "Inside Sales", "SDR Norte", "João Silva", "Vendedor", "", "Não", ""],
  ["Comercial", "Inside Sales", "", "Maria Souza", "Coordenador", "", "Sim", "TIME"],
  ["Comercial", "", "", "Carlos Diretor", "Diretor de Canal", "", "Sim", "CANAL"],
];

function downloadTemplate() {
  const lines = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS].map((cols) => cols.join(";"));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "modelo-importacao-estrutura.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BulkImportPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post<PreviewResponse>(
        "/estrutura-organizacional/bulk-import/preview",
        formData,
      );
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
      await api.post("/estrutura-organizacional/bulk-import/commit", { rows: validRows });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-tree"] });
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
          <h2 className="text-sm font-semibold text-foreground">Importar planilha</h2>
          <p className="text-xs text-muted-foreground">
            Cadastre Canal, Departamento, Time, Membros e Responsáveis de uma vez. Canais,
            Departamentos, Times e Cargos citados que ainda não existirem são criados
            automaticamente.
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
              Novos Canais: <strong className="text-foreground">{preview.summary.newChannels}</strong>
            </span>
            <span>
              Novos Departamentos:{" "}
              <strong className="text-foreground">{preview.summary.newDepartments}</strong>
            </span>
            <span>
              Novos Times: <strong className="text-foreground">{preview.summary.newTeams}</strong>
            </span>
            <span>
              Novos Cargos: <strong className="text-foreground">{preview.summary.newCargos}</strong>
            </span>
            <span>
              Novos Membros: <strong className="text-foreground">{preview.summary.newMembers}</strong>
            </span>
            <span>
              Novos Responsáveis:{" "}
              <strong className="text-foreground">{preview.summary.newResponsibles}</strong>
            </span>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-2 py-1.5">Linha</th>
                  <th className="px-2 py-1.5">Nome</th>
                  <th className="px-2 py-1.5">Cargo</th>
                  <th className="px-2 py-1.5">Canal / Depto / Time</th>
                  <th className="px-2 py-1.5">Responsável</th>
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
                    <td className="px-2 py-1.5">
                      {row.cargoName} {row.willCreateCargo && <span className="text-primary">(novo)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {[row.channelName, row.departmentName, row.teamName].filter(Boolean).join(" → ") ||
                        "—"}
                    </td>
                    <td className="px-2 py-1.5">{row.isResponsible ? row.responsibleLevel : "—"}</td>
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

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={preview.summary.invalidRows > 0 || commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {commitMutation.isPending ? "Importando..." : "Confirmar importação"}
            </button>

            {preview.summary.invalidRows > 0 && (
              <span className="text-xs text-destructive">
                Corrija as linhas com erro e envie a planilha novamente.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
