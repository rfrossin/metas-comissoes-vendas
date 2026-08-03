import axios, { isAxiosError } from "axios";
import { useIdentityStore } from "@/store/identity.store";

// Terceiro client, ao lado de api.ts (tenant) e platform-api.ts (Super
// Admin): usa o token de escopo "identity", o único aceito pelas rotas
// /api/identidade. Mandar o token errado ali resulta em 401.
export const identityApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
  // Mesma razão de api.ts: sem timeout, rede ruim trava a tela em
  // "Carregando..." indefinidamente.
  timeout: 30_000,
});

identityApi.interceptors.request.use((config) => {
  const token = useIdentityStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getIdentityErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}
