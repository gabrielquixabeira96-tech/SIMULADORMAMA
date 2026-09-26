import { inject } from "vitest";
import { consultar } from "../../src/db/pool";

export const dbDisponivel = (): boolean => inject("dbDisponivel");

export async function contarAuditoria(entidade: string, entidadeId: string, acao?: string): Promise<number> {
  const r = await consultar<{ n: string }>(
    `select count(*)::text as n from auditoria where entidade = $1 and entidade_id = $2 ${acao ? "and acao = $3" : ""}`,
    acao ? [entidade, entidadeId, acao] : [entidade, entidadeId],
  );
  return Number(r.rows[0]?.n ?? 0);
}
