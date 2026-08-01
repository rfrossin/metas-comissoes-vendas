import type { RecebiveisOverview } from "./types";

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// 4 tiles (Bases de Recebível / Recebíveis, macroambiente 8): Benefícios
// Totais (Fechado+Aberto — as "somatórias oficiais"), Fixo Total, Nº de
// Prêmios Físicos, e Previsto (janela em andamento, estilo diferenciado —
// informação à parte, NUNCA somada aos totais oficiais).
export function RecebiveisKpiCardsRow({ kpis }: { kpis: RecebiveisOverview["kpis"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Benefícios Totais</p>
        <p className="text-xl font-semibold text-foreground">{fmtCurrency(kpis.beneficiosTotal)}</p>
        <p className="text-xs text-muted-foreground">
          {fmtCurrency(kpis.fechadoTotal)} Fechado + {fmtCurrency(kpis.liberadoTotal)} Aberto
        </p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Fixo Total</p>
        <p className="text-xl font-semibold text-foreground">{fmtCurrency(kpis.fixoTotal)}</p>
        <p className="text-xs text-muted-foreground">Salário dos Beneficiados no período</p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Prêmios Físicos</p>
        <p className="text-xl font-semibold text-foreground">{kpis.premiosFisicosCount}</p>
        <p className="text-xs text-muted-foreground">Ver lista abaixo</p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-dashed border-muted-foreground/40 bg-secondary/20 p-3">
        <p className="text-xs text-muted-foreground">Previsto (não contabilizado)</p>
        <p className="text-xl font-semibold text-muted-foreground">{fmtCurrency(kpis.previstoTotal)}</p>
        <p className="text-xs text-muted-foreground">Período em andamento — fora das somatórias oficiais</p>
      </div>
    </div>
  );
}
