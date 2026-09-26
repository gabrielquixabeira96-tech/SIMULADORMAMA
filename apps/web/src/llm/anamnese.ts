import { log } from "@/log/logger";
import { anamneseSchema, type Anamnese } from "./esquemas";
import { higienizarTextoLLM, sha256Texto } from "./higienizar";
import type { ModoLLM, ProvedorLLM } from "./provedor";

export const LIMITE_TEXTO_ANAMNESE = 20_000;

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
  const higienizado = higienizarTextoLLM(textoBruto.slice(0, LIMITE_TEXTO_ANAMNESE));
  const r = await provedor.registrarAnamnese(higienizado);
  const anamnese = anamneseSchema.parse({ ...r.saida, texto_fonte_hash: sha256Texto(higienizado) });
  // Log só metadados (ADR 0006 item 9): nunca o texto de entrada ou a saída.
  log.info("llm_anamnese", { atendimento_id: contexto.atendimentoId ?? null, modo: r.modo, modelo: r.modelo, tokens: r.tokens ?? null, latencia_ms: Math.round(r.latencia_ms) });
  return { anamnese, modo: r.modo, modelo: r.modelo };
}
