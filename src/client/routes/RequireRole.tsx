import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore, type PermissionLevel } from "@/store/auth.store";

// Usar DENTRO de RequireAuth (que já garante token + AppShell) — só decide
// se o papel do usuário logado pode acessar esta rota. O filtro fino de
// DADO (quais Campanhas, quais Membros, etc.) continua vindo do backend;
// isto aqui é só "este módulo inteiro existe para este papel ou não".
export function RequireRole({ allow, children }: { allow: PermissionLevel[]; children: ReactNode }) {
  const role = useAuthStore((state) => state.user?.role);

  if (!role || !allow.includes(role)) {
    return <Navigate to="/estrutura-organizacional" replace />;
  }

  return <>{children}</>;
}
