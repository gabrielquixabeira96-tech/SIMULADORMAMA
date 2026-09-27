/**
 * Camada do LLM (ADR 0006): seleção do modo, mock determinístico, validação zod, paridade com o
 * JSON Schema, tool use forçado com modelo do env e — restrição 1 — prova, inspecionando o
 * payload capturado, de que o LLM não recebe imagem, malha, textura, nome ou CPF.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { describe, expect, it } from "vitest";
import { estruturarAnamnese } from "@/llm/anamnese";
import { ProvedorAnthropic, configAnthropicDoEnv, type ClienteMensagens } from "@/llm/anthropic";
import { anamneseLLMSchema, anamneseSchema, ferramentaAnamnese, ferramentaRelatorio, relatorioProsaSchema, OBJETIVOS_ESTETICOS, TABAGISMO, PLANEJA_GESTACAO } from "@/llm/esquemas";
import { obterProvedor } from "@/llm/fabrica";
import { higienizarTextoLLM, sha256Texto } from "@/llm/higienizar";
import { anamneseMock, ProvedorMock, PROSA_MOCK } from "@/llm/mock";
import { montarDadosTravados } from "@/llm/numeros";
import { assegurarPayloadSeguro, PayloadProibidoError } from "@/llm/payload";
import { LLMNaoConfiguradoError, modoLLM, SaidaLLMInvalidaError } from "@/llm/provedor";
import { listasPermitidas, montarEntradaRelatorio } from "@/llm/relatorio";

const RAIZ = resolve(__dirname, "../../../..");
const schemaJson = (n: string) => JSON.parse(readFileSync(resolve(RAIZ, "config/schemas", n), "utf8"));

const ENV_REAL = { ANTHROPIC_API_KEY: "sk-teste-falsa", LLM_MODELO_ANAMNESE: "modelo-rapido-de-teste", LLM_MODELO_RELATORIO: "modelo-padrao-de-teste", LLM_MAX_TOKENS: "1234" } as unknown as NodeJS.ProcessEnv;

const ANAMNESE_VALIDA = {
  esquema: "anamnese/1.0",
  queixa_principal: "deseja aumentar as mamas",
  objetivo_estetico: "aumento_moderado",
  tamanho_desejado_descricao: null,
  gestacoes: { numero: 2, amamentou: true, planeja: "nao" },
  cirurgias_mamarias_previas: [],
  comorbidades_relatadas: [],
  tabagismo: "nunca",
  medicamentos: [],
  alergias: ["dipirona"],
  expectativas_irreais_sinalizadas: false,
  campos_nao_informados: ["tamanho_desejado_descricao"],
};

/** Cliente falso: captura os parâmetros enviados e devolve um tool_use. */
function clienteFalso(resposta: (p: MessageCreateParamsNonStreaming) => unknown) {
  const capturados: MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteMensagens = {
    messages: {
      create: async (p) => {
        capturados.push(structuredClone(p));
        const input = resposta(p);
        return { content: input === undefined ? [{ type: "text", text: "sem ferramenta" }] : [{ type: "tool_use", name: (p.tool_choice as { name: string }).name, input }], usage: { input_tokens: 10, output_tokens: 20 } };
      },
    },
  };
  return { cliente, capturados };
}

const TEXTO_COM_PII =
  "Meu nome é Maria Aparecida Souza, CPF 123.456.789-09, RG 12.345.678-9, nascida em 12/03/1990, " +
  "telefone (65) 99999-1234, e-mail maria.souza@exemplo.com.br, CNS 123 4567 8901 2345, prontuário 00123456. " +
  "Deseja aumentar as mamas de forma natural. Tem dois filhos, amamentou. Não fuma. Alergia a dipirona. " +
  "Veja https://exemplo.com/foto.jpg e o arquivo /home/maria/scan.obj.";

describe("seleção do modo", () => {
  it("sem ANTHROPIC_API_KEY → mock; LLM_MODO=mock vence a chave", () => {
    expect(modoLLM({} as NodeJS.ProcessEnv)).toBe("mock");
    expect(modoLLM({ ANTHROPIC_API_KEY: "  " } as unknown as NodeJS.ProcessEnv)).toBe("mock");
    expect(modoLLM({ ...ENV_REAL, LLM_MODO: "mock" })).toBe("mock");
    expect(modoLLM(ENV_REAL)).toBe("anthropic");
    expect(obterProvedor({} as NodeJS.ProcessEnv)).toBeInstanceOf(ProvedorMock);
    expect(obterProvedor(ENV_REAL, clienteFalso(() => undefined).cliente)).toBeInstanceOf(ProvedorAnthropic);
  });

  it("este ambiente de teste roda em mock (sem chave)", () => {
    expect(modoLLM()).toBe("mock");
  });

  it("IDs de modelo vêm do env; placeholder ou ausente → LLMNaoConfigurado", () => {
    expect(configAnthropicDoEnv(ENV_REAL)).toMatchObject({ modeloAnamnese: "modelo-rapido-de-teste", modeloRelatorio: "modelo-padrao-de-teste", maxTokens: 1234 });
    expect(configAnthropicDoEnv(ENV_REAL).temperatura).toBeUndefined();
    expect(() => configAnthropicDoEnv({ ...ENV_REAL, LLM_MODELO_ANAMNESE: "<id-do-modelo-rapido>" })).toThrow(LLMNaoConfiguradoError);
    expect(() => configAnthropicDoEnv({ ...ENV_REAL, LLM_MODELO_RELATORIO: "" })).toThrow(LLMNaoConfiguradoError);
    // nenhum ID de modelo hard-coded no código-fonte
    const fonte = ["anthropic.ts", "fabrica.ts", "provedor.ts"].map((f) => readFileSync(resolve(__dirname, "../../src/llm", f), "utf8")).join("\n");
    expect(fonte).not.toMatch(/claude-[a-z0-9-]+/i);
  });
});

describe("higienização antes do LLM", () => {
  it("remove nome declarado, CPF, RG, data, telefone, e-mail, CNS/prontuário, URL e caminho", () => {
    const h = higienizarTextoLLM(TEXTO_COM_PII);
    for (const proibido of ["Maria", "Aparecida", "Souza", "123.456.789-09", "12.345.678-9", "12/03/1990", "99999-1234", "@", "123 4567 8901 2345", "00123456", "https://", "/home/maria"]) {
      expect(h, proibido).not.toContain(proibido);
    }
    expect(h).toContain("[removido]");
    expect(h).toContain("Deseja aumentar as mamas");
    expect(h).toContain("Alergia a dipirona");
  });

  it("não apaga números clínicos curtos", () => {
    expect(higienizarTextoLLM("base 120 118 mm, G2P2, 300 mL")).toBe("base 120 118 mm, G2P2, 300 mL");
  });
});

describe("mock determinístico e contratos", () => {
  it("mocks/*.json passam no zod (paridade mock × esquema)", () => {
    expect(relatorioProsaSchema.safeParse(PROSA_MOCK).success).toBe(true);
    expect(anamneseLLMSchema.safeParse(anamneseMock("")).success).toBe(true);
  });

  it("mesma entrada → mesma saída; regras extraem o básico", async () => {
    const h = higienizarTextoLLM(TEXTO_COM_PII);
    expect(anamneseMock(h)).toEqual(anamneseMock(h));
    const a = anamneseMock(h);
    expect(a.objetivo_estetico).toBe("aumento_discreto");
    expect(a.tabagismo).toBe("nunca");
    expect(a.gestacoes).toMatchObject({ numero: 2, amamentou: true });
    expect(a.alergias).toEqual(["dipirona"]);
    expect(a.campos_nao_informados).toContain("gestacoes.planeja");
  });

  it("estruturarAnamnese: valida com zod e grava hash do texto HIGIENIZADO", async () => {
    const r = await estruturarAnamnese(TEXTO_COM_PII, new ProvedorMock());
    expect(anamneseSchema.safeParse(r.anamnese).success).toBe(true);
    expect(r.anamnese.texto_fonte_hash).toBe(sha256Texto(higienizarTextoLLM(TEXTO_COM_PII)));
    expect(JSON.stringify(r.anamnese)).not.toMatch(/Maria|123\.456\.789|maria\.souza/);
    expect(r.modo).toBe("mock");
  });

  it("zod recusa saída fora do contrato", () => {
    expect(anamneseLLMSchema.safeParse({ ...ANAMNESE_VALIDA, objetivo_estetico: "enorme" }).success).toBe(false);
    expect(anamneseLLMSchema.safeParse({ ...ANAMNESE_VALIDA, campo_extra: 1 }).success).toBe(false);
    expect(anamneseLLMSchema.safeParse({ ...ANAMNESE_VALIDA, gestacoes: { numero: -1, amamentou: null, planeja: "nao" } }).success).toBe(false);
    expect(relatorioProsaSchema.safeParse({ esquema: "relatorio_prosa/1.0", paragrafos: { introducao: "x" } }).success).toBe(false);
    expect(relatorioProsaSchema.safeParse({ ...PROSA_MOCK, esquema: "relatorio_prosa/2.0" }).success).toBe(false);
  });

  it("zod espelha o JSON Schema (required e enums)", () => {
    const js = schemaJson("anamnese.schema.json");
    expect(Object.keys(anamneseLLMSchema.shape).sort()).toEqual(Object.keys(js.properties).sort());
    expect([...OBJETIVOS_ESTETICOS]).toEqual(js.properties.objetivo_estetico.enum);
    expect([...TABAGISMO]).toEqual(js.properties.tabagismo.enum);
    expect([...PLANEJA_GESTACAO]).toEqual(js.properties.gestacoes.properties.planeja.enum);
    const jp = schemaJson("relatorio_prosa.schema.json");
    expect(Object.keys(relatorioProsaSchema.shape.paragrafos.shape).sort()).toEqual([...jp.properties.paragrafos.required].sort());
  });

  it("input_schema das ferramentas = arquivos de config/schemas (sem $schema/$id e sem texto_fonte_hash)", () => {
    const fa = ferramentaAnamnese();
    expect(fa.input_schema.type).toBe("object");
    expect(fa.input_schema.$schema).toBeUndefined();
    expect(fa.input_schema.properties.texto_fonte_hash).toBeUndefined();
    expect(fa.input_schema.required).toEqual(schemaJson("anamnese.schema.json").required);
    expect(ferramentaRelatorio().input_schema.properties).toEqual(schemaJson("relatorio_prosa.schema.json").properties);
  });
});

describe("provedor Anthropic (cliente falso, sem rede): tool use forçado e payload seguro", () => {
  it("anamnese: modelo do env, tool_choice forçado, só texto higienizado — sem imagem, malha, nome ou CPF", async () => {
    const { cliente, capturados } = clienteFalso(() => ANAMNESE_VALIDA);
    const p = obterProvedor(ENV_REAL, cliente);
    const r = await estruturarAnamnese(TEXTO_COM_PII, p);
    expect(r.modo).toBe("anthropic");
    expect(r.anamnese.alergias).toEqual(["dipirona"]);
    expect(capturados).toHaveLength(1);
    const c = capturados[0]!;
    expect(c.model).toBe("modelo-rapido-de-teste");
    expect(c.max_tokens).toBe(1234);
    expect(c.temperature).toBeUndefined();
    expect(c.tool_choice).toEqual({ type: "tool", name: "registrar_anamnese", disable_parallel_tool_use: true });
    expect(c.tools?.map((t) => (t as { name: string }).name)).toEqual(["registrar_anamnese"]);
    // Inspeção do payload: só blocos de texto
    const blocos = c.messages.flatMap((m) => (typeof m.content === "string" ? [{ type: "text" }] : m.content));
    expect(blocos.every((b) => b.type === "text")).toBe(true);
    const bruto = JSON.stringify({ messages: c.messages, system: c.system });
    expect(bruto).not.toMatch(/"type":"(image|document|file)"/);
    expect(bruto).not.toMatch(/base64|data:image|\.obj\b|\.ply\b|\.glb\b|\/home\//i);
    for (const pii of ["Maria", "Souza", "123.456.789-09", "12.345.678-9", "12/03/1990", "99999-1234", "maria.souza"]) expect(bruto).not.toContain(pii);
  });

  it("relatório: entrada estruturada e pseudonimizada, sem landmarks/malha/textura; modelo do env", async () => {
    const { cliente, capturados } = clienteFalso(() => PROSA_MOCK);
    const p = obterProvedor(ENV_REAL, cliente);
    const dados = montarDadosTravados(
      {
        implantes: [{ id: "motiva-rsd-300", rotulo: "Motiva Demi (RSD-300)", plano: "dual_plane", imf: "manter", volume_ml: 300, base_mm: 116, projecao_mm: 38 }],
        medidasDigitadas: null,
        distancias: null,
        volumes: null,
      },
      "B",
    );
    // Campos proibidos colados à força na entrada são descartados pelo contrato estrito
    const entrada = { ...montarEntradaRelatorio(dados, "B", "P-7K2M9Q", listasPermitidas(dados, "B", 4.5).prosa), malha_dir: "pacientes/x", nome: "Maria" };
    await expect(p.redigirProsaRelatorio(entrada as never)).rejects.toThrow();
    const r = await p.redigirProsaRelatorio(montarEntradaRelatorio(dados, "B", "P-7K2M9Q", listasPermitidas(dados, "B", 4.5).prosa));
    expect(r.saida).toEqual(PROSA_MOCK);
    const c = capturados.at(-1)!;
    expect(c.model).toBe("modelo-padrao-de-teste");
    expect(c.tool_choice).toMatchObject({ type: "tool", name: "redigir_prosa_relatorio" });
    const texto = (c.messages[0]!.content as Array<{ type: string; text: string }>)[0]!.text;
    const enviado = JSON.parse(texto);
    expect(Object.keys(enviado).sort()).toEqual(["avisos_obrigatorios", "dados_travados", "desenho", "esquema", "numeros_permitidos", "pseudonimo"]);
    expect(enviado.pseudonimo).toMatch(/^P-[0-9A-HJ-NP-Z]{6}$/);
    expect(texto).not.toMatch(/landmarks|malha|textura|vertices|glb|base64|"nome"|cpf/i);
  });

  it("saída sem tool_use ou fora do contrato → SaidaLLMInvalidaError", async () => {
    await expect(new ProvedorAnthropic(configAnthropicDoEnv(ENV_REAL), clienteFalso(() => undefined).cliente).registrarAnamnese("texto")).rejects.toBeInstanceOf(SaidaLLMInvalidaError);
    await expect(
      new ProvedorAnthropic(configAnthropicDoEnv(ENV_REAL), clienteFalso(() => ({ ...ANAMNESE_VALIDA, tabagismo: "as vezes" })).cliente).registrarAnamnese("texto"),
    ).rejects.toBeInstanceOf(SaidaLLMInvalidaError);
  });

  it("guarda do payload recusa imagem, documento, malha, textura, nome, CPF e base64", () => {
    const ok = { messages: [{ role: "user", content: [{ type: "text", text: "anamnese sem identificação" }] }] };
    expect(() => assegurarPayloadSeguro(ok)).not.toThrow();
    const ruins: unknown[] = [
      [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo" } }] }],
      [{ role: "user", content: [{ type: "document", source: { type: "text", data: "x" } }] }],
      [{ role: "user", content: [{ type: "text", text: JSON.stringify({ malha: "a.glb" }) }] }],
      [{ role: "user", content: [{ type: "text", text: JSON.stringify({ dados: { textura: "t.png" } }) }] }],
      [{ role: "user", content: [{ type: "text", text: JSON.stringify({ nome: "Maria" }) }] }],
      [{ role: "user", content: [{ type: "text", text: JSON.stringify({ landmarks: {} }) }] }],
      [{ role: "user", content: [{ type: "text", text: "CPF 123.456.789-09" }] }],
      [{ role: "user", content: [{ type: "text", text: "A".repeat(300) }] }],
      [{ role: "user", content: [{ type: "text", text: "data:image/png;base64,AAAA" }] }],
    ];
    for (const messages of ruins) expect(() => assegurarPayloadSeguro({ messages }), JSON.stringify(messages).slice(0, 80)).toThrow(PayloadProibidoError);
  });
});
