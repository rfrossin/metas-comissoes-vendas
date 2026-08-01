import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { useAuthStore } from "@/store/auth.store";

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <AppShell>{children}</AppShell>;
}
