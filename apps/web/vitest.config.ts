import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    globalSetup: ["tests/setup/global.ts"],
    setupFiles: ["tests/setup/env.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Testes de banco compartilham o banco simulador_test; arquivos rodam em série para
    // não disputar migrations. Os dados de cada teste são isolados por pseudônimo/UUID.
    fileParallelism: false,
  },
});
