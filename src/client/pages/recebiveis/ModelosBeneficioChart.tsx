import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ModeloBeneficioRow, RewardType } from "./types";

// Cores fixas por Modelo de Benefício — só 4 categorias, sempre nesta
// ordem (regra do skill dataviz: categórico em ordem fixa, nunca ciclado).
const REWARD_COLORS: Record<RewardType, string> = {
  PERCENT_FIXO: "#2a78d6",
  PERCENT_RESULTADO: "#008300",
  VALOR_FIXO: "#eda100",
  PREMIO_FISICO: "#4a3aa7",
};
const REWARD_LABELS: Record<RewardType, string> = {
  PERCENT_FIXO: "% sobre o Fixo",
  PERCENT_RESULTADO: "% sobre o Resultado",
  VALOR_FIXO: "Valor Fixo",
  PREMIO_FISICO: "Prêmio Físico",
};

function fmtCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Modelos de Benefício (pedido explícito do usuário): quanto cada tipo de
// recompensa (RewardType) contribuiu para o total dos Beneficiados
// selecionados — Prêmio Físico não tem valor monetário, só contagem.
export function ModelosBeneficioChart({ rows }: { rows: ModeloBeneficioRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum Benefício computado neste período.</p>;
  }

  const monetary = rows.filter((r) => r.rewardType !== "PREMIO_FISICO" && Number(r.total) > 0);
  const pieData = monetary.map((r) => ({ name: REWARD_LABELS[r.rewardType], value: Number(r.total), rewardType: r.rewardType }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {pieData.length > 0 ? (
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                {pieData.map((entry) => (
                  <Cell key={entry.rewardType} fill={REWARD_COLORS[entry.rewardType]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => fmtCurrency(String(value))} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sem valores monetários para o gráfico.</p>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-3 py-1.5">Tipo</th>
              <th className="px-3 py-1.5">Valor Total (R$)</th>
              <th className="px-3 py-1.5">Ocorrências</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rewardType} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REWARD_COLORS[row.rewardType] }} />
                  {REWARD_LABELS[row.rewardType]}
                </td>
                <td className="px-3 py-1.5">{row.rewardType === "PREMIO_FISICO" ? "—" : fmtCurrency(row.total)}</td>
                <td className="px-3 py-1.5">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
