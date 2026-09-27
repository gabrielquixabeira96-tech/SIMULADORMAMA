import type { Desenho } from "@simulador/contratos";
import type pg from "pg";
import { higienizar } from "@/log/higienizar";
import { consultar } from "./pool";

/** Ações aceitas (contratos §17). */
export type AcaoAuditoria = "visualizou" | "criou" | "alterou" | "exportou" | "apagou" | "simulou";
const ACOES: readonly AcaoAuditoria[] = ["visualizou", "criou", "alterou", "exportou", "apagou", "simulou"];

export interface EventoAuditoria {
  usuarioId: string;
  acao: AcaoAuditoria;
  /** nome da tabela ou 'arquivo' */
  entidade: string;
  entidadeId: string;
  desenho: Desenho;
  /** NUNCA dado pessoal, nunca caminho absoluto (é higienizado de qualquer forma). */
  detalhes?: Record<string, unknown>;
}

/**
 * Insere uma linha em `auditoria` (append-only; ADR 0002 item 4). Toda leitura/escrita de
 * malha, medida, simulação, relatório ou PDF por rota do Next.js passa por aqui.
 */
export async function registrarAuditoria(ev: EventoAuditoria, cliente?: pg.ClientBase): Promise<void> {
  if (!ACOES.includes(ev.acao)) throw new Error(`ação de auditoria inválida: ${ev.acao}`);
  if (ev.desenho !== "A" && ev.desenho !== "B") throw new Error("desenho inválido na auditoria");
  if (!ev.usuarioId || !ev.entidade || !ev.entidadeId) throw new Error("evento de auditoria incompleto");
  const detalhes = higienizar(ev.detalhes ?? {});
  const sql = "insert into auditoria (usuario_id, acao, entidade, entidade_id, desenho, detalhes) values ($1,$2,$3,$4,$5,$6)";
  const params = [ev.usuarioId, ev.acao, ev.entidade, ev.entidadeId, ev.desenho, JSON.stringify(detalhes)];
  if (cliente) await cliente.query(sql, params);
  else await consultar(sql, params);
}

export interface LinhaAuditoria {
  id: string;
  ocorrido_em: Date;
  usuario_id: string;
  acao: AcaoAuditoria;
  entidade: string;
  entidade_id: string;
  desenho: Desenho;
  detalhes: Record<string, unknown>;
}

export async function listarAuditoria(entidade: string, entidadeId: string): Promise<LinhaAuditoria[]> {
  const r = await consultar<LinhaAuditoria>(
    "select id, ocorrido_em, usuario_id, acao, entidade, entidade_id, desenho, detalhes from auditoria where entidade = $1 and entidade_id = $2 order by id",
    [entidade, entidadeId],
  );
  return r.rows;
}
