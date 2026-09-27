import pg from "pg";

/**
 * Pool do Postgres (ADR 0007). Um pool por URL, criado sob demanda para que testes possam
 * trocar DATABASE_URL antes do primeiro uso.
 */
const pools = new Map<string, pg.Pool>();

export class BancoIndisponivelError extends Error {
  constructor() {
    super("banco de dados não configurado (DATABASE_URL)");
    this.name = "BancoIndisponivelError";
  }
}

export function urlBanco(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new BancoIndisponivelError();
  return url;
}

export function pool(url = urlBanco()): pg.Pool {
  let p = pools.get(url);
  if (!p) {
    p = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000 });
    // Erros de clientes ociosos não derrubam o processo.
    p.on("error", () => undefined);
    pools.set(url, p);
  }
  return p;
}

export async function consultar<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool().query<T>(sql, params);
}

export async function transacao<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function fecharPools(): Promise<void> {
  const todos = [...pools.values()];
  pools.clear();
  await Promise.all(todos.map((p) => p.end().catch(() => undefined)));
}
