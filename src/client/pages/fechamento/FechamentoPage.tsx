import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { EntityMultiPicker } from "@/pages/acompanhamento/EntityMultiPicker";
import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import {
  useClosingsList,
  useCommercialPeriods,
  useExportClosingsPdf,
  useReopenClosingBulk,
  useSaveClosingBulk,
  useSetCommercialPeriodStatus,
} from "./useFechamentoQueries";
import type { ClosingListFilters, ClosingListRow, ClosingStatus } from "./types";

interface CargoOption {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<ClosingStatus, string> = { PREVISTO: "Previsto", ABERTO: "Aberto", FECHADO: "Fechado" };
const STATUS_ORDER: ClosingStatus[] = ["PREVISTO", "ABERTO", "FECHADO"];
const DEFAULT_STATUS: ClosingStatus[] = ["ABERTO", "FECHADO"];

function fmt(value: string): string {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
}

// row.referenceMonth é um ISO completo ("2026-04-01T00:00:00.000Z"), que
// também tem ":" dentro — sem o .slice(0, 10), split(":") na hora de
// desfazer a chave (closeSelected/reopenSelected) corta a data errado e o
// backend recebe uma data inválida. Mesma fatia já usada na navegação de
// linha da tabela (`row.referenceMonth.slice(0, 10)`).
function rowKey(row: Pick<ClosingListRow, "memberId" | "referenceMonth">): string {
  return `${row.memberId}:${row.referenceMonth.slice(0, 10)}`;
}

function firstDayOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}
function lastDayOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
}

// api.post com responseType:"blob" faz o axios devolver o corpo do erro
// também como Blob (não parseado) — sem isso, um 409 do backend (ex.:
// Fechamento reaberto entre a seleção e o clique) apareceria como um erro
// genérico, escondendo a mensagem real que o backend já manda certinha.
async function extractPdfErrorMessage(error: unknown): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const text = await error.response.data.text();
      const parsed = JSON.parse(text) as { message?: string };
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // corpo do erro não era JSON — usa o fallback abaixo.
    }
  }
  return "Não foi possível exportar o PDF.";
}

// Central do Gestor Administrador (spec § Fechamento): lista todos os
// Fechamentos (Membro+Mês) dentro do filtro, com Status computado
// (Previsto/Aberto/Fechado). Abaixo, a gestão simples e separada de
// CommercialPeriod (trava mensal de escrita em Resultados).
//
// Filtros vivem na URL (useSearchParams), não em useState local: ao entrar
// num Fechamento e clicar "Voltar" (ou usar o botão Voltar do navegador), a
// tela precisa reconstruir EXATAMENTE o filtro que estava aplicado — com
// estado só em memória, todo retorno remonta o componente do zero e perde o
// filtro (bug reportado pelo usuário: "quando eu retorno... tenho que
// filtrar tudo novamente").
export function FechamentoPage() {
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const role = useAuthStore((state) => state.user?.role);
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  // PASSO 9.12: Usuário só enxerga o próprio Fechamento — nem escolhe, o
  // Escopo é fixo no próprio Membro vinculado (mesmo padrão de
  // RecebiveisPage.tsx). Nunca edita/libera (Fechar/Reabrir seguem
  // Admin/Gestor-only, ver MemberClosingDetailPage.tsx).
  const isSelfOnly = role === "OPERACIONAL";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = useMemo<ClosingStatus[]>(() => {
    if (!searchParams.has("status")) return DEFAULT_STATUS;
    const raw = searchParams.get("status") ?? "";
    return raw.split(",").filter((s): s is ClosingStatus => (STATUS_ORDER as string[]).includes(s));
  }, [searchParams]);

  const hasEntityFilter = searchParams.has("entityIds");
  // PASSO 11.5: default alinhado ao mesmo padrão de RecebiveisPage.tsx
  // ("MEMBRO"/[]) — com o picker escopado (scoped="native", abaixo), abrir
  // em "EMPRESA" por padrão mostraria "Empresa Inteira" selecionado mesmo
  // pra quem não tem esse nível de acesso.
  const entityType: ScopeType = isSelfOnly ? "MEMBRO" : ((searchParams.get("entityType") as ScopeType | null) ?? "MEMBRO");
  const entityIds = useMemo(() => {
    if (isSelfOnly) return ownMemberId ? [ownMemberId] : [];
    if (!hasEntityFilter) return [];
    const raw = searchParams.get("entityIds") ?? "";
    return raw ? raw.split(",") : [];
  }, [isSelfOnly, ownMemberId, hasEntityFilter, searchParams]);

  const cargoId = searchParams.get("cargoId");
  const search = searchParams.get("search") ?? "";
  const periodStart = searchParams.get("periodStart") || firstDayOfCurrentMonthIso();
  const periodEnd = searchParams.get("periodEnd") || lastDayOfCurrentMonthIso();

  const { data: cargos } = useQuery({
    queryKey: ["cargos"],
    queryFn: async () => {
      const { data } = await api.get<CargoOption[]>("/cargos");
      return data;
    },
  });

  const filters: ClosingListFilters = useMemo(
    () => ({ status: statusFilter, entityType, entityIds, cargoId, search: search.trim() || null, periodStart, periodEnd }),
    [statusFilter, entityType, entityIds, cargoId, search, periodStart, periodEnd],
  );

  const isAdmin = role === "ADMINISTRADOR";
  const canManageClosings = role === "ADMINISTRADOR" || role === "LIDERANCA_NO";
  const canAccess = canManageClosings || role === "OPERACIONAL";
  const { data: rows, isLoading } = useClosingsList(filters, canAccess && entityIds.length > 0);

  const { data: periods } = useCommercialPeriods();
  const setPeriodStatus = useSetCommercialPeriodStatus();
  const periodToToggle = searchParams.get("toggleMonth") || firstDayOfCurrentMonthIso();
  const currentPeriodStatus = periods?.find((p) => p.referenceMonth.slice(0, 10) === periodToToggle)?.status ?? "ABERTO";

  // PASSO 11.4: "Fechar Selecionados" — só linhas ABERTO podem ser
  // selecionadas (reprocessar uma FECHADA sobrescreveria aprovações/
  // Comentários/Ajuste Manual já salvos; PREVISTO ainda não tem período
  // encerrado); a própria linha do Gestor logado também fica de fora (mesma
  // trava de auto-fechamento de MemberClosingDetailPage.tsx, aqui aplicada
  // antes de tentar, pra não gerar um 403 confuso dentro do lote).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkSave = useSaveClosingBulk();
  const bulkReopen = useReopenClosingBulk();
  const [bulkSummary, setBulkSummary] = useState<{ action: "fechar" | "reabrir"; ok: number; failed: number } | null>(null);

  // Selecionável pra Fechar (ABERTO) OU pra Reabrir (FECHADO) — nunca
  // PREVISTO (período ainda não encerrado) nem a própria linha do Gestor
  // logado (mesma trava de auto-fechamento/auto-reabertura do backend).
  function isRowSelectable(row: ClosingListRow): boolean {
    if (row.status === "PREVISTO") return false;
    if (role === "LIDERANCA_NO" && ownMemberId && ownMemberId === row.memberId) return false;
    return true;
  }

  function toggleRowSelection(row: ClosingListRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set((rows ?? []).filter(isRowSelectable).map(rowKey)));
  }

  // Cada ação filtra a própria seleção pelo status relevante — uma seleção
  // mista (Abertos + Fechados juntos) nunca gera erro ou ambiguidade: Fechar
  // só age nos Abertos selecionados, Reabrir só nos Fechados selecionados.
  const selectedAbertoItems = (rows ?? [])
    .filter((row) => selected.has(rowKey(row)) && row.status === "ABERTO")
    .map((row) => ({ memberId: row.memberId, referenceMonth: row.referenceMonth.slice(0, 10) }));
  const selectedFechadoItems = (rows ?? [])
    .filter((row) => selected.has(rowKey(row)) && row.status === "FECHADO")
    .map((row) => ({ memberId: row.memberId, referenceMonth: row.referenceMonth.slice(0, 10) }));

  function closeSelected() {
    bulkSave.mutate(selectedAbertoItems, {
      onSuccess: (results) => {
        setBulkSummary({ action: "fechar", ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
        setSelected(new Set());
      },
    });
  }

  function reopenSelected() {
    bulkReopen.mutate(selectedFechadoItems, {
      onSuccess: (results) => {
        setBulkSummary({ action: "reabrir", ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
        setSelected(new Set());
      },
    });
  }

  const exportPdf = useExportClosingsPdf();
  const [exportError, setExportError] = useState<string | null>(null);

  function exportSelected() {
    setExportError(null);
    exportPdf.mutate(selectedFechadoItems, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `fechamentos-${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      },
      onError: async (mutationError) => setExportError(await extractPdfErrorMessage(mutationError)),
    });
  }

  // `replace: true` — cada tecla digitada no filtro não deveria empilhar uma
  // entrada nova no histórico do navegador, senão o botão Voltar teria que
  // ser clicado várias vezes para sair da tela.
  function updateParams(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  function toggleStatus(status: ClosingStatus) {
    const next = statusFilter.includes(status) ? statusFilter.filter((s) => s !== status) : [...statusFilter, status];
    updateParams({ status: next.join(",") });
  }

  if (!canAccess) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Fechamento</h1>
        <p className="text-sm text-muted-foreground">Fechamento não está disponível para o seu nível de acesso.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Fechamento</h1>
        <p className="text-sm text-muted-foreground">
          Revise, aprove ou reprove os benefícios de cada Membro por período, e conclua o Fechamento.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Período — Data Inicial</label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => updateParams({ periodStart: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Período — Data Final</label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => updateParams({ periodEnd: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Buscar por Nome</label>
            <input
              value={search}
              onChange={(e) => updateParams({ search: e.target.value || null })}
              placeholder="Nome do Membro"
              className="w-48 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Cargo</label>
            <select
              value={cargoId ?? ""}
              onChange={(e) => updateParams({ cargoId: e.target.value || null })}
              className="w-44 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="">Todos</option>
              {cargos?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Status:</span>
          {STATUS_ORDER.map((status) => (
            <label key={status} className="flex items-center gap-1.5 text-sm text-foreground">
              <input type="checkbox" checked={statusFilter.includes(status)} onChange={() => toggleStatus(status)} />
              {STATUS_LABELS[status]}
            </label>
          ))}
        </div>

        {isSelfOnly ? (
          <p className="text-xs text-muted-foreground">Mostrando o seu próprio Fechamento.</p>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground">Escopo — Membros/Líderes a mostrar (por Empresa, Canal, Departamento, Time ou Membro)</label>
            {/* PASSO 11.5: escopo nativo (mesmo resolveNativeVisibleMemberFilter que
                o backend inteiro de Fechamento já usa) — antes mostrava a árvore
                inteira da empresa sem filtro pra Admin/Gestor escolherem. */}
            <EntityMultiPicker
              companyId={companyId}
              entityType={entityType}
              entityIds={entityIds}
              onChange={(next) => updateParams({ entityType: next.entityType, entityIds: next.entityIds.join(",") })}
              scoped="native"
            />
          </div>
        )}
      </div>

      {entityIds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isSelfOnly
            ? "Seu usuário ainda não está vinculado a um Membro — peça a um Administrador para configurar."
            : "Selecione ao menos uma entidade no Escopo."}
        </p>
      )}
      {isLoading && entityIds.length > 0 && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {canManageClosings && rows && rows.some(isRowSelectable) && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
          >
            Selecionar Todos
          </button>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
              <span className="text-sm text-foreground">{selected.size} selecionado(s)</span>
              {selectedAbertoItems.length > 0 && (
                <button
                  type="button"
                  disabled={bulkSave.isPending}
                  onClick={closeSelected}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {bulkSave.isPending ? "Fechando..." : `Fechar Selecionados (${selectedAbertoItems.length})`}
                </button>
              )}
              {selectedFechadoItems.length > 0 && (
                <button
                  type="button"
                  disabled={bulkReopen.isPending}
                  onClick={reopenSelected}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
                >
                  {bulkReopen.isPending ? "Reabrindo..." : `Reabrir Selecionados (${selectedFechadoItems.length})`}
                </button>
              )}
              {selectedFechadoItems.length > 0 && (
                <button
                  type="button"
                  disabled={exportPdf.isPending}
                  onClick={exportSelected}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
                >
                  {exportPdf.isPending ? "Exportando..." : `Exportar Selecionados em PDF (${selectedFechadoItems.length})`}
                </button>
              )}
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">
                Limpar seleção
              </button>
            </div>
          )}
        </div>
      )}

      {exportError && <p className="text-sm text-destructive">{exportError}</p>}

      {bulkSummary && (
        <p className="text-sm text-muted-foreground">
          {bulkSummary.action === "fechar" ? "Fechamento" : "Reabertura"}: {bulkSummary.ok} concluído(s) com sucesso
          {bulkSummary.failed > 0 ? `, ${bulkSummary.failed} bloqueado(s) (confira status/permissão de cada um)` : ""}.
        </p>
      )}

      {rows && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                {canManageClosings && <th className="whitespace-nowrap px-3 py-1.5" />}
                <th className="whitespace-nowrap px-3 py-1.5">Período</th>
                <th className="whitespace-nowrap px-3 py-1.5">Membro</th>
                <th className="whitespace-nowrap px-3 py-1.5">Status</th>
                <th className="whitespace-nowrap px-3 py-1.5">Fixo</th>
                <th className="whitespace-nowrap px-3 py-1.5">Benefícios</th>
                <th className="whitespace-nowrap px-3 py-1.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canManageClosings ? 7 : 6} className="px-3 py-2 text-muted-foreground">
                    Nenhum Fechamento encontrado para este filtro.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => navigate(`/fechamento/${row.memberId}/${row.referenceMonth.slice(0, 10)}`)}
                  className="cursor-pointer border-t border-border hover:bg-secondary/30"
                >
                  {canManageClosings && (
                    <td className="whitespace-nowrap px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(rowKey(row))}
                        disabled={!isRowSelectable(row)}
                        onChange={() => toggleRowSelection(row)}
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-1.5 capitalize">{formatMonth(row.referenceMonth)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {row.memberName}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({row.cargoName}
                      {row.hierarchyPath ? ` — ${row.hierarchyPath.replace(/>/g, " > ")}` : ""})
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">{STATUS_LABELS[row.status]}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{fmt(row.fixedValue)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{fmt(row.benefitsValue)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium">{fmt(row.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Trava de Escrita em Resultados (por Mês)</h3>
          <p className="text-xs text-muted-foreground">
            Fechar um Mês bloqueia lançamentos/edições de Resultados e Deságios com data dentro dele — independente da revisão de Fechamento por Membro acima. Exclusivo do Administrador.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Mês</label>
              <input
                type="month"
                value={periodToToggle.slice(0, 7)}
                onChange={(e) => updateParams({ toggleMonth: `${e.target.value}-01` })}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
            <p className="text-sm text-foreground">
              Status atual: <span className="font-medium">{currentPeriodStatus === "FECHADO" ? "Fechado" : "Aberto"}</span>
            </p>
            <button
              type="button"
              disabled={setPeriodStatus.isPending}
              onClick={() => setPeriodStatus.mutate({ referenceMonth: periodToToggle, status: currentPeriodStatus === "FECHADO" ? "ABERTO" : "FECHADO" })}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
            >
              {currentPeriodStatus === "FECHADO" ? "Reabrir Mês" : "Fechar Mês"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
