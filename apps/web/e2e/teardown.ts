import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import pg from "pg";

/**
 * Teardown global do Playwright: apaga o DATA_DIR temporário criado pelo playwright.config.ts e o
 * banco próprio do servidor em modo demo (<banco de teste>_e2edemo; ADR 0018).
 */
export default async function teardown(): Promise<void> {
  const dir = process.env.E2E_DATA_DIR;
  // só apaga o que o próprio config criou (prefixo simulador-e2e- dentro do tmpdir)
  if (dir && resolve(dir).startsWith(resolve(tmpdir()) + sep + "simulador-e2e-")) rmSync(dir, { recursive: true, force: true });
  const demo = process.env.E2E_DATABASE_URL_DEMO;
  if (!demo) return;
  const u = new URL(demo);
  const nome = u.pathname.slice(1);
  if (!/^[a-z0-9_]+_e2edemo$/.test(nome)) return; // só o banco que o config criou
  u.pathname = "/postgres";
  const c = new pg.Client({ connectionString: u.toString() });
  try {
    await c.connect();
    await c.query(`drop database if exists "${nome}" with (force)`);
  } catch (e) {
    console.warn(`[teardown] não apagou o banco ${nome}: ${(e as Error).message}`);
  } finally {
    await c.end().catch(() => undefined);
  }
}
