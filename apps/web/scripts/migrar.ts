// Aplica as migrations SQL (db/migrations) no DATABASE_URL (ou DATABASE_URL_TEST com --teste).
// Uso: pnpm --filter web db:migrate   |   pnpm --filter web db:migrate:test
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";
import { migrar } from "../src/db/migrar.ts";

const aqui = dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(resolve(aqui, "../../.."));
const teste = process.argv.includes("--teste");
const url = teste
  ? process.env.DATABASE_URL_TEST || "postgres://simulador:simulador@127.0.0.1:5432/simulador_test"
  : process.env.DATABASE_URL || "postgres://simulador:simulador@127.0.0.1:5432/simulador";

const cliente = new pg.Client({ connectionString: url });
try {
  await cliente.connect();
  const novas = await migrar(cliente, resolve(aqui, "../db/migrations"));
  console.log(novas.length ? `migrations aplicadas: ${novas.join(", ")}` : "banco já está atualizado");
} catch (e) {
  console.error(`erro: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await cliente.end().catch(() => undefined);
}
