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
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
