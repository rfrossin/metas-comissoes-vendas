import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
      // retry 2 com backoff exponencial (1s, 2s): o retry:1 anterior
      // reexecutava imediatamente, então falhava junto com a primeira
      // tentativa numa oscilação de rede (túnel/elevador). O backoff dá
      // tempo da conexão voltar. A primeira retentativa segue rápida, o
      // que preserva a reação ágil do interceptor de 401 acima.
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    },
  },
});

// O service worker (registerType: "autoUpdate") só troca de versão no
// SEGUNDO carregamento: no primeiro ele ainda serve o cache antigo enquanto
// baixa o novo. Forçar update() a cada carga encurta essa janela — importa
// aqui porque uma build velha do front pode conversar com uma API já
// atualizada. Silencioso de propósito: falhar em atualizar não deve
// impedir o app de abrir.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then((reg) => reg.update()).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
