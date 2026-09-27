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
const dev = process.env.NODE_ENV !== "production";

/**
 * CSP (revisão v0.1.1). Tudo servido pelo próprio app; nenhum CDN. `'unsafe-inline'` em script-src
 * é exigido pelos scripts inline de hidratação do App Router sem nonce (ADR 0003 item 7 registra o
 * trade-off); `'unsafe-eval'` e `ws:` só em `next dev` (HMR/React refresh). `blob:`/`data:` servem as
 * texturas do glTF (three.js cria object URLs) e a pré-visualização de arquivo local.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self' blob: data:${dev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Recursos do navegador que o app não usa ficam desligados para qualquer origem. */
const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "display-capture=()",
].join(", ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@simulador/contratos"],
  serverExternalPackages: ["pg"],
  outputFileTracingRoot: raizRepo,
  // config/*.json e VERSION são lidos em runtime pelo servidor (nunca copiados para o código).
  // pnpm-workspace.yaml: `raizRepo()` (config/ambiente.ts) reconhece a raiz por ele + VERSION; sem
  // ele no trace, um deploy com o pacote rastreado não acha a raiz (lerConfig/dataDir falham).
  // docs/validacao/*.json: registros lidos pela planilha do art. 5º (validacao/planilha.ts).
  outputFileTracingIncludes: {
    "/**": ["../../config/**/*.json", "../../VERSION", "../../pnpm-workspace.yaml", "../../docs/validacao/*.json"],
  },
  // Dados de paciente e artefatos gerados NUNCA entram no pacote de deploy (LGPD).
  outputFileTracingExcludes: {
    "/**": ["../../data/**", "../../services/**", "**/*.obj", "**/*.ply", "**/*.glb", "**/*.pdf"],
  },
  turbopack: { root: raizRepo },
  experimental: {
    // Com o proxy (src/proxy.ts) o Next bufferiza o corpo e TRUNCA em silêncio acima deste limite
    // (padrão 10 MB): precisa cobrir o upload de malhas (500 MB, ADR 0003) + margem do multipart.
    // O limite real é aplicado pela rota (stream contado; 413).
    proxyClientMaxBodySize: "520mb",
  },
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
          // HSTS: ignorado em http://127.0.0.1 pelos navegadores; vale quando houver TLS (produção, ADR 0004)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      // CSP das PÁGINAS (tudo que não é /api)
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: CSP }] },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      // JSON/GLB da API não executam nada; o PDF fica de fora para o visualizador do navegador abrir
      { source: "/api/((?!pdf/).*)", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" }] },
    ];
  },
};

export default config;
