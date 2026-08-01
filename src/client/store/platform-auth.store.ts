import { create } from "zustand";

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPORTE";
}

interface PlatformAuthState {
  token: string | null;
  platformUser: PlatformUser | null;
  setSession: (token: string, platformUser: PlatformUser) => void;
  clearSession: () => void;
}

const STORAGE_KEY = "metas-comissoes:platform-auth";

function loadPersisted(): { token: string | null; platformUser: PlatformUser | null } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { token: null, platformUser: null };

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== "string" || typeof parsed?.platformUser?.id !== "string") {
      return { token: null, platformUser: null };
    }
    return parsed;
  } catch {
    return { token: null, platformUser: null };
  }
}

// Sessão separada de useAuthStore (tenant) por design — o Super Admin da
// plataforma não pertence a nenhuma Company, e os dois tokens têm payloads
// incompatíveis (ver platform-auth.middleware.ts, campo `scope`).
export const usePlatformAuthStore = create<PlatformAuthState>((set) => ({
  ...loadPersisted(),
  setSession: (token, platformUser) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, platformUser }));
    set({ token, platformUser });
  },
  clearSession: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, platformUser: null });
  },
}));
