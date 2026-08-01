import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePlatformAuthStore } from "@/store/platform-auth.store";

export function RequirePlatformAuth({ children }: { children: ReactNode }) {
  const token = usePlatformAuthStore((state) => state.token);

  if (!token) {
    return <Navigate to="/admin-plataforma/login" replace />;
  }

  return <>{children}</>;
}
