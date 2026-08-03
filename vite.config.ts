import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: o service worker antigo é substituído assim que um novo
      // build é detectado. Sem isto o SW serviria a versão anterior do app
      // indefinidamente após um deploy — o usuário ficaria preso a uma
      // build velha sem entender por quê.
      registerType: "autoUpdate",
      workbox: {
        // App shell (HTML/JS/CSS/ícones) em cache: uma oscilação de sinal
        // deixa de virar tela branca — o app abre e só os dados falham,
        // caindo no ErrorState com "Tentar novamente".
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        // O chunk do recharts passa de 2 MB não comprimido; o limite padrão
        // do Workbox (2 MiB) o excluiria silenciosamente do precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // NUNCA cachear a API. Dado de comissão e fechamento tem de ser
        // sempre fresco — servir valor financeiro velho de cache levaria a
        // decisão errada sobre pagamento. Em rede caída a chamada falha (e
        // a tela mostra erro), que é o comportamento correto aqui.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "Metas e Comissões de Vendas",
        short_name: "Metas",
        description: "Gestão de metas comerciais, fechamento e recebíveis",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
  build: {
    outDir: "dist/client",
    // Sem isto, o Vite injetava <link rel="modulepreload"> do chunk do
    // recharts no index.html — o navegador baixava os 160 KB gzip logo no
    // primeiro acesso, anulando boa parte do ganho de tê-lo separado.
    // Como recharts só aparece dentro de telas lazy (Acompanhamento/
    // Recebíveis/Metas/Bases), esse preload é desperdício para quem abre
    // só o login. Filtramos apenas ele: o preload dos demais chunks
    // continua valendo, para a navegação interna seguir rápida.
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((dep) => !dep.includes("recharts")),
    },
    rollupOptions: {
      output: {
        // Recharts em chunk próprio: é a maior dependência do front (~160
        // KB gzip) e só é usada em Acompanhamento/Recebíveis/Metas. Quem
        // abre só a tela de login nunca a baixa. (xlsx não entra aqui — é
        // usado apenas no backend, ao parsear as planilhas de import.)
        manualChunks: {
          recharts: ["recharts"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
    },
  },
});
