import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { copiarTorsosSinteticos, prepararDataDirE2E } from "./e2e/fixtures";

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * E2E (Playwright) contra o stack REAL: services/mesh (Python) + Next.js (A e B) + Postgres de
 * teste. Um servidor `next start` por desenho (ADR 0005): desenho-A :3101 e desenho-B :3102;
 * services/mesh em :E2E_MESH_PORT (padrão 8799). Requer `next build` com
 * NEXT_PUBLIC_GANCHOS_TESTE=1 antes (o script `test:e2e` faz). Chromium pré-instalado em
 * PLAYWRIGHT_BROWSERS_PATH (não rodar `playwright install`).
 */
const RAIZ = resolve(AQUI, "../..");
const CHROMIUM_LOCAL = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync(CHROMIUM_LOCAL) && !process.env.PLAYWRIGHT_BROWSERS_PATH ? CHROMIUM_LOCAL : undefined);

const DB_TESTE = process.env.DATABASE_URL_TEST || "postgres://simulador:simulador@127.0.0.1:5432/simulador_test";
const MESH_PORTA = Number(process.env.E2E_MESH_PORT || 8799);
const MESH_URL = `http://127.0.0.1:${MESH_PORTA}`;

// Preparação única (o config também é carregado pelos workers; o env marca que já foi feita).
if (!process.env.E2E_DATA_DIR) {
  // DATA_DIR temporário e isolado (nunca o data/ real): fixtures + cópia dos torsos sintéticos.
  const dir = mkdtempSync(join(tmpdir(), "simulador-e2e-"));
  process.env.E2E_DATA_DIR = dir;
  prepararDataDirE2E(dir);
  copiarTorsosSinteticos(resolve(RAIZ, "data/sinteticos"), dir, RAIZ);
  // Postgres de teste com as migrations (idempotente; ADR 0007).
  execSync("bash scripts/db.sh start criar", { cwd: RAIZ, stdio: "ignore" });
  execSync("node --experimental-strip-types --no-warnings scripts/migrar.ts --teste", { cwd: AQUI, stdio: "ignore", env: { ...process.env, DATABASE_URL_TEST: DB_TESTE } });
}
const DATA_DIR_E2E = process.env.E2E_DATA_DIR;
process.env.E2E_MESH_URL = MESH_URL;

// Token local (ADR 0003 item 7): um por execução; os servidores exigem, o navegador manda em todo pedido.
process.env.E2E_APP_TOKEN ??= randomBytes(24).toString("hex");
const TOKEN = process.env.E2E_APP_TOKEN;

// Portas sobrescrevíveis (E2E_PORTA_A/B) para rodar worktrees em paralelo sem colisão.
const PORTAS = { A: Number(process.env.E2E_PORTA_A || 3101), B: Number(process.env.E2E_PORTA_B || 3102) } as const;
const next = (desenho: "A" | "B") => ({
  command: `pnpm exec next start -H 127.0.0.1 -p ${PORTAS[desenho]}`,
  url: `http://127.0.0.1:${PORTAS[desenho]}/api/config`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    DESENHO: desenho,
    MESH_SERVICE_URL: MESH_URL,
    MESH_SERVICE_TIMEOUT_MS: "300000",
    DATABASE_URL: DB_TESTE,
    DATA_DIR: DATA_DIR_E2E,
    USUARIO_LOCAL_ID: "e2e",
    LOG_LEVEL: "warn",
    APP_TOKEN_LOCAL: TOKEN,
    // /benchmark (plano A14): ligado só no servidor B para o e2e cobrir os dois estados (A = padrão, 404)
    BENCHMARK_HABILITADO: desenho === "B" ? "1" : "0",
  },
});

export default defineConfig({
  testDir: "./e2e",
  // apaga o DATA_DIR temporário (/tmp/simulador-e2e-*) no fim da execução
  globalTeardown: "./e2e/teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    trace: "retain-on-failure",
    extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desenho-A", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.A}` } },
    { name: "desenho-B", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.B}` } },
  ],
  webServer: [
    {
      command: `bash ${RAIZ}/scripts/mesh.sh dev`,
      url: `${MESH_URL}/saude`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { DATA_DIR: DATA_DIR_E2E, MESH_PORT: String(MESH_PORTA) },
    },
    next("A"),
    next("B"),
  ],
});
