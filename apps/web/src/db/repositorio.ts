import type { Desenho, MalhaMeta, Medidas, MedidasDigitadas, AlertaTepid } from "@simulador/contratos";
import type pg from "pg";
import { consultar } from "./pool";
import { gerarPseudonimo } from "./pseudonimo";

export interface Paciente {
  id: string;
  pseudonimo: string;
  criado_em: Date;
}

/** Cria paciente pseudonimizado (só id + pseudônimo). Tenta de novo em colisão rara. */
export async function criarPaciente(cliente?: pg.ClientBase): Promise<Paciente> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const sql = "insert into pacientes (pseudonimo) values ($1) on conflict (pseudonimo) do nothing returning id, pseudonimo, criado_em";
    const r = cliente ? await cliente.query<Paciente>(sql, [gerarPseudonimo()]) : await consultar<Paciente>(sql, [gerarPseudonimo()]);
    if (r.rows[0]) return r.rows[0];
  }
  throw new Error("não foi possível gerar pseudônimo único");
}

export async function pacientePorId(id: string): Promise<Paciente | null> {
  const r = await consultar<Paciente>("select id, pseudonimo, criado_em from pacientes where id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function listarPacientes(limite = 50): Promise<Paciente[]> {
  const r = await consultar<Paciente>("select id, pseudonimo, criado_em from pacientes order by criado_em desc limit $1", [limite]);
  return r.rows;
}

export interface MalhaLinha {
  id: string;
  paciente_id: string;
  pseudonimo: string;
  malha_dir: string;
  formato_origem: "obj" | "ply";
  unidade_origem: string;
  fator_escala_acumulado: number;
  n_vertices_original: number | null;
  n_vertices_processada: number | null;
  sha256_original: string | null;
  sha256_glb: string | null;
  meta: MalhaMeta;
  sintetica: boolean;
  criado_em: Date;
}

export async function inserirMalha(
  m: {
    id: string;
    pacienteId: string;
    malhaDir: string;
    formatoOrigem: "obj" | "ply";
    unidadeOrigem: string;
    meta: MalhaMeta;
    sintetica: boolean;
  },
  cliente?: pg.ClientBase,
): Promise<void> {
  const sql = `insert into malhas (id, paciente_id, malha_dir, formato_origem, unidade_origem, fator_escala_acumulado,
      n_vertices_original, n_vertices_processada, sha256_original, sha256_glb, meta, sintetica)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;
  const p = [
    m.id,
    m.pacienteId,
    m.malhaDir,
    m.formatoOrigem,
    m.unidadeOrigem,
    m.meta.fator_escala_acumulado,
    m.meta.original.n_vertices,
    m.meta.processada.n_vertices,
    m.meta.original.sha256,
    m.meta.processada.sha256_glb,
    JSON.stringify(m.meta),
    m.sintetica,
  ];
  if (cliente) await cliente.query(sql, p);
  else await consultar(sql, p);
}

export async function malhaPorId(id: string): Promise<MalhaLinha | null> {
  const r = await consultar<MalhaLinha>(
    `select m.*, p.pseudonimo from malhas m join pacientes p on p.id = m.paciente_id where m.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function atualizarMetaMalha(id: string, meta: MalhaMeta, cliente?: pg.ClientBase): Promise<void> {
  const sql = "update malhas set meta = $2, fator_escala_acumulado = $3, n_vertices_processada = $4, sha256_glb = $5 where id = $1";
  const p = [id, JSON.stringify(meta), meta.fator_escala_acumulado, meta.processada.n_vertices, meta.processada.sha256_glb];
  if (cliente) await cliente.query(sql, p);
  else await consultar(sql, p);
}

export async function inserirMedidas(m: Medidas, criadoPor: string, cliente?: pg.ClientBase): Promise<void> {
  const sql = "insert into medidas (id, malha_id, desenho, versao_software, esquema, payload, criado_por) values ($1,$2,$3,$4,$5,$6,$7)";
  const p = [m.medida_id, m.malha_id, m.desenho, m.versao_software, m.esquema, JSON.stringify(m), criadoPor];
  if (cliente) await cliente.query(sql, p);
  else await consultar(sql, p);
}

export interface MedidasLinha {
  id: string;
  malha_id: string;
  desenho: Desenho;
  versao_software: string;
  payload: Medidas;
  criado_por: string;
  criado_em: Date;
}

export async function medidasPorId(id: string): Promise<MedidasLinha | null> {
  const r = await consultar<MedidasLinha>("select * from medidas where id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function inserirTepid(t: {
  pacienteId: string;
  desenho: Desenho;
  versaoConfig: string;
  valores: MedidasDigitadas;
  alertas: AlertaTepid[];
}, cliente?: pg.ClientBase): Promise<string> {
  const sql = "insert into tepid (paciente_id, desenho, versao_config, valores, alertas) values ($1,$2,$3,$4,$5) returning id";
  const params = [t.pacienteId, t.desenho, t.versaoConfig, JSON.stringify(t.valores), JSON.stringify(t.alertas)];
  const r = cliente ? await cliente.query<{ id: string }>(sql, params) : await consultar<{ id: string }>(sql, params);
  const id = r.rows[0]?.id;
  if (!id) throw new Error("falha ao inserir tepid");
  return id;
}

/** Cache do catálogo no banco (ADR 0002 item 6): upsert idempotente por id. */
export async function upsertImplante(
  it: { id: string; fabricante: string; verificado: boolean; exemplo_nao_clinico: boolean } & Record<string, unknown>,
  cliente?: pg.ClientBase,
): Promise<void> {
  const sql = `insert into implantes (id, fabricante, payload, verificado, exemplo_nao_clinico) values ($1,$2,$3,$4,$5)
    on conflict (id) do update set fabricante = excluded.fabricante, payload = excluded.payload, verificado = excluded.verificado,
      exemplo_nao_clinico = excluded.exemplo_nao_clinico, carregado_em = now()`;
  const p = [it.id, it.fabricante, JSON.stringify(it), it.verificado, it.exemplo_nao_clinico];
  if (cliente) await cliente.query(sql, p);
  else await consultar(sql, p);
}

export interface SimulacaoLinha {
  id: string;
  malha_id: string;
  implante_id: string;
  plano: "subglandular" | "dual_plane";
  imf: "manter" | "rebaixar";
  lado: "ambos" | "dir" | "esq";
  versao_config_simulacao: string;
  nao_calibrado: boolean;
  previsto: unknown;
  mostrada_em: Date;
}

/** Cada exibição de simulação à paciente é uma linha (ADR 0002 item 5). */
export async function inserirSimulacao(
  s: { malhaId: string; implanteId: string; plano: string; imf: string; lado: string; versaoConfig: string; naoCalibrado: boolean; previsto: unknown },
  cliente?: pg.ClientBase,
): Promise<string> {
  const sql = `insert into simulacoes (malha_id, implante_id, plano, imf, lado, versao_config_simulacao, nao_calibrado, previsto)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`;
  const p = [s.malhaId, s.implanteId, s.plano, s.imf, s.lado, s.versaoConfig, s.naoCalibrado, s.previsto === undefined ? null : JSON.stringify(s.previsto)];
  const r = cliente ? await cliente.query<{ id: string }>(sql, p) : await consultar<{ id: string }>(sql, p);
  return r.rows[0]!.id;
}

export async function listarSimulacoes(malhaId: string): Promise<SimulacaoLinha[]> {
  const r = await consultar<SimulacaoLinha>("select * from simulacoes where malha_id = $1 order by mostrada_em, id", [malhaId]);
  return r.rows;
}
