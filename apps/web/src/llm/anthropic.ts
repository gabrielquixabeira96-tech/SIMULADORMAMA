import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import type { ZodType } from "zod";
import {
  anamneseLLMSchema,
  ferramentaAnamnese,
  ferramentaRelatorio,
  relatorioEntradaSchema,
  relatorioProsaSchema,
  type AnamneseLLM,
  type DefinicaoFerramenta,
  type RelatorioEntrada,
  type RelatorioProsa,
} from "./esquemas";
import { assegurarPayloadSeguro } from "./payload";
import { LLMNaoConfiguradoError, ProvedorLLMIndisponivelError, SaidaLLMInvalidaError, type ProvedorLLM, type ResultadoLLM } from "./provedor";

/**
 * Provedor real (ADR 0006): SDK oficial `@anthropic-ai/sdk` (MIT), só no servidor. Tool use com o
 * JSON Schema dos contratos e `tool_choice` forçando a ferramenta; a saída é revalidada com zod.
 * IDs de modelo vêm SEMPRE do env (`LLM_MODELO_ANAMNESE`, `LLM_MODELO_RELATORIO`).
 */

/** Subconjunto do cliente usado aqui (permite injetar um cliente falso nos testes). */
export interface ClienteMensagens {
  messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<{
      content: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string | null;
    }>;
  };
}

export interface ConfigAnthropic {
  apiKey: string;
  modeloAnamnese: string;
  modeloRelatorio: string;
  maxTokens: number;
  /** Opcional: modelos recentes recusam temperature ≠ 1; só é enviada se definida no env. */
  temperatura?: number;
}

const PLACEHOLDER = /^<.*>$|^$/;

export function configAnthropicDoEnv(env: NodeJS.ProcessEnv = process.env): ConfigAnthropic {
  const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  const modeloAnamnese = (env.LLM_MODELO_ANAMNESE ?? "").trim();
  const modeloRelatorio = (env.LLM_MODELO_RELATORIO ?? "").trim();
  if (!apiKey) throw new LLMNaoConfiguradoError("ANTHROPIC_API_KEY ausente");
  if (PLACEHOLDER.test(modeloAnamnese) || PLACEHOLDER.test(modeloRelatorio)) {
    throw new LLMNaoConfiguradoError("LLM_MODELO_ANAMNESE/LLM_MODELO_RELATORIO não preenchidos (IDs de modelo vêm do env)");
  }
  const mt = Number(env.LLM_MAX_TOKENS);
  const temp = env.LLM_TEMPERATURA !== undefined && env.LLM_TEMPERATURA.trim() !== "" ? Number(env.LLM_TEMPERATURA) : undefined;
  return {
    apiKey,
    modeloAnamnese,
    modeloRelatorio,
    maxTokens: Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : 2000,
    ...(temp !== undefined && Number.isFinite(temp) ? { temperatura: temp } : {}),
  };
}

export const SISTEMA_ANAMNESE = [
  "Você estrutura a anamnese de uma consulta de cirurgia plástica (mamoplastia de aumento).",
  "Responda SOMENTE chamando a ferramenta registrar_anamnese.",
  "Use apenas o que está no texto; quando algo não for dito, use null, 'nao_informado' ou lista vazia e cite o campo em campos_nao_informados.",
  "Não faça recomendação clínica. Não inclua nome, documento, contato ou datas; o texto já foi pseudonimizado e trechos '[removido]' devem ser ignorados.",
].join(" ");

export const SISTEMA_RELATORIO = [
  "Você redige, em português do Brasil e linguagem acessível, os parágrafos de prosa de um relatório para a paciente sobre uma simulação 3D ilustrativa.",
  "Responda SOMENTE chamando a ferramenta redigir_prosa_relatorio.",
  "Os números do relatório são exibidos por um template travado fora do seu texto.",
  "Na prosa, NÃO escreva nenhum número, nem por extenso (inclusive contagens como 'dois implantes'; prefira 'ambos'), exceto os de numeros_permitidos copiados exatamente.",
  "Não faça recomendação clínica, não sugira implante, plano ou conduta e não prometa resultado.",
  "Inclua a ideia de que a simulação é 'Ilustração, não previsão de resultado'.",
].join(" ");

export class ProvedorAnthropic implements ProvedorLLM {
  readonly modo = "anthropic" as const;
  private readonly cliente: ClienteMensagens;

  constructor(
    private readonly config: ConfigAnthropic,
    cliente?: ClienteMensagens,
  ) {
    this.cliente = cliente ?? (new Anthropic({ apiKey: config.apiKey, maxRetries: 1, timeout: 60_000 }) as unknown as ClienteMensagens);
  }

  private async chamar<T>(modelo: string, sistema: string, ferramenta: DefinicaoFerramenta, conteudo: string, schema: ZodType<T>): Promise<ResultadoLLM<T>> {
    const params: MessageCreateParamsNonStreaming = {
      model: modelo,
      max_tokens: this.config.maxTokens,
      ...(this.config.temperatura !== undefined ? { temperature: this.config.temperatura } : {}),
      system: sistema,
      tools: [ferramenta],
      tool_choice: { type: "tool", name: ferramenta.name, disable_parallel_tool_use: true },
      // Só texto: nunca blocos de imagem/documento (restrição 1).
      messages: [{ role: "user", content: [{ type: "text", text: conteudo }] }],
    };
    assegurarPayloadSeguro(params as unknown as Parameters<typeof assegurarPayloadSeguro>[0]);
    const t0 = performance.now();
    let resp: Awaited<ReturnType<ClienteMensagens["messages"]["create"]>>;
    try {
      resp = await this.cliente.messages.create(params);
    } catch (e) {
      throw new ProvedorLLMIndisponivelError(`falha na API do LLM: ${(e as Error)?.name ?? "erro"}`);
    }
    const latencia_ms = performance.now() - t0;
    const bloco = resp.content.find((b) => b.type === "tool_use" && b.name === ferramenta.name);
    if (!bloco) throw new SaidaLLMInvalidaError(`o modelo não chamou a ferramenta ${ferramenta.name}`);
    const r = schema.safeParse(bloco.input);
    if (!r.success) {
      throw new SaidaLLMInvalidaError(
        `saída de ${ferramenta.name} fora do contrato: ${r.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    return {
      saida: r.data,
      modo: "anthropic",
      modelo,
      latencia_ms,
      ...(resp.usage ? { tokens: { entrada: resp.usage.input_tokens, saida: resp.usage.output_tokens } } : {}),
    };
  }

  async registrarAnamnese(textoHigienizado: string): Promise<ResultadoLLM<AnamneseLLM>> {
    const conteudo = `Texto da anamnese (higienizado):\n<anamnese>\n${textoHigienizado}\n</anamnese>`;
    return this.chamar(this.config.modeloAnamnese, SISTEMA_ANAMNESE, ferramentaAnamnese(), conteudo, anamneseLLMSchema);
  }

  async redigirProsaRelatorio(entrada: RelatorioEntrada): Promise<ResultadoLLM<RelatorioProsa>> {
    // Revalida a entrada: só os campos do contrato chegam ao modelo (strict).
    const limpa = relatorioEntradaSchema.parse(entrada);
    return this.chamar(this.config.modeloRelatorio, SISTEMA_RELATORIO, ferramentaRelatorio(), JSON.stringify(limpa), relatorioProsaSchema);
  }
}
