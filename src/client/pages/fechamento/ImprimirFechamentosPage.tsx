import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/services/api";
import { ClosingDetailView, fmt, formatMonth } from "./ClosingDetailView";
import type { ClosingDetail } from "./types";

interface ItemKey {
  memberId: string;
  referenceMonth: string;
}

// Os N membros vêm por query string (?items=memberId:referenceMonth,...),
// não por state de navegação — assim a página sobrevive a refresh e pode
// ser aberta em nova aba, igual ao antigo POST /fechamento/export-pdf
// (que aceitava uma lista livre de pares Membro+Mês).
function parseItems(raw: string | null): ItemKey[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.split(":"))
    .filter((parts): parts is [string, string] => parts.length === 2 && !!parts[0] && !!parts[1])
    .map(([memberId, referenceMonth]) => ({ memberId, referenceMonth }));
}

// Espelha summaryRowHtml do antigo fechamento-pdf.service.ts: Benefícios =
// Total - Fixo - Ajuste Manual (única regra de negócio real daquele
// arquivo, preservada aqui).
function benefitsValue(detail: ClosingDetail): number {
  return Number(detail.totalValue) - Number(detail.fixedValue) - Number(detail.manualAdjustmentValue ?? 0);
}

// Pública dentro de RequireAuthNoShell (sem AppShell) — tela dedicada a
// impressão via navegador (window.print), substituindo a geração de PDF
// via Puppeteer no servidor. Renderiza o Resumo Geral (uma linha por
// Membro+Mês) seguido de um bloco de detalhe por Membro, cada um
// começando em página nova.
export function ImprimirFechamentosPage() {
  const [searchParams] = useSearchParams();
  const items = useMemo(() => parseItems(searchParams.get("items")), [searchParams]);

  const [details, setDetails] = useState<ClosingDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (items.length === 0) {
        setIsLoading(false);
        setError("Nenhum Fechamento selecionado.");
        return;
      }
      try {
        const results = await Promise.all(
          items.map(async (item) => {
            const { data } = await api.get<ClosingDetail>(`/fechamento/${item.memberId}/${item.referenceMonth}`);
            return data;
          }),
        );
        if (cancelled) return;

        // Preserva a checagem de consistência que hoje só existe no
        // caminho do PDF (fechamento-pdf.service.ts): um Fechamento
        // reaberto entre a seleção e a impressão não deve ser impresso
        // como se ainda estivesse salvo.
        const notSaved = results.find((r) => !r.isSaved);
        if (notSaved) {
          setError(`O Fechamento de ${notSaved.memberName} não está mais salvo — reabra a tela de Fechamento e selecione novamente.`);
          setIsLoading(false);
          return;
        }

        setDetails(results);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError("Não foi possível carregar os Fechamentos selecionados.");
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    if (!isLoading && !error && details.length > 0) {
      // Pequeno atraso para garantir que o layout terminou de renderizar
      // antes do diálogo de impressão abrir.
      const timeoutId = setTimeout(() => window.print(), 300);
      return () => clearTimeout(timeoutId);
    }
  }, [isLoading, error, details]);

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground print:hidden">Carregando...</p>;
  }

  if (error) {
    return <p className="p-6 text-sm text-destructive print:hidden">{error}</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Imprimir
        </button>
      </div>

      <div className="space-y-2 break-inside-avoid">
        <h1 className="text-xl font-semibold text-foreground">Resumo de Fechamentos</h1>
        <p className="text-xs text-muted-foreground">Gerado em {new Date().toLocaleString("pt-BR")}</p>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Membro</th>
              <th className="py-1 pr-2 font-normal">Mês</th>
              <th className="py-1 pr-2 font-normal">Cargo</th>
              <th className="py-1 pr-2 font-normal">Fixo (R$)</th>
              <th className="py-1 pr-2 font-normal">Benefícios (R$)</th>
              <th className="py-1 font-normal">Total (R$)</th>
            </tr>
          </thead>
          <tbody>
            {details.map((detail) => (
              <tr key={`${detail.memberId}-${detail.referenceMonth}`} className="border-b border-border/50">
                <td className="py-1 pr-2 text-foreground">{detail.memberName}</td>
                <td className="py-1 pr-2 capitalize text-foreground">{formatMonth(detail.referenceMonth)}</td>
                <td className="py-1 pr-2 text-muted-foreground">{detail.cargoName}</td>
                <td className="py-1 pr-2 text-foreground">{fmt(detail.fixedValue)}</td>
                <td className="py-1 pr-2 text-foreground">{fmt(benefitsValue(detail).toFixed(2))}</td>
                <td className="py-1 font-medium text-foreground">{fmt(detail.totalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {details.map((detail) => (
        <div key={`${detail.memberId}-${detail.referenceMonth}`} className="detail-page">
          <ClosingDetailView detail={detail} approvals={{}} readOnly />
        </div>
      ))}
    </div>
  );
}
