import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sem isto, staleTime era 0 e retry era 3 (padrões do TanStack Query)
      // em todas as queries, inclusive as agregadas pesadas de
      // Acompanhamento/Recebíveis — refetch a cada foco de janela, e uma
      // sessão expirada disparava 3 tentativas silenciosas antes do
      // interceptor de 401 (api.ts) sequer conseguir agir.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
