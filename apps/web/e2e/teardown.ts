import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

/** Teardown global do Playwright: apaga o DATA_DIR temporário criado pelo playwright.config.ts. */
export default function teardown(): void {
  const dir = process.env.E2E_DATA_DIR;
  // só apaga o que o próprio config criou (prefixo simulador-e2e- dentro do tmpdir)
  if (dir && resolve(dir).startsWith(resolve(tmpdir()) + sep + "simulador-e2e-")) rmSync(dir, { recursive: true, force: true });
}
