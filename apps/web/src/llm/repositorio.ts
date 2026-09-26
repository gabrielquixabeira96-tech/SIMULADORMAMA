import type { Desenho, Medidas, MedidasDigitadas } from "@simulador/contratos";
import type pg from "pg";
import { consultar } from "@/db/pool";
import type { Anamnese } from "./esquemas";
import type { RelatorioFinal, OrigemProsa } from "./relatorio";

/**
 * Acesso ao banco da camada de texto e registro (Marco 2b): atendimentos (anamnese, prosa, PDF)
 * e relatórios (migration 0003). Nenhuma coluna guarda nome, documento, contato ou texto bruto.
 */

export interface AtendimentoLinha {
  id: string;
  paciente_id: string;
  pseudonimo: string;
  desenho: Desenho;
  versao_software: string;
  anamnese: Anamnese | null;
  relatorio_prosa: unknown;
  pdf_caminho: string | null;
  pdf_sha256: string | null;
  iniciado_em: Date;
  encerrado_em: Date | null;
}

const q = <T extends pg.QueryResultRow>(sql: string, p: unknown[], c?: pg.ClientBase) => (c ? c.query<T>(sql, p) : consultar<T>(sql, p));

export async function criarAtendimento(a: { pacienteId: string; desenho: Desenho; versaoSoftware: string }, c?: pg.ClientBase): Promise<string> {
  const r = await q<{ id: string }>("insert into atendimentos (paciente_id, desenho, versao_software) values ($1,$2,$3) returning id", [a.pacienteId, a.desenho, a.versaoSoftware], c);
  return r.rows[0]!.id;
}

export async function atendimentoPorId(id: string, c?: pg.ClientBase): Promise<AtendimentoLinha | null> {
  const r = await q<AtendimentoLinha>("select a.*, p.pseudonimo from atendimentos a join pacientes p on p.id = a.paciente_id where a.id = $1", [id], c);
  return r.rows[0] ?? null;
}

export async function salvarAnamnese(atendimentoId: string, anamnese: Anamnese, c?: pg.ClientBase): Promise<void> {
  await q("update atendimentos set anamnese = $2 where id = $1", [atendimentoId, JSON.stringify(anamnese)], c);
}

export async function inserirRelatorio(r: RelatorioFinal, c?: pg.ClientBase): Promise<void> {
  await q(
    "insert into relatorios (id, atendimento_id, desenho, versao_software, esquema, payload, prosa_origem, numeros_ok) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [r.relatorio_id, r.atendimento_id, r.desenho, r.versao_software, r.esquema, JSON.stringify(r), r.prosa_origem satisfies OrigemProsa, r.verificacao.ok],
    c,
  );
  await q("update atendimentos set relatorio_prosa = $2 where id = $1", [r.atendimento_id, JSON.stringify(r.prosa)], c);
}

export interface RelatorioLinha {
  id: string;
  atendimento_id: string;
  desenho: Desenho;
  versao_software: string;
  payload: RelatorioFinal;
  prosa_origem: OrigemProsa;
  numeros_ok: boolean;
  criado_em: Date;
}

export async function relatorioPorId(id: string): Promise<RelatorioLinha | null> {
  const r = await consultar<RelatorioLinha>("select * from relatorios where id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function ultimoRelatorio(atendimentoId: string): Promise<RelatorioLinha | null> {
  const r = await consultar<RelatorioLinha>("select * from relatorios where atendimento_id = $1 order by criado_em desc, id desc limit 1", [atendimentoId]);
  return r.rows[0] ?? null;
}

export async function registrarPdf(atendimentoId: string, caminhoRelativo: string, sha256: string, c?: pg.ClientBase): Promise<void> {
  await q("update atendimentos set pdf_caminho = $2, pdf_sha256 = $3 where id = $1", [atendimentoId, caminhoRelativo, sha256], c);
}

export async function ultimaTepidDigitada(pacienteId: string): Promise<MedidasDigitadas | null> {
  const r = await consultar<{ valores: MedidasDigitadas }>("select valores from tepid where paciente_id = $1 order by criado_em desc limit 1", [pacienteId]);
  return r.rows[0]?.valores ?? null;
}

export async function ultimaMedidaDaMalha(malhaId: string): Promise<{ id: string; payload: Medidas } | null> {
  const r = await consultar<{ id: string; payload: Medidas }>("select id, payload from medidas where malha_id = $1 order by criado_em desc limit 1", [malhaId]);
  return r.rows[0] ?? null;
}

/** Specs do cache `implantes` (preenchido quando a simulação é registrada; contratos §17). */
export async function implantesDoCache(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (ids.length === 0) return new Map();
  const r = await consultar<{ id: string; payload: Record<string, unknown> }>("select id, payload from implantes where id = any($1::text[])", [ids]);
  return new Map(r.rows.map((x) => [x.id, x.payload]));
}
