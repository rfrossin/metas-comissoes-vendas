import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/server/test/integration-setup.ts"],
    // Testes de integração compartilham o mesmo banco Postgres local do
    // Supabase (supabase start) e não podem rodar em paralelo — cada teste
    // limpa e semeia dados no mesmo schema.
    fileParallelism: false,
  },
});
