// Aplica as migrations SQL (db/migrations) no DATABASE_URL (ou DATABASE_URL_TEST com --teste).
// Uso: pnpm --filter web db:migrate   |   pnpm --filter web db:migrate:test
// --marcar-demo (ADR 0018): depois de migrar, marca o banco como de demonstração sintética
// (COMMENT ON DATABASE), mas SÓ se ele estiver vazio (nenhum paciente): a instância do
// consultório nunca vira demo. A subida com DEMO_SINTETICA=1 exige essa marca.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";
import { migrar } from "../src/db/migrar.ts";

const aqui = dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(resolve(aqui, "../../.."));
const teste = process.argv.includes("--teste");
const marcarDemo = process.argv.includes("--marcar-demo");
const MARCA_BANCO_DEMO = "simulador-mamario:demo-sintetica"; // igual a src/config/subida.ts (teste confere)
const url = teste
  ? process.env.DATABASE_URL_TEST || "postgres://simulador:simulador@127.0.0.1:5432/simulador_test"
  : process.env.DATABASE_URL || "postgres://simulador:simulador@127.0.0.1:5432/simulador";

const cliente = new pg.Client({ connectionString: url });
try {
  await cliente.connect();
  const novas = await migrar(cliente, resolve(aqui, "../db/migrations"));
  console.log(novas.length ? `migrations aplicadas: ${novas.join(", ")}` : "banco já está atualizado");
  if (marcarDemo) {
    const marca = (await cliente.query("select shobj_description(d.oid, 'pg_database') as marca from pg_database d where d.datname = current_database()")).rows[0]?.marca ?? null;
    if (marca !== MARCA_BANCO_DEMO) {
      const n = Number((await cliente.query("select count(*)::int as n from pacientes")).rows[0]?.n ?? 0);
      if (n !== 0) throw new Error(`--marcar-demo recusado: o banco já tem ${n} paciente(s); use um banco novo e vazio`);
      await cliente.query(`do $$ begin execute format('comment on database %I is %L', current_database(), '${MARCA_BANCO_DEMO}'); end $$`);
    }
    console.log("banco marcado como demonstração sintética (ADR 0018)");
  }
} catch (e) {
  console.error(`erro: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await cliente.end().catch(() => undefined);
}
