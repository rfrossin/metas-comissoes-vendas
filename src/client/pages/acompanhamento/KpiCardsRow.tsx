import { formatMetricValue, formatPercent, type ResultUnit } from "./format";
import type { AcompanhamentoOverview } from "./types";

function fmtDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function KpiTile({
  title,
  realizado,
  meta,
  percentMeta,
  unit,
}: {
  title: string;
  realizado: string;
  meta: string;
  percentMeta: string | null;
  unit: ResultUnit | undefined;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-xl font-semibold text-foreground">{formatMetricValue(realizado, unit)}</p>
      <p className="text-xs text-muted-foreground">
        Meta: {formatMetricValue(meta, unit)} ·{" "}
        <span className={percentMeta !== null && Number(percentMeta) >= 1 ? "text-success" : "text-muted-foreground"}>
          {formatPercent(percentMeta)}
        </span>
      </p>
    </div>
  );
}

export function KpiCardsRow({
  kpis,
  unit,
  realizadoAte,
}: {
  kpis: AcompanhamentoOverview["kpis"];
  unit: ResultUnit | undefined;
  realizadoAte: string;
}) {
  return (
    <div className="space-y-3">
      {/* As 4 métricas curtas (2 linhas de conteúdo) formam sua própria grade —
          separada do card "Acumulado" abaixo, que tem o dobro de linhas e
          quebrava a largura das colunas quando dividia grade com as outras 4
          (achado da critique: 5 colunas + sidebar fixa estourava em 1366px e
          no mobile). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile title="Realizado do Dia" realizado={kpis.dia.realizado} meta={kpis.dia.meta} percentMeta={kpis.dia.percentMeta} unit={unit} />
        <KpiTile
          title="Realizado da Semana"
          realizado={kpis.semana.realizado}
          meta={kpis.semana.meta}
          percentMeta={kpis.semana.percentMeta}
          unit={unit}
        />
        <KpiTile
          title="Realizado do Mês"
          realizado={kpis.mes.realizado}
          meta={kpis.mes.meta}
          percentMeta={kpis.mes.percentMeta}
          unit={unit}
        />
        <KpiTile
          title="Realizado do Trimestre"
          realizado={kpis.trimestre.realizado}
          meta={kpis.trimestre.meta}
          percentMeta={kpis.trimestre.percentMeta}
          unit={unit}
        />
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Realizado Acumulado — até {fmtDate(realizadoAte)}</p>
        <p className="text-xl font-semibold text-foreground">{formatMetricValue(kpis.corrido.realizadoCorrido, unit)}</p>
        <p className="text-xs text-muted-foreground">
          Meta Total: {formatMetricValue(kpis.corrido.metaTotalPeriodo, unit)} · {formatPercent(kpis.corrido.percentMeta)}
        </p>
        <p className="text-xs text-muted-foreground">% Esperado até a Data: {formatPercent(kpis.corrido.percentEsperado)}</p>
        <p
          className={`text-xs font-medium ${
            Number(kpis.corrido.valorCobertura) >= 0 ? "text-success" : "text-destructive"
          }`}
        >
          Ritmo vs. Meta: {formatMetricValue(kpis.corrido.valorCobertura, unit)}
        </p>
      </div>
    </div>
  );
}
