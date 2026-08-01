import { create } from "zustand";

export type PermissionLevel = "OPERACIONAL" | "LIDERANCA_NO" | "ADMINISTRADOR";

// Nomenclatura canônica dos níveis de acesso (SPECIFICATION.md, "Permissionamento":
// "níveis de acesso internos baseados em escopo (Operacional, Liderança de Nó e
// Administrador)"). Única fonte — antes duplicada com textos divergentes em
// usuarios/types.ts ("Usuário"/"Gestor") e estrutura-organizacional/CargosTab.tsx.
export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  OPERACIONAL: "Operacional",
  LIDERANCA_NO: "Liderança de Nó",
  ADMINISTRADOR: "Administrador",
};

export interface AuthUser {
  id: string;
  email: string;
  role: PermissionLevel;
  companyId: string;
  memberId: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
}

const STORAGE_KEY = "metas-comissoes:auth";

// Espelha auth.service.ts (backend) — cada linha vem de
// app_metadata.memberships na identidade Supabase.
export interface CompanyMembership {
  companyId: string;
  companyName: string;
  role: PermissionLevel;
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.companyId === "string"
  );
}

function loadPersisted(): { token: string | null; user: AuthUser | null } {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return { token: null, user: null };
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== "string" || !isAuthUser(parsed?.user)) {
      return { token: null, user: null };
    }
    return parsed;
  } catch {
    return { token: null, user: null };
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadPersisted(),
  setSession: (token, user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  clearSession: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  },
}));
