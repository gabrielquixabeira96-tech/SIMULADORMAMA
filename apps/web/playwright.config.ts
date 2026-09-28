import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { TORSOS, copiarTorsosSinteticos, prepararDataDirE2E } from "./e2e/fixtures";
import { prepararFotosExemplo } from "./e2e/fotoSintetica";

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
// Banco PRÓPRIO do servidor em modo demo sintética (ADR 0018): a subida da demo recusa o banco de
// teste compartilhado (tem malhas não sintéticas dos outros testes). Nome derivado do de teste
// (<nome>_e2edemo), criado e marcado aqui e apagado no teardown.
const DB_DEMO = (() => {
  const u = new URL(DB_TESTE);
  u.pathname = `${u.pathname.replace(/^\//, "")}_e2edemo`;
  return u.toString();
})();
process.env.E2E_DATABASE_URL_DEMO = DB_DEMO;
const MESH_URL = `http://127.0.0.1:${MESH_PORTA}`;

// Preparação única (o config também é carregado pelos workers; o env marca que já foi feita).
if (!process.env.E2E_DATA_DIR) {
  // DATA_DIR temporário e isolado (nunca o data/ real): fixtures + cópia dos torsos sintéticos.
  const dir = mkdtempSync(join(tmpdir(), "simulador-e2e-"));
  process.env.E2E_DATA_DIR = dir;
  prepararDataDirE2E(dir);
  copiarTorsosSinteticos(resolve(RAIZ, "data/sinteticos"), dir, RAIZ);
  // "fotos de exemplo" (plano "foto → 3D"): as do pipeline, se já preparadas; senão a fixture sintética
  prepararFotosExemplo(resolve(RAIZ, "data/sinteticos"), dir, TORSOS);
  // Postgres de teste com as migrations (idempotente; ADR 0007).
  execSync("bash scripts/db.sh start criar", { cwd: RAIZ, stdio: "ignore" });
  execSync("node --experimental-strip-types --no-warnings scripts/migrar.ts --teste", { cwd: AQUI, stdio: "ignore", env: { ...process.env, DATABASE_URL_TEST: DB_TESTE } });
  // banco da demo: criado pelo db.sh (superusuário), migrado e marcado (só se vazio) pelo migrar.ts
  execSync("bash scripts/db.sh criar", { cwd: RAIZ, stdio: "ignore", env: { ...process.env, DB_NAME_TEST: new URL(DB_DEMO).pathname.slice(1) } });
  execSync("node --experimental-strip-types --no-warnings scripts/migrar.ts --teste --marcar-demo", { cwd: AQUI, stdio: "ignore", env: { ...process.env, DATABASE_URL_TEST: DB_DEMO } });
}
const DATA_DIR_E2E = process.env.E2E_DATA_DIR;
process.env.E2E_MESH_URL = MESH_URL;

// Token local (ADR 0003 item 7): um por execução; os servidores exigem, o navegador manda em todo pedido.
// 64 hex: o formato exigido pelo servidor em modo demo (ADR 0018)
process.env.E2E_APP_TOKEN ??= randomBytes(32).toString("hex");
const TOKEN = process.env.E2E_APP_TOKEN;

// Portas sobrescrevíveis (E2E_PORTA_A/B) para rodar worktrees em paralelo sem colisão.
const PORTAS = { A: Number(process.env.E2E_PORTA_A || 3101), B: Number(process.env.E2E_PORTA_B || 3102), demo: Number(process.env.E2E_PORTA_DEMO || 3103) } as const;
/** Host "público" simulado do servidor demo (.invalid: nunca resolve). */
const HOST_PUBLICO_DEMO = "demo-e2e.invalid";
process.env.E2E_HOST_PUBLICO_DEMO = HOST_PUBLICO_DEMO;
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
    // E2E_BENCHMARK_NA_REDE=1 (só com e2e/benchmark.spec.ts): o servidor B sobe no modo "benchmark na
    // rede" do ADR 0003 (revisão v0.1.2) — host extra fora do loopback (192.0.2.10, TEST-NET, nunca
    // roteado) e SEM banco —, provando que a página funciona só com as rotas liberadas pelo proxy.
    ...(desenho === "B" && process.env.E2E_BENCHMARK_NA_REDE === "1" ? { APP_HOSTS_PERMITIDOS: "192.0.2.10", DATABASE_URL: "" } : {}),
  },
});

/**
 * Servidor em modo demonstração sintética (ADR 0018): desenho B, LLM em mock, banco próprio marcado,
 * mesmo DATA_DIR e mesmo services/mesh do e2e (a subida confere DATA_DIR/pacientes, vazio nesse
 * momento). Sem BENCHMARK_HABILITADO: o modo demo liga o /benchmark sozinho. Só roda e2e/demo.spec.ts.
 */
const nextDemo = {
  command: `pnpm exec next start -H 127.0.0.1 -p ${PORTAS.demo}`,
  url: `http://127.0.0.1:${PORTAS.demo}/api/config`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    DESENHO: "B",
    DEMO_SINTETICA: "1",
    LLM_MODO: "mock",
    ANTHROPIC_API_KEY: "",
    BENCHMARK_HABILITADO: "",
    APP_HOSTS_PERMITIDOS: HOST_PUBLICO_DEMO,
    MESH_SERVICE_URL: MESH_URL,
    MESH_SERVICE_TIMEOUT_MS: "300000",
    DATABASE_URL: DB_DEMO,
    DATA_DIR: DATA_DIR_E2E,
    USUARIO_LOCAL_ID: "e2e-demo",
    LOG_LEVEL: "warn",
    APP_TOKEN_LOCAL: TOKEN,
  },
};

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
    { name: "desenho-A", testIgnore: /demo\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.A}` } },
    { name: "desenho-B", testIgnore: /demo\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.B}` } },
    // fluxo-guiado.spec também roda na demo (caminho mais curto até o PDF, pacote P3)
    { name: "demo", testMatch: /(demo|fluxo-guiado)\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORTAS.demo}` } },
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
    nextDemo,
  ],
});
