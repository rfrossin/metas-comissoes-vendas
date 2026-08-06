import axios, { isAxiosError } from "axios";
import { useAuthStore } from "@/store/auth.store";

// timeout obrigatório: sem ele o axios usa 0 (infinito) e, em rede móvel
// oscilante, o socket fica pendurado até o SO derrubá-lo — a query nunca
// sai de isLoading e o usuário vê "Carregando..." para sempre, sem nenhum
// caminho de código que a faça falhar.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
  timeout: 30_000,
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

  // Sem `response` o servidor não respondeu OU o navegador descartou a
  // resposta antes do JS (CORS, servidor fora do ar, DNS). Vale distinguir
  // de um erro de regra de negócio: o texto genérico fazia uma falha de
  // conexão parecer "esta tela está quebrada", enquanto a ação certa é
  // checar se a API está no ar e na origin esperada.
  if (isAxiosError(error) && !error.response) {
    return error.code === "ECONNABORTED"
      ? "O servidor demorou demais para responder. Tente novamente."
      : "Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.";
  }

  return fallback;
}
