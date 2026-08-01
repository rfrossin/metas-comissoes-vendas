import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";

// Mesma checagem de RequireAuth, mas sem embrulhar em AppShell (Sidebar +
// Header) — usado por telas que não devem ter chrome de navegação, como a
// impressão de Fechamento.
export function RequireAuthNoShell({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
