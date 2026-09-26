import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";

/**
 * Runner de migrations SQL numeradas (apps/web/db/migrations/NNNN_nome.sql; contratos §17).
 * Recebe um cliente único (não um Pool), pois usa transações. Idempotente: registra nome + sha256 em `schema_migrations`; recusa migration já aplicada
 * cujo conteúdo mudou (migrations são imutáveis depois de aplicadas).
 */
export interface MigrationAplicada {
  nome: string;
  sha256: string;
}

export function listarMigrations(dir: string): Array<{ nome: string; sql: string; sha256: string }> {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((nome) => {
      const sql = readFileSync(resolve(/*turbopackIgnore: true*/ dir, nome), "utf8");
      return { nome, sql, sha256: createHash("sha256").update(sql).digest("hex") };
    });
}

export async function migrar(cliente: pg.ClientBase, dir: string): Promise<string[]> {
  await cliente.query(`create table if not exists schema_migrations (
    arquivo text primary key, sha256 text not null, aplicada_em timestamptz not null default now())`);
  const { rows } = await cliente.query<MigrationAplicada>("select arquivo as nome, sha256 from schema_migrations");
  const aplicadas = new Map(rows.map((r) => [r.nome, r.sha256]));
  const novas: string[] = [];
  for (const m of listarMigrations(dir)) {
    const sha = aplicadas.get(m.nome);
    if (sha) {
      if (sha !== m.sha256) throw new Error(`migration ${m.nome} foi alterada depois de aplicada`);
      continue;
    }
    // Cada migration numa transação própria.
    await cliente.query("begin");
    try {
      await cliente.query(m.sql);
      await cliente.query("insert into schema_migrations (arquivo, sha256) values ($1, $2)", [m.nome, m.sha256]);
      await cliente.query("commit");
      novas.push(m.nome);
    } catch (e) {
      await cliente.query("rollback");
      throw new Error(`falha na migration ${m.nome}: ${(e as Error).message}`);
    }
  }
  return novas;
}
