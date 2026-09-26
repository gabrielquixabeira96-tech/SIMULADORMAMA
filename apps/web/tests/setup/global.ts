import { resolve } from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { migrar } from "../../src/db/migrar";

/**
 * Prepara o banco de TESTE (simulador_test; ADR 0007): recria o schema public e aplica as
 * migrations uma vez por execução. Sem Postgres, os testes de banco se auto-pulam.
 */
export default async function setup(project: TestProject) {
  const url = process.env.DATABASE_URL_TEST || "postgres://simulador:simulador@127.0.0.1:5432/simulador_test";
  if (!/simulador_test|_test\b/.test(url)) throw new Error("DATABASE_URL_TEST deve apontar para um banco de teste");
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  let disponivel = false;
  try {
    await c.connect();
    await c.query("drop schema if exists public cascade");
    await c.query("create schema public");
    await migrar(c, resolve(__dirname, "../../db/migrations"));
    disponivel = true;
  } catch (e) {
    console.warn(`[vitest] Postgres de teste indisponível (${(e as Error).message}); testes de banco serão pulados.`);
  } finally {
    await c.end().catch(() => undefined);
  }
  project.provide("dbDisponivel", disponivel);
  project.provide("dbUrlTeste", url);
}

declare module "vitest" {
  export interface ProvidedContext {
    dbDisponivel: boolean;
    dbUrlTeste: string;
  }
}
