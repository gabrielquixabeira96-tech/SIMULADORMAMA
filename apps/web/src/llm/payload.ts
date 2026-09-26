/**
 * Guarda do payload enviado ao LLM (restrição inegociável 1; ADR 0006). Roda em TODA chamada
 * ao provedor real, imediatamente antes do envio, e lança se encontrar:
 *  - bloco de conteúdo que não seja texto (imagem, documento, arquivo);
 *  - chave que indique imagem, malha, textura, arquivo ou identificação pessoal;
 *  - base64 longo / data URI (imagem embutida);
 *  - CPF, e-mail, telefone, data completa, caminho absoluto no texto;
 *  - nome de pessoa (pronome de tratamento + nome, ou prenome comum; `nomes.ts`).
 */
import { detectarNomes } from "./nomes";

export class PayloadProibidoError extends Error {
  readonly codigo = "payload_llm_proibido" as const;
  constructor(readonly motivo: string) {
    super(`payload do LLM recusado: ${motivo}`);
    this.name = "PayloadProibidoError";
  }
}

export const CHAVES_PROIBIDAS = [
  // imagem / malha / textura / arquivo
  "imagem",
  "imagens",
  "image",
  "foto",
  "fotos",
  "photo",
  "textura",
  "texturas",
  "texture",
  "malha",
  "malhas",
  "mesh",
  "malha_dir",
  "malha_id",
  "glb",
  "gltf",
  "obj",
  "ply",
  "vertices",
  "faces",
  "landmarks",
  "quadro_anatomico",
  "morphs",
  "arquivo",
  "caminho",
  "pdf_caminho",
  "source",
  // identificação pessoal
  "nome",
  "name_paciente",
  "nome_completo",
  "cpf",
  "rg",
  "cns",
  "email",
  "telefone",
  "celular",
  "endereco",
  "nascimento",
  "data_nascimento",
  "paciente_id",
] as const;

const TIPOS_BLOCO_PERMITIDOS = new Set(["text", "tool_use", "tool_result"]);

const PADROES_TEXTO: Array<[RegExp, string]> = [
  [/data:[a-z]+\/[a-z0-9.+-]+;base64,/i, "data URI"],
  [/[A-Za-z0-9+/]{200,}={0,2}/, "base64 longo"],
  [/(?<![\w-])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?![\w-])/, "CPF"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "e-mail"],
  [/(?<![\w-])\(?\d{2}\)?[\s-]?9\d{4}[\s-]?\d{4}(?![\w-])/, "telefone"],
  [/(?<![\w-])\d{1,2}\/\d{1,2}\/\d{4}(?![\w-])/, "data completa"],
  [/(?<![\w.])\/(?:home|root|Users|var|tmp|mnt|opt|srv|data)\//, "caminho absoluto"],
];

function varrer(v: unknown, caminho: string, dentroDeConteudo: boolean): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => varrer(x, `${caminho}[${i}]`, dentroDeConteudo));
    return;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (dentroDeConteudo && typeof o.type === "string" && !TIPOS_BLOCO_PERMITIDOS.has(o.type)) {
      throw new PayloadProibidoError(`bloco de conteúdo '${o.type}' em ${caminho}`);
    }
    for (const [k, x] of Object.entries(o)) {
      if ((CHAVES_PROIBIDAS as readonly string[]).includes(k.toLowerCase())) throw new PayloadProibidoError(`chave '${k}' em ${caminho}`);
      varrer(x, `${caminho}.${k}`, dentroDeConteudo || k === "content" || k === "messages");
    }
    return;
  }
  if (typeof v === "string") {
    for (const [re, nome] of PADROES_TEXTO) if (re.test(v)) throw new PayloadProibidoError(`${nome} em ${caminho}`);
    // Nome de pessoa: só os sinais fortes (o de "palavras capitalizadas" daria falso positivo nos
    // rótulos do catálogo, que entram no payload do relatório).
    if (detectarNomes(v).some((n) => n.sinal !== "palavras_capitalizadas")) throw new PayloadProibidoError(`nome de pessoa em ${caminho}`);
    // Texto que é JSON (entrada estruturada da ferramenta): as chaves internas também são checadas.
    const t = v.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      let interno: unknown;
      try {
        interno = JSON.parse(t);
      } catch {
        return;
      }
      varrer(interno, `${caminho}<json>`, false);
    }
  }
}

/**
 * Valida os parâmetros de `messages.create`. As definições de ferramentas (`tools`, JSON Schema dos
 * contratos) não são dados de paciente e ficam fora da varredura de chaves.
 */
export function assegurarPayloadSeguro(params: { messages: unknown; system?: unknown; tools?: unknown; [k: string]: unknown }): void {
  varrer(params.messages, "messages", true);
  if (params.system !== undefined) varrer(params.system, "system", true);
  // tools: só checa que não há bloco de imagem nem base64 nas descrições
  const toolsTxt = JSON.stringify(params.tools ?? []);
  if (/data:[a-z]+\/[a-z0-9.+-]+;base64,|[A-Za-z0-9+/]{200,}/i.test(toolsTxt)) throw new PayloadProibidoError("conteúdo binário em tools");
}
