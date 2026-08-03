import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
