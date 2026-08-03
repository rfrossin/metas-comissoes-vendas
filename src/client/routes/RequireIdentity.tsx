import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useIdentityStore } from "@/store/identity.store";

// Sem AppShell de propósito (diferente de RequireAuth): quem está aqui não
// tem empresa, então o menu do sistema — Metas, Fechamento, Recebíveis —
// não teria para onde apontar. A tela é autocontida.
export function RequireIdentity({ children }: { children: ReactNode }) {
  const token = useIdentityStore((state) => state.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
