import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";

type ResultUnit = "MOEDA" | "NUMERAL";

interface SummaryItem {
  typeId: string;
  typeName: string;
  unit: ResultUnit;
  totalRegular: string;
  totalAdjustments: string;
  netTotal: string;
}

function formatValue(value: string, unit: ResultUnit) {
  const parsed = Number(value);

  if (unit === "MOEDA") {
    return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return parsed.toLocaleString("pt-BR");
}

export interface RealizadoLiquidoSummaryFilter {
  // 1 Membro específico (Lançamento por Membro) OU vários (Todos os
  // Resultados, resolvidos do Filtro de Hierarquia) — nunca os dois juntos.
  memberId?: string;
  memberIds?: string[];
  typeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// PASSO 11.1: passou a aceitar os mesmos filtros da tela que o hospeda (em
// vez de só 1 memberId fixo), pra refletir o filtro aplicado em "Todos os
// Resultados" — antes só existia dentro de "Lançamento por Membro".
export function RealizadoLiquidoSummary({ memberId, memberIds, typeId, dateFrom, dateTo }: RealizadoLiquidoSummaryFilter) {
  const { data: summary, isLoading } = useQuery({
    queryKey: ["realizado-liquido", memberId, memberIds, typeId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await api.get<SummaryItem[]>("/resultados/summary", {
        params: {
          memberId,
          memberIds: memberIds && memberIds.length > 0 ? memberIds.join(",") : undefined,
          typeId,
          dateFrom,
          dateTo,
        },
      });
      return data;
    },
  });

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th className="px-3 py-1.5">Indicador</th>
            <th className="px-3 py-1.5 text-right">Resultados</th>
            <th className="px-3 py-1.5 text-right">Deságios</th>
            <th className="px-3 py-1.5 text-right">Realizado Líquido</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-muted-foreground">
                Carregando...
              </td>
            </tr>
          )}

          {!isLoading && summary?.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-muted-foreground">
                Nenhum lançamento encontrado com esses filtros.
              </td>
            </tr>
          )}

          {summary?.map((item) => (
            <tr key={item.typeId} className="border-t border-border">
              <td className="px-3 py-1.5">{item.typeName}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(item.totalRegular, item.unit)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(item.totalAdjustments, item.unit)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium text-foreground">
                {formatValue(item.netTotal, item.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
