import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import type { GanhoPorMetaRow, WindowStatus } from "./types";

const STATUS_LABELS: Record<WindowStatus, string> = { FECHADO: "Fechado", LIBERADO: "Aberto", PREVISTO: "Previsto" };
const STATUS_CLASSES: Record<WindowStatus, string> = {
  FECHADO: "bg-primary/10 text-primary",
  LIBERADO: "bg-success/10 text-success",
  PREVISTO: "border border-dashed border-muted-foreground/40 text-muted-foreground",
};

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPercentOrValue(value: string, indicatorType: "META" | "RESULTADO"): string {
  const n = Number(value);
  return indicatorType === "META" ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatWindow(periodStart: string, periodEndExclusive: string): string {
  const start = new Date(`${periodStart}T00:00:00.000Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const endInclusive = new Date(new Date(`${periodEndExclusive}T00:00:00.000Z`).getTime() - 86400000).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return `${start} – ${endInclusive}`;
}

// Recebíveis por Campanha (Visão Vendedor, spec § Recebíveis/2 — nome
// exibido trocado de "Ganho por Meta" a pedido do usuário) — 1 linha por
// (Base, janela) dentro do Período filtrado. Previsto é exibido
// (transparência total, spec §4) mas não conta nos totais oficiais da tela.
//
// highlightBaseId/highlightPeriodStart (opcionais): vêm do deep-link de
// Fechamento → Recebíveis (CampaignCard, MemberClosingDetailPage.tsx) — a
// linha que bate ganha destaque visual e a tabela rola até ela ao montar.
//
// Clicar na linha (fora do destaque) abre o detalhe da Base de Recebível —
// mesma tela de "Minhas Bases" (self) ou a visão de Admin/Gestor pra
// qualquer Beneficiário (PASSO 20), conforme memberId bater ou não com o
// usuário logado.
export function GanhoPorMetaTable({
  rows,
  memberId,
  highlightBaseId,
  highlightPeriodStart,
}: {
  rows: GanhoPorMetaRow[];
  memberId: string;
  highlightBaseId?: string | null;
  highlightPeriodStart?: string | null;
}) {
  const navigate = useNavigate();
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightBaseId, highlightPeriodStart]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma Base de Recebível aplicável neste período.</p>;
  }

  function openBaseDetail(receivablesBaseId: string) {
    navigate(
      memberId === ownMemberId
        ? `/bases-recebiveis/minhas/${receivablesBaseId}`
        : `/bases-recebiveis/${receivablesBaseId}/beneficiario/${memberId}`,
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="px-3 py-1.5">Meta / Indicador</th>
            <th className="px-3 py-1.5">Período</th>
            <th className="px-3 py-1.5">Status</th>
            <th className="px-3 py-1.5">Atingimento</th>
            <th className="px-3 py-1.5">Gatilho Atual</th>
            <th className="px-3 py-1.5">Ganho (R$)</th>
            <th className="px-3 py-1.5">Próximo Degrau</th>
            <th className="px-3 py-1.5">Ganho Potencial (R$)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isHighlighted =
              !!highlightBaseId &&
              !!highlightPeriodStart &&
              row.receivablesBaseId === highlightBaseId &&
              row.periodStart.slice(0, 10) === highlightPeriodStart;
            return (
              <tr
                key={`${row.receivablesBaseId}-${row.periodStart}-${index}`}
                ref={isHighlighted ? highlightedRowRef : undefined}
                onClick={() => openBaseDetail(row.receivablesBaseId)}
                className={`cursor-pointer border-t border-border hover:bg-secondary/30 ${isHighlighted ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
              >
                <td className="px-3 py-1.5">
                  <div className="font-medium text-foreground">{row.baseName}</div>
                  <div className="text-xs text-muted-foreground">{row.indicatorLabel}</div>
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{formatWindow(row.periodStart, row.periodEndExclusive)}</td>
                <td className="px-3 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}>{STATUS_LABELS[row.status]}</span>
                </td>
                <td className="px-3 py-1.5">{fmtPercentOrValue(row.attainmentValue, row.indicatorType)}</td>
                <td className="px-3 py-1.5">
                  {row.currentTierLabel ?? "—"}
                  {!row.eligible && <p className="text-xs text-destructive">{row.blockedReason}</p>}
                </td>
                <td className="px-3 py-1.5 font-medium text-foreground">
                  {row.eligible ? fmtCurrency(row.payoutValue) : "R$ 0,00"}
                  {row.physicalPrizeDescription && <p className="text-xs text-muted-foreground">{row.physicalPrizeDescription}</p>}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {row.nextTierGap && Number(row.nextTierGap) > 0 ? `Faltam ${fmtPercentOrValue(row.nextTierGap, row.indicatorType)}` : "No topo"}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {fmtCurrency(row.topTierPotentialPayout)}
                  <p className="text-muted-foreground/70">{row.triggerMode === "CUMULATIVO" ? "Acumulado" : "Na Faixa"}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
