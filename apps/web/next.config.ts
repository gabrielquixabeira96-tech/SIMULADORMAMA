import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const aqui = dirname(fileURLToPath(import.meta.url));
const raizRepo = resolve(aqui, "../..");

// .env da raiz do monorepo (e depois apps/web/.env*, que o Next carrega sozinho).
loadEnvConfig(raizRepo);

const versao = readFileSync(resolve(raizRepo, "VERSION"), "utf8").trim();

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@simulador/contratos"],
  serverExternalPackages: ["pg"],
  outputFileTracingRoot: raizRepo,
  // config/*.json e VERSION são lidos em runtime pelo servidor (nunca copiados para o código).
  outputFileTracingIncludes: {
    "/**": ["../../config/**/*.json", "../../VERSION"],
  },
  // Dados de paciente e artefatos gerados NUNCA entram no pacote de deploy (LGPD).
  outputFileTracingExcludes: {
    "/**": ["../../data/**", "../../services/**", "**/*.obj", "**/*.ply", "**/*.glb", "**/*.pdf"],
  },
  turbopack: { root: raizRepo },
  env: {
    APP_VERSION: versao,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default config;
