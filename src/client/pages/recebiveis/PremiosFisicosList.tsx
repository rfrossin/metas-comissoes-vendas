import type { PremioFisicoItem, WindowStatus } from "./types";

const STATUS_LABELS: Record<WindowStatus, string> = { FECHADO: "Fechado", LIBERADO: "Aberto", PREVISTO: "Previsto" };

function formatWindow(periodStart: string, periodEndInclusive: string): string {
  const start = new Date(`${periodStart}T00:00:00.000Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const end = new Date(`${periodEndInclusive}T00:00:00.000Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return `${start} – ${end}`;
}

// Lista de Prêmios Físicos — separada do monetário (pedido explícito do
// usuário): "os benefícios de prêmios não monetários podem ficar
// separados em uma LISTA".
export function PremiosFisicosList({ items }: { items: PremioFisicoItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum Prêmio Físico conquistado neste período.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((item, index) => (
        <li key={`${item.memberId}-${item.baseName}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <div>
            <span className="font-medium text-foreground">{item.fullName}</span>
            <span className="text-muted-foreground"> — {item.descricao}</span>
            <p className="text-xs text-muted-foreground">
              {item.baseName} · {item.degrau} · {formatWindow(item.periodStart, item.periodEndInclusive)}
            </p>
          </div>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{STATUS_LABELS[item.status]}</span>
        </li>
      ))}
    </ul>
  );
}
