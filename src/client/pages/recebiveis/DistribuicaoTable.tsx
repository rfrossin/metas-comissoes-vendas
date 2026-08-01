import { Fragment, useState } from "react";
import { useMemberGanhoPorMeta } from "./useRecebiveisQueries";
import { GanhoPorMetaTable } from "./GanhoPorMetaTable";
import type { DistribuicaoRow } from "./types";

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function DrilldownRow({ memberId, periodStart, periodEnd }: { memberId: string; periodStart: string; periodEnd: string }) {
  const { data, isLoading } = useMemberGanhoPorMeta(memberId, periodStart, periodEnd);
  return (
    <tr>
      <td colSpan={6} className="bg-secondary/20 px-3 py-3">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando...</p>}
        {data && <GanhoPorMetaTable rows={data.rows} memberId={memberId} />}
      </td>
    </tr>
  );
}

// Distribuição (Visão Gestor, spec § Recebíveis/3) — 1 linha por Membro do
// grupo selecionado. Clique na linha expande inline a Ganho por Meta
// daquele Membro (drill-down sob demanda, mesmo padrão de HierarquiaTable
// do Acompanhamento).
export function DistribuicaoTable({ rows, periodStart, periodEnd }: { rows: DistribuicaoRow[]; periodStart: string; periodEnd: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum Membro no Escopo selecionado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="px-3 py-1.5">Membro</th>
            <th className="px-3 py-1.5">Cargo</th>
            <th className="px-3 py-1.5">Salário Fixo</th>
            <th className="px-3 py-1.5">Comissão (Fechado+Aberto)</th>
            <th className="px-3 py-1.5">Prêmios Físicos</th>
            <th className="px-3 py-1.5">Custo Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.memberId}>
              <tr
                onClick={() => setExpandedId(expandedId === row.memberId ? null : row.memberId)}
                className={`cursor-pointer border-t border-border ${expandedId === row.memberId ? "bg-secondary/40" : "hover:bg-secondary/20"}`}
              >
                <td className="px-3 py-1.5 font-medium text-foreground">{row.fullName}</td>
                <td className="px-3 py-1.5">{row.cargoName}</td>
                <td className="px-3 py-1.5">{fmtCurrency(row.salarioFixo)}</td>
                <td className="px-3 py-1.5">{fmtCurrency(row.comissao)}</td>
                <td className="px-3 py-1.5">{row.premiosFisicosCount}</td>
                <td className="px-3 py-1.5 font-medium text-foreground">{fmtCurrency(row.custoTotal)}</td>
              </tr>
              {expandedId === row.memberId && <DrilldownRow memberId={row.memberId} periodStart={periodStart} periodEnd={periodEnd} />}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
