import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReceivablesBaseDetailView } from "./ReceivablesBaseDetailView";
import { useReceivablesBaseDetailForBeneficiary } from "./useReceivablesQueries";

// Mesma tela de detalhe de "Minhas Bases" (PASSO 18/19), reaproveitada pelo
// Admin/Gestor pra ver o Recebível de QUALQUER Beneficiário da Base de forma
// objetiva e independente — aberta a partir da tabela de Beneficiários em
// ReceivablesBaseDetailPage.tsx.
export function BeneficiaryReceivablesBaseDetailPage() {
  const { id, memberId } = useParams<{ id: string; memberId: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const { data: detail, isLoading } = useReceivablesBaseDetailForBeneficiary(id ?? null, memberId ?? null, page);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <ReceivablesBaseDetailView
      detail={detail}
      page={page}
      onPageChange={setPage}
      memberId={memberId ?? ""}
      onBack={() => navigate(`/bases-recebiveis/${id}`)}
    />
  );
}
