import axios, { isAxiosError } from "axios";
import { useAuthStore } from "@/store/auth.store";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Sem isto, um token expirado (8h) deixava o usuário preso numa tela
// autenticada com toda chamada falhando em silêncio — RequireAuth só checa
// a PRESENÇA do token, nunca a validade. /auth e /permissoes/trocar-empresa
// ficam fora: um 401 ali é a resposta esperada de credencial errada ou
// pré-token expirado, não uma sessão que precisa ser encerrada.
const AUTH_PATHS_EXEMPT_FROM_REDIRECT = ["/auth/", "/permissoes/trocar-empresa", "/plataforma/"];

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    const url = isAxiosError(error) ? (error.config?.url ?? "") : "";
    const isExempt = AUTH_PATHS_EXEMPT_FROM_REDIRECT.some((path) => url.includes(path));

    if (status === 401 && !isExempt) {
      useAuthStore.getState().clearSession();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);

// O backend já lança erros com motivo exato (ConflictError/ForbiddenError/
// NotFoundError, sempre `{ message }`) — usar isso em vez de mensagens
// genéricas fixas no front é o que a critique de Resultados cobrou
// (PRODUCT.md Princípio #3: "o usuário sempre vê o motivo exato").
export function getErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }

  return fallback;
}
