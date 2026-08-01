import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { ReceivablesBaseDetailView } from "./ReceivablesBaseDetailView";
import { useMyReceivablesBaseDetail } from "./useReceivablesQueries";

// Wrapper de autoatendimento ("Minhas Bases", PASSO 18/19) — resolve o
// próprio Membro logado e delega toda a UI para ReceivablesBaseDetailView
// (compartilhada com a visão de Admin/Gestor, ver BeneficiaryReceivablesBaseDetailPage.tsx).
export function MyReceivablesBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const [page, setPage] = useState(0);

  const { data: detail, isLoading } = useMyReceivablesBaseDetail(id ?? null, page);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <ReceivablesBaseDetailView
      detail={detail}
      page={page}
      onPageChange={setPage}
      memberId={ownMemberId ?? ""}
      onBack={() => navigate("/bases-recebiveis?tab=minhas")}
    />
  );
}
