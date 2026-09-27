import { resolve } from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { migrar } from "../../src/db/migrar";

/**
 * Prepara o banco de TESTE (simulador_test; ADR 0007): recria o schema public e aplica as
 * migrations uma vez por execução. Sem Postgres a execução FALHA, a menos que SEM_DB=1 (aí os
 * testes de banco se auto-pulam e `scripts/ci.sh --sem-db` marca a execução como sem banco).
 */
export default async function setup(project: TestProject) {
  const url = process.env.DATABASE_URL_TEST || "postgres://simulador:simulador@127.0.0.1:5432/simulador_test";
  if (!/simulador_test|_test\b/.test(url)) throw new Error("DATABASE_URL_TEST deve apontar para um banco de teste");
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  let disponivel = false;
  let erroConexao = "";
  try {
    await c.connect();
    await c.query("drop schema if exists public cascade");
    await c.query("create schema public");
    await migrar(c, resolve(__dirname, "../../db/migrations"));
    disponivel = true;
  } catch (e) {
    erroConexao = (e as Error).message;
  } finally {
    await c.end().catch(() => undefined);
  }
  if (!disponivel) {
    // Banco obrigatório (revisão v0.1.1): só com SEM_DB=1 explícito os testes de banco se auto-pulam.
    if (process.env.SEM_DB !== "1") {
      throw new Error(`Postgres de teste indisponível (${erroConexao}). Suba com 'bash scripts/db.sh start criar' ou rode com SEM_DB=1 (os testes de banco serão pulados e a execução não vale como validação).`);
    }
    console.warn(`[vitest] SEM_DB=1: Postgres de teste indisponível (${erroConexao}); testes de banco PULADOS.`);
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
