import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatFullHierarchy } from "./hierarchy";
import { MySimulatorModal } from "./MySimulatorModal";
import type { BeneficiaryRow, ConditionalTriggerRow, IndicatorType } from "./types";

function applicableTriggerCount(triggers: ConditionalTriggerRow[], memberId: string): number {
  return triggers.filter((trigger) => trigger.applicableMemberIds.length === 0 || trigger.applicableMemberIds.includes(memberId)).length;
}

// Tabela de resumo por Beneficiário na tela de edição de Base (Admin/Gestor)
// — substitui o antigo card "Simulador" (seletor genérico): cada linha já
// sabe seu Beneficiário, então o botão Simulador da linha não precisa de
// seletor. Clicar na linha (fora do botão) abre ReceivablesBaseDetailView
// para aquele Beneficiário específico (BeneficiaryReceivablesBaseDetailPage.tsx).
export function BeneficiariesSummaryTable({
  baseId,
  indicatorType,
  beneficiaries,
  conditionalTriggers,
  access,
  editableBeneficiaryMemberIds,
}: {
  baseId: string;
  indicatorType: IndicatorType;
  beneficiaries: BeneficiaryRow[];
  conditionalTriggers: ConditionalTriggerRow[];
  access: "FULL" | "PARTIAL";
  editableBeneficiaryMemberIds: string[];
}) {
  const navigate = useNavigate();
  const [simulatorMemberId, setSimulatorMemberId] = useState<string | null>(null);

  const simulatorBeneficiary = beneficiaries.find((b) => b.memberId === simulatorMemberId) ?? null;

  if (beneficiaries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum Beneficiário cadastrado ainda.</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Beneficiários</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Hierarquia do Beneficiado</th>
              <th className="px-3 py-2 font-medium">Hierarquia da Entidade Analisada</th>
              <th className="px-3 py-2 font-medium">Gatilhos Condicionais</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {beneficiaries.map((beneficiary) => {
              const owned = access !== "PARTIAL" || editableBeneficiaryMemberIds.includes(beneficiary.memberId);
              return (
                <tr
                  key={beneficiary.memberId}
                  onClick={() => navigate(`/bases-recebiveis/${baseId}/beneficiario/${beneficiary.memberId}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/30"
                >
                  <td className="px-3 py-2 font-medium text-foreground">{beneficiary.member.fullName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatFullHierarchy(beneficiary.memberHierarchyPath, "MEMBRO", beneficiary.member.fullName)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatFullHierarchy(beneficiary.entityHierarchyPath, beneficiary.entityType, beneficiary.entityName)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{applicableTriggerCount(conditionalTriggers, beneficiary.memberId)} Gatilho(s)</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={!owned}
                      title={owned ? undefined : "Somente consulta"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSimulatorMemberId(beneficiary.memberId);
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50 disabled:opacity-50"
                    >
                      {owned ? "Simular" : "🔒 Simular"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {simulatorBeneficiary && (
        <MySimulatorModal
          baseId={baseId}
          indicatorType={indicatorType}
          memberId={simulatorBeneficiary.memberId}
          triggers={conditionalTriggers
            .filter((trigger) => trigger.applicableMemberIds.length === 0 || trigger.applicableMemberIds.includes(simulatorBeneficiary.memberId))
            .map((trigger) => ({
              triggerId: trigger.id,
              label: trigger.indicatorType === "META" ? (trigger.conditionalGoal?.name ?? "—") : (trigger.resultType?.name ?? "—"),
              verificationLevel: trigger.verificationLevel,
              indicatorType: trigger.indicatorType,
            }))}
          onClose={() => setSimulatorMemberId(null)}
        />
      )}
    </div>
  );
}
