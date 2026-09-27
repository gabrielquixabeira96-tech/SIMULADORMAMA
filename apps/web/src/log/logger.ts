import { higienizar, higienizarTexto } from "./higienizar";

/**
 * Logger estruturado (JSON por linha) que SEMPRE higieniza os campos antes de escrever.
 * Regra do projeto: nenhum `console.*` fora deste módulo (lint `no-console`).
 */
export type NivelLog = "debug" | "info" | "warn" | "error";
const ORDEM: Record<NivelLog, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LinhaLog {
  ts: string;
  nivel: NivelLog;
  evento: string;
  [campo: string]: unknown;
}

type Saida = (linha: LinhaLog) => void;

const saidaPadrao: Saida = (linha) => {
  const txt = JSON.stringify(linha);
  if (linha.nivel === "error" || linha.nivel === "warn") console.error(txt);
  else console.log(txt);
};

let saida: Saida = saidaPadrao;

/** Troca o destino dos logs (testes). Retorna função que restaura o padrão. */
export function configurarSaidaLog(nova: Saida): () => void {
  saida = nova;
  return () => {
    saida = saidaPadrao;
  };
}

function nivelMinimo(): NivelLog {
  const n = (process.env.LOG_LEVEL || "").toLowerCase();
  if (n in ORDEM) return n as NivelLog;
  return process.env.NODE_ENV === "test" ? "error" : "info";
}

function escrever(nivel: NivelLog, evento: string, campos: Record<string, unknown> = {}): void {
  if (ORDEM[nivel] < ORDEM[nivelMinimo()] && saida === saidaPadrao) return;
  const limpos = higienizar(campos) as Record<string, unknown>;
  const linha: LinhaLog = { ...limpos, ts: new Date().toISOString(), nivel, evento: higienizarTexto(evento) };
  saida(linha);
}

export const log = {
  debug: (evento: string, campos?: Record<string, unknown>) => escrever("debug", evento, campos),
  info: (evento: string, campos?: Record<string, unknown>) => escrever("info", evento, campos),
  warn: (evento: string, campos?: Record<string, unknown>) => escrever("warn", evento, campos),
  error: (evento: string, campos?: Record<string, unknown>) => escrever("error", evento, campos),
};
