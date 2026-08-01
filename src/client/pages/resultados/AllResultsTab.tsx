import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { useScopedEntityOptions } from "@/pages/metas/useScopedEntityOptions";
import { EMPTY_HIERARCHY_FILTER, HierarchyFilter, matchesHierarchyFilter, useHierarchyAncestorMaps } from "@/pages/metas/HierarchyFilter";
import type { ResultType } from "./ResultTypesSection";
import { BulkEditPanel } from "./BulkEditPanel";
import { ResultsBulkImportPanel } from "./ResultsBulkImportPanel";
import { RealizadoLiquidoSummary } from "./RealizadoLiquidoSummary";

type ResultUnit = "MOEDA" | "NUMERAL";
type Kind = "resultado" | "desagio";

export interface ResultRow {
  kind: Kind;
  id: string;
  date: string;
  memberId: string;
  memberName: string;
  typeId: string;
  typeName: string;
  unit: ResultUnit;
  value: string;
  reason: string | null;
}

interface ListResponse {
  rows: ResultRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

function formatValue(value: string, unit: ResultUnit) {
  const parsed = Number(value);

  if (unit === "MOEDA") {
    return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return parsed.toLocaleString("pt-BR");
}

function selectionKey(row: Pick<ResultRow, "kind" | "id">) {
  return `${row.kind}:${row.id}`;
}

const emptyFilters = {
  memberId: "",
  typeId: "",
  dateFrom: "",
  dateTo: "",
  kind: "" as "" | Kind,
};

export function AllResultsTab() {
  const companyId = useAuthStore((state) => state.user!.companyId);
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(emptyFilters);
  const [hierarchyFilter, setHierarchyFilter] = useState(EMPTY_HIERARCHY_FILTER);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PASSO 9.5: dropdown de Membro só mostra quem o usuário pode VER (modo
  // "visible" — as LINHAS retornadas por /resultados/all já eram filtradas
  // corretamente no servidor via resolveVisibleMemberFilter; só o dropdown
  // do filtro estava oferecendo a empresa inteira).
  const { options } = useScopedEntityOptions(companyId, "visible");
  const { teamById, departmentById } = useHierarchyAncestorMaps(options);
  const members = useMemo(
    () => options.MEMBRO.filter((member) => matchesHierarchyFilter(member, teamById, departmentById, hierarchyFilter)),
    [options.MEMBRO, teamById, departmentById, hierarchyFilter],
  );

  const { data: types } = useQuery({
    queryKey: ["result-types"],
    queryFn: async () => {
      const { data } = await api.get<ResultType[]>("/resultados/types");
      return data;
    },
  });

  // PASSO 11.1: o Filtro de Hierarquia (Canal/Departamento/Time) antes só
  // restringia as opções do <select> de Membro, sem chegar no servidor —
  // quando nenhum Membro específico está selecionado, resolve a lista de
  // ids visível+filtrada (já calculada em `members` abaixo) e manda como
  // memberIds, pro Resumo e a tabela ficarem consistentes com o que o
  // usuário vê no filtro. O servidor sempre intersecciona com o escopo
  // visível dele mesmo, nunca confia cegamente nessa lista.
  const isHierarchyFilterActive = Boolean(hierarchyFilter.channelId || hierarchyFilter.departmentId || hierarchyFilter.teamId);
  const memberIdsForFilter = !filters.memberId && isHierarchyFilterActive ? members.map((member) => member.entityId) : undefined;

  const { data: list, isLoading } = useQuery({
    queryKey: ["all-results", filters, memberIdsForFilter, page],
    queryFn: async () => {
      const { data } = await api.get<ListResponse>("/resultados/all", {
        params: {
          memberId: filters.memberId || undefined,
          memberIds: memberIdsForFilter && memberIdsForFilter.length > 0 ? memberIdsForFilter.join(",") : undefined,
          typeId: filters.typeId || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          kind: filters.kind || undefined,
          page,
          pageSize: 50,
        },
      });
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (row: ResultRow) =>
      row.kind === "resultado"
        ? api.delete(`/resultados/entries/${row.id}`)
        : api.delete(`/resultados/adjustments/${row.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-results"] });
      setError(null);
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível excluir este lançamento."));
    },
  });

  function handleDeleteRow(row: ResultRow) {
    const label = row.kind === "resultado" ? "este Resultado" : "este Deságio";
    const detail = `${row.memberName}, ${row.date.slice(0, 10)}, ${formatValue(row.value, row.unit)}`;

    if (!window.confirm(`Excluir ${label} (${detail})? Essa ação não pode ser desfeita.`)) {
      return;
    }

    deleteMutation.mutate(row);
  }

  const bulkDeleteMutation = useMutation({
    mutationFn: () => {
      const entryIds = selectionIds("resultado");
      const adjustmentIds = selectionIds("desagio");
      return api.post("/resultados/bulk-delete", { entryIds, adjustmentIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-results"] });
      setSelected(new Set());
      setError(null);
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError, "Não foi possível excluir os lançamentos selecionados."));
    },
  });

  function handleBulkDelete() {
    const count = selected.size;

    if (!window.confirm(`Excluir ${count} ${count === 1 ? "lançamento selecionado" : "lançamentos selecionados"}? Essa ação não pode ser desfeita.`)) {
      return;
    }

    bulkDeleteMutation.mutate();
  }

  function selectionIds(kind: Kind) {
    return [...selected]
      .filter((key) => key.startsWith(`${kind}:`))
      .map((key) => key.slice(kind.length + 1));
  }

  function updateFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setPage(1);
  }

  function toggleRow(row: ResultRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = selectionKey(row);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  const rows = list?.rows ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(selectionKey(row)));

  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);

      if (allOnPageSelected) {
        rows.forEach((row) => next.delete(selectionKey(row)));
      } else {
        rows.forEach((row) => next.add(selectionKey(row)));
      }

      return next;
    });
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.totalCount / list.pageSize)) : 1;
  const selectedEntryIds = useMemo(() => selectionIds("resultado"), [selected]);
  const selectedAdjustmentIds = useMemo(() => selectionIds("desagio"), [selected]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(selectionKey(row))), [rows, selected]);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Todos os Resultados</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <HierarchyFilter companyId={companyId} scoped="visible" value={hierarchyFilter} onChange={setHierarchyFilter} />

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="all-results-membro">
              Membro
            </label>
            <select
              id="all-results-membro"
              value={filters.memberId}
              onChange={(event) => updateFilter("memberId", event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              {members.map((member) => (
                <option key={member.entityId} value={member.entityId}>
                  {member.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="all-results-tipo">
              Tipo de Resultado
            </label>
            <select
              id="all-results-tipo"
              value={filters.typeId}
              onChange={(event) => updateFilter("typeId", event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              {types?.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="all-results-date-from">
              Período de
            </label>
            <input
              id="all-results-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => updateFilter("dateFrom", event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="all-results-date-to">
              até
            </label>
            <input
              id="all-results-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(event) => updateFilter("dateTo", event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="all-results-kind">
              Tipo de Lançamento
            </label>
            <select
              id="all-results-kind"
              value={filters.kind}
              onChange={(event) => updateFilter("kind", event.target.value as "" | Kind)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              <option value="resultado">Só Resultados</option>
              <option value="desagio">Só Deságios</option>
            </select>
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary/50"
          >
            Limpar filtros
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsImportOpen((prev) => !prev)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
        >
          {isImportOpen ? "Fechar importação" : "Adicionar em Massa"}
        </button>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Resumo (Realizado Líquido)</h3>
        <RealizadoLiquidoSummary
          memberId={filters.memberId || undefined}
          memberIds={memberIdsForFilter}
          typeId={filters.typeId || undefined}
          dateFrom={filters.dateFrom || undefined}
          dateTo={filters.dateTo || undefined}
        />
      </div>

      {isImportOpen && <ResultsBulkImportPanel onClose={() => setIsImportOpen(false)} />}

      {selected.size > 0 && (
        <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-foreground">{selected.size} selecionado(s)</span>
            <button
              type="button"
              onClick={() => setIsBulkEditOpen((prev) => !prev)}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-secondary/50"
            >
              Editar campo
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="rounded-md border border-destructive px-3 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Excluir selecionados
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-muted-foreground hover:underline"
            >
              Limpar seleção
            </button>
          </div>

          {isBulkEditOpen && (
            <BulkEditPanel
              entryIds={selectedEntryIds}
              adjustmentIds={selectedAdjustmentIds}
              rows={selectedRows}
              onDone={() => {
                setIsBulkEditOpen(false);
                setSelected(new Set());
              }}
              onCancel={() => setIsBulkEditOpen(false)}
            />
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAllOnPage}
                  aria-label={allOnPageSelected ? "Desmarcar todos os resultados desta página" : "Selecionar todos os resultados desta página"}
                />
              </th>
              <th className="px-3 py-1.5">Data</th>
              <th className="px-3 py-1.5">Membro</th>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Lançamento</th>
              <th className="px-3 py-1.5">Valor</th>
              <th className="px-3 py-1.5">Motivo</th>
              <th className="px-3 py-1.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-2 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-2 text-muted-foreground">
                  Nenhum resultado encontrado com esses filtros.
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const rowLabel = `${row.kind === "resultado" ? "Resultado" : "Deságio"} de ${row.memberName} em ${row.date.slice(0, 10)}, ${formatValue(row.value, row.unit)}`;

              return (
                <tr key={selectionKey(row)} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(selectionKey(row))}
                      onChange={() => toggleRow(row)}
                      aria-label={`Selecionar ${rowLabel}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">{row.date.slice(0, 10)}</td>
                  <td className="px-3 py-1.5">{row.memberName}</td>
                  <td className="px-3 py-1.5">{row.typeName}</td>
                  <td className="px-3 py-1.5">
                    {row.kind === "resultado" ? (
                      <span className="text-foreground">Resultado</span>
                    ) : (
                      <span className="text-muted-foreground">Deságio</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(row.value, row.unit)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.reason ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => handleDeleteRow(row)}
                      aria-label={`Excluir ${rowLabel}`}
                      className="text-xs text-destructive hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {list && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{list.totalCount} resultado(s) no total</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
            >
              Anterior
            </button>
            <span>
              Página {list.page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
