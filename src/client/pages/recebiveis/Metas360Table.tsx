import type { Metas360Row } from "./types";

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Visão 360 das Metas (pedido explícito do usuário) — pivot por Base/Meta
// (não por Membro): quanto cada Meta gerou de benefício para os
// Beneficiados selecionados, monetário e em nº de Prêmios Físicos.
export function Metas360Table({ rows }: { rows: Metas360Row[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma Meta gerou benefício neste período.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="px-3 py-1.5">Meta / Base</th>
            <th className="px-3 py-1.5">Beneficiados</th>
            <th className="px-3 py-1.5">Total Gerado (R$)</th>
            <th className="px-3 py-1.5">Prêmios Físicos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.receivablesBaseId} className="border-t border-border">
              <td className="px-3 py-1.5">
                <div className="font-medium text-foreground">{row.baseName}</div>
                <div className="text-xs text-muted-foreground">{row.indicatorLabel}</div>
              </td>
              <td className="px-3 py-1.5">{row.beneficiariosCount}</td>
              <td className="px-3 py-1.5 font-medium text-foreground">{fmtCurrency(row.totalGerado)}</td>
              <td className="px-3 py-1.5">{row.premiosFisicosCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
