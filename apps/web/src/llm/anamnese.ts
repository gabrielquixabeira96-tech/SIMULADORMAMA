import { log } from "@/log/logger";
import { anamneseSchema, type Anamnese } from "./esquemas";
import { higienizarTextoLLM, sha256Texto } from "./higienizar";
import { detectarNomes } from "./nomes";
import type { ModoLLM, ProvedorLLM } from "./provedor";

export const LIMITE_TEXTO_ANAMNESE = 20_000;

/** O texto (já higienizado) ainda parece conter nome de pessoa: o envio é recusado (422). */
export class NomeProprioError extends Error {
  readonly codigo = "nome_proprio_detectado" as const;
  constructor(readonly sinais: string[]) {
    super("O texto parece conter o nome de uma pessoa. Remova o nome (e pronomes de tratamento como Sra., Dona) e envie de novo.");
    this.name = "NomeProprioError";
  }
}

/**
 * Higieniza o texto livre e recusa (NomeProprioError) se ainda sobrar nome de pessoa: nome
 * próprio não se remove com segurança por regex, então o usuário é que tira o nome.
 */
export function higienizarSemNome(textoBruto: string): string {
  const higienizado = higienizarTextoLLM(textoBruto.slice(0, LIMITE_TEXTO_ANAMNESE));
  const nomes = detectarNomes(higienizado);
  if (nomes.length > 0) throw new NomeProprioError([...new Set(nomes.map((n) => n.sinal))]);
  return higienizado;
}

export interface ResultadoAnamnese {
  anamnese: Anamnese;
  modo: ModoLLM;
  modelo: string;
}

/**
 * Texto livre → `anamnese/1.0` validado (Marco 2b). O texto bruto é higienizado ANTES do provedor
 * e nunca é persistido nem logado; o hash do texto higienizado vai em `texto_fonte_hash`.
 */
export async function estruturarAnamnese(textoBruto: string, provedor: ProvedorLLM, contexto: { atendimentoId?: string } = {}): Promise<ResultadoAnamnese> {
  const higienizado = higienizarSemNome(textoBruto);
  const r = await provedor.registrarAnamnese(higienizado);
  const anamnese = anamneseSchema.parse({ ...r.saida, texto_fonte_hash: sha256Texto(higienizado) });
  // Log só metadados (ADR 0006 item 9): nunca o texto de entrada ou a saída.
  log.info("llm_anamnese", { atendimento_id: contexto.atendimentoId ?? null, modo: r.modo, modelo: r.modelo, tokens: r.tokens ?? null, latencia_ms: Math.round(r.latencia_ms) });
  return { anamnese, modo: r.modo, modelo: r.modelo };
}
