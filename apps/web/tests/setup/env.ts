import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, inject } from "vitest";

// Ambiente isolado de teste: banco de teste, DATA_DIR temporário, mesh sempre mockado (MSW).
process.env.REPO_ROOT = resolve(__dirname, "../../../..");
process.env.DATABASE_URL = inject("dbUrlTeste");
const DATA_DIR_TESTE = mkdtempSync(join(tmpdir(), "simulador-teste-"));
process.env.DATA_DIR = DATA_DIR_TESTE;
// Cada arquivo de teste ganha um DATA_DIR temporário, apagado no fim do arquivo (nada fica em /tmp).
afterAll(() => rmSync(DATA_DIR_TESTE, { recursive: true, force: true }));
process.env.MESH_SERVICE_URL = "http://mesh.mock:8765";
process.env.MESH_SERVICE_TIMEOUT_MS = "5000";
process.env.USUARIO_LOCAL_ID = "teste";
process.env.TZ = "America/Cuiaba";
delete process.env.APP_VERSION;
delete process.env.ENVELOPE_RMS_MM;
process.env.DESENHO = "B";
