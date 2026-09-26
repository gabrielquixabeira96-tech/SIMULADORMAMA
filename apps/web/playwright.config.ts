import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { prepararDataDirE2E } from "./e2e/fixtures";

/**
 * E2E (Playwright). Dois projetos, um servidor `next start` por desenho (ADR 0005):
 * desenho-A em :3101 e desenho-B em :3102. Requer `next build` antes (o script test:e2e faz).
 * Chromium pré-instalado em PLAYWRIGHT_BROWSERS_PATH (não rodar `playwright install`).
 */
const CHROMIUM_LOCAL = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync(CHROMIUM_LOCAL) && !process.env.PLAYWRIGHT_BROWSERS_PATH ? CHROMIUM_LOCAL : undefined);

// DATA_DIR temporário e isolado, com fixtures sintéticas (nunca o data/ real).
const DATA_DIR_E2E = process.env.E2E_DATA_DIR || mkdtempSync(join(tmpdir(), "simulador-e2e-"));
process.env.E2E_DATA_DIR = DATA_DIR_E2E;
prepararDataDirE2E(DATA_DIR_E2E);

const PORTAS = { A: 3101, B: 3102 } as const;
const servidor = (desenho: "A" | "B") => ({
  command: `pnpm exec next start -p ${PORTAS[desenho]}`,
  url: `http://127.0.0.1:${PORTAS[desenho]}/api/config`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    DESENHO: desenho,
    // serviço de malha propositalmente inexistente: a UI deve seguir funcionando ("aguardando serviço")
    MESH_SERVICE_URL: "http://127.0.0.1:9",
    DATA_DIR: DATA_DIR_E2E,
    LOG_LEVEL: "warn",
  },
});

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desenho-A", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.A}` } },
    { name: "desenho-B", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.B}` } },
  ],
  webServer: [servidor("A"), servidor("B")],
});
