import { create } from "zustand";

// Sessão de IDENTIDADE — a pessoa está autenticada, mas ainda não escolheu
// (ou não tem) empresa. Store separado do auth.store de propósito: os dois
// podem coexistir num mesmo navegador (alguém com empresa que abre o painel
// de identidade para criar outra), e misturá-los faria um token de escopo
// "identity" ser enviado para rotas de tenant, que o rejeitariam com 401.
interface IdentityState {
  token: string | null;
  email: string | null;
  setIdentity: (token: string, email: string) => void;
  clearIdentity: () => void;
}

const STORAGE_KEY = "metas-comissoes:identity";

function loadPersisted(): { token: string | null; email: string | null } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { token: null, email: null };

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== "string" || typeof parsed?.email !== "string") {
      return { token: null, email: null };
    }
    return { token: parsed.token, email: parsed.email };
  } catch {
    return { token: null, email: null };
  }
}

export const useIdentityStore = create<IdentityState>((set) => ({
  ...loadPersisted(),
  setIdentity: (token, email) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, email }));
    set({ token, email });
  },
  clearIdentity: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, email: null });
  },
}));
