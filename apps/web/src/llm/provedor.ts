import type { AnamneseLLM, RelatorioEntrada, RelatorioProsa } from "./esquemas";

/**
 * Interface única do LLM (ADR 0006 item 2). Duas implementações: `ProvedorAnthropic` (SDK
 * oficial, tool use forçado) e `ProvedorMock` (determinístico, sem rede).
 */
export type ModoLLM = "mock" | "anthropic";

export interface ResultadoLLM<T> {
  saida: T;
  modo: ModoLLM;
  /** ID do modelo (vem do env) ou "mock". */
  modelo: string;
  tokens?: { entrada: number; saida: number };
  latencia_ms: number;
}

export interface ProvedorLLM {
  readonly modo: ModoLLM;
  /** Texto JÁ higienizado → anamnese/1.0 (sem texto_fonte_hash). */
  registrarAnamnese(textoHigienizado: string): Promise<ResultadoLLM<AnamneseLLM>>;
  /** relatorio_entrada/1.0 → relatorio_prosa/1.0 (ainda NÃO verificada contra números). */
  redigirProsaRelatorio(entrada: RelatorioEntrada): Promise<ResultadoLLM<RelatorioProsa>>;
}

/** Saída do LLM fora do contrato (sem tool_use, JSON inválido, zod recusou). Nunca vira texto livre. */
export class SaidaLLMInvalidaError extends Error {
  readonly codigo = "saida_llm_invalida" as const;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SaidaLLMInvalidaError";
  }
}

/** Configuração ausente/placeholder (ex.: LLM_MODELO_* não preenchido) com chave presente. */
export class LLMNaoConfiguradoError extends Error {
  readonly codigo = "llm_nao_configurado" as const;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "LLMNaoConfiguradoError";
  }
}

/** Falha de rede/API do provedor real. */
export class ProvedorLLMIndisponivelError extends Error {
  readonly codigo = "llm_indisponivel" as const;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ProvedorLLMIndisponivelError";
  }
}

/** Seleção do modo (ADR 0006): `LLM_MODO=mock` OU sem `ANTHROPIC_API_KEY` → mock. */
export function modoLLM(env: NodeJS.ProcessEnv = process.env): ModoLLM {
  if ((env.LLM_MODO ?? "").trim().toLowerCase() === "mock") return "mock";
  if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.trim() === "") return "mock";
  return "anthropic";
}
