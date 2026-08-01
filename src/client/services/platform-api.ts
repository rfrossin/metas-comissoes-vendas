import axios, { isAxiosError } from "axios";
import { usePlatformAuthStore } from "@/store/platform-auth.store";

// Client separado de api.ts: usa o token de usePlatformAuthStore (Super
// Admin da plataforma), não o de useAuthStore (usuário de uma Company).
export const platformApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
});

platformApi.interceptors.request.use((config) => {
  const token = usePlatformAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getPlatformErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}
