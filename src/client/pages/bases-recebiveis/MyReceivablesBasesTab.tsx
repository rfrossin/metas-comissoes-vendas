import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { PERIODICITY_LABELS } from "./BaseFormFields";
import { MySimulatorModal } from "./MySimulatorModal";
import { useMyReceivablesBases } from "./useReceivablesQueries";
import type { MyReceivablesBaseSummary } from "./types";

function formatCurrency(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// "Minhas Bases" (PASSO 9.10) — autoatendimento disponível para TODOS os
// papéis: as Bases de Recebível onde o próprio Membro vinculado ao usuário
// é Beneficiário, com o valor do período atual, Gatilhos e Degraus dele, e
// um Simulador escopado só a ele mesmo. Sem Membro vinculado, lista vazia.
export function MyReceivablesBasesTab() {
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const navigate = useNavigate();
  const { data: bases, isLoading } = useMyReceivablesBases();
  const [simulatorBase, setSimulatorBase] = useState<MyReceivablesBaseSummary | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Bases de Recebível das quais você é Beneficiário, com o valor projetado no período atual.
      </p>

      {!ownMemberId && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Seu usuário não está vinculado a um Membro — não há Recebíveis para exibir aqui.
        </p>
      )}

      {!!ownMemberId && isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!!ownMemberId && !isLoading && bases?.length === 0 && (
        <p className="text-sm text-muted-foreground">Você ainda não é Beneficiário de nenhuma Base de Recebível.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bases?.map((base) => (
          <div key={base.id} className="space-y-2 rounded-lg border border-border p-4">
            <div onClick={() => navigate(`/bases-recebiveis/minhas/${base.id}`)} className="cursor-pointer hover:underline">
              <h3 className="text-sm font-semibold text-foreground">{base.name}</h3>
              <p className="text-xs text-muted-foreground">
                {PERIODICITY_LABELS[base.periodicity]} · Entidade Analisada: {base.entityName}
              </p>
              <p className="text-xs text-muted-foreground">
                Período: {formatDate(base.periodStart)} até {formatDate(new Date(new Date(base.periodEndExclusive).getTime() - 86400000).toISOString())}
              </p>
            </div>

            {base.eligible ? (
              <p className="text-sm font-medium text-foreground">Ganho no período: {formatCurrency(base.payoutValue)}</p>
            ) : (
              <p className="text-sm font-medium text-destructive">R$ 0,00 ({base.blockedReason})</p>
            )}

            {base.conditionalChecks.length > 0 && (
              <div className="space-y-0.5">
                <h4 className="text-xs font-semibold text-foreground">Gatilhos Condicionais</h4>
                <ul className="space-y-0.5 text-xs">
                  {base.conditionalChecks.map((check) => (
                    <li key={check.triggerId} className={check.passed ? "text-success" : "text-destructive"}>
                      {check.passed ? "✅" : "❌"} {check.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {base.fullLadder.length > 0 && (
              <div className="space-y-0.5">
                <h4 className="text-xs font-semibold text-foreground">Degraus</h4>
                <ul className="space-y-0.5 text-xs">
                  {base.fullLadder.map((rung) => (
                    <li key={rung.order} className={rung.achieved ? "text-success" : "text-muted-foreground"}>
                      {rung.achieved ? "✅" : "○"} Degrau #{rung.order} — limiar {rung.threshold}
                      {base.indicatorType === "META" ? "%" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSimulatorBase(base)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50"
            >
              Simular
            </button>
          </div>
        ))}
      </div>

      {simulatorBase && (
        <MySimulatorModal
          baseId={simulatorBase.id}
          indicatorType={simulatorBase.indicatorType}
          memberId={ownMemberId ?? ""}
          triggers={simulatorBase.conditionalChecks.map((check) => ({
            triggerId: check.triggerId,
            label: check.label,
            verificationLevel: check.verificationLevel,
            indicatorType: check.indicatorType,
          }))}
          onClose={() => setSimulatorBase(null)}
        />
      )}
    </div>
  );
}
