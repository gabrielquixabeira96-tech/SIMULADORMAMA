import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desenhoSchema, pseudonimoSchema } from "@simulador/contratos";
import { z } from "zod";
import { raizRepo } from "@/config/ambiente";

/**
 * Espelho zod dos contratos do LLM (contratos §14; config/schemas/anamnese.schema.json e
 * relatorio_prosa.schema.json). O JSON Schema é o `input_schema` da ferramenta (tool use); o zod
 * revalida a saída antes do uso (ADR 0006 item 3). Um teste confere que os dois concordam.
 */

const texto = (max: number) => z.string().max(max);

export const OBJETIVOS_ESTETICOS = ["aumento_discreto", "aumento_moderado", "aumento_marcado", "correcao_assimetria", "outro"] as const;
export const PLANEJA_GESTACAO = ["sim", "nao", "incerto", "nao_informado"] as const;
export const TABAGISMO = ["nunca", "ex", "atual", "nao_informado"] as const;

/** Saída da ferramenta `registrar_anamnese` (o LLM não preenche `texto_fonte_hash`). */
export const anamneseLLMSchema = z.strictObject({
  esquema: z.literal("anamnese/1.0"),
  queixa_principal: texto(1000),
  objetivo_estetico: z.enum(OBJETIVOS_ESTETICOS),
  tamanho_desejado_descricao: texto(300).nullable(),
  gestacoes: z.strictObject({
    numero: z.number().int().min(0).nullable(),
    amamentou: z.boolean().nullable(),
    planeja: z.enum(PLANEJA_GESTACAO),
  }),
  cirurgias_mamarias_previas: z.array(texto(200)),
  comorbidades_relatadas: z.array(texto(200)),
  tabagismo: z.enum(TABAGISMO),
  medicamentos: z.array(texto(200)),
  alergias: z.array(texto(200)),
  expectativas_irreais_sinalizadas: z.boolean(),
  campos_nao_informados: z.array(z.string()),
  texto_fonte_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/** `anamnese/1.0` completo, como é gravado (com o hash preenchido pelo web). */
export const anamneseSchema = anamneseLLMSchema.extend({ texto_fonte_hash: z.string().regex(/^[a-f0-9]{64}$/) });
export type Anamnese = z.infer<typeof anamneseSchema>;
export type AnamneseLLM = z.infer<typeof anamneseLLMSchema>;

export const PARAGRAFOS_PROSA = ["introducao", "o_que_foi_simulado", "limitacoes", "proximos_passos"] as const;
export type ParagrafoProsa = (typeof PARAGRAFOS_PROSA)[number];

export const relatorioProsaSchema = z.strictObject({
  esquema: z.literal("relatorio_prosa/1.0"),
  paragrafos: z.strictObject({
    introducao: z.string().min(1).max(1500),
    o_que_foi_simulado: z.string().min(1).max(2000),
    limitacoes: z.string().min(1).max(2000),
    proximos_passos: z.string().min(1).max(1500),
  }),
});
export type RelatorioProsa = z.infer<typeof relatorioProsaSchema>;

const numeroOpc = z.number().finite().optional();
export const implanteMostradoSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  rotulo: z.string().min(1).max(200),
  plano: z.enum(["subglandular", "dual_plane"]),
  imf: z.enum(["manter", "rebaixar"]),
  base_mm: numeroOpc,
  projecao_mm: numeroOpc,
  volume_ml: numeroOpc,
});

/** Entrada da ferramenta `redigir_prosa_relatorio` (contratos §14.3): só dados estruturados e pseudonimizados. */
export const relatorioEntradaSchema = z.strictObject({
  esquema: z.literal("relatorio_entrada/1.0"),
  desenho: desenhoSchema,
  pseudonimo: pseudonimoSchema,
  dados_travados: z.strictObject({
    implantes_mostrados: z.array(implanteMostradoSchema),
    medidas_digitadas: z.record(z.string(), z.strictObject({ dir: z.number(), esq: z.number() })).nullable(),
    distancias: z.record(z.string(), z.strictObject({ euclidiana_mm: z.number(), geodesica_mm: z.number().nullable() }).nullable()).nullable(),
    volumes: z
      .record(z.string(), z.object({ valor_ml: z.number(), incerteza_ml: z.number() }).passthrough().nullable())
      .nullable(),
  }),
  numeros_permitidos: z.array(z.string().regex(/^\d+([.,]\d+)?$/)),
  avisos_obrigatorios: z.array(z.string()),
});
export type RelatorioEntrada = z.infer<typeof relatorioEntradaSchema>;

// ---------------------------------------------------------------- ferramentas (tool use)

export interface DefinicaoFerramenta {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; [k: string]: unknown };
}

function lerSchema(nome: string): Record<string, unknown> {
  const dir = process.env.CONFIG_DIR ? resolve(/*turbopackIgnore: true*/ process.env.CONFIG_DIR, "schemas") : resolve(/*turbopackIgnore: true*/ raizRepo(), "config/schemas");
  return JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ dir, nome), "utf8")) as Record<string, unknown>;
}

/** JSON Schema do arquivo, sem metadados ($schema/$id/title) e sem os campos que o web preenche. */
export function inputSchemaDe(nome: string, remover: string[] = []): DefinicaoFerramenta["input_schema"] {
  const { $schema: _s, $id: _i, title: _t, description: _d, ...resto } = lerSchema(nome);
  void _s;
  void _i;
  void _t;
  void _d;
  const props = { ...(resto.properties as Record<string, unknown>) };
  for (const k of remover) delete props[k];
  const required = ((resto.required as string[]) ?? []).filter((k) => !remover.includes(k));
  return { ...resto, type: "object", properties: props, required };
}

export const FERRAMENTA_ANAMNESE = "registrar_anamnese";
export const FERRAMENTA_RELATORIO = "redigir_prosa_relatorio";

export function ferramentaAnamnese(): DefinicaoFerramenta {
  return {
    name: FERRAMENTA_ANAMNESE,
    description:
      "Registra a anamnese estruturada (anamnese/1.0) extraída do texto livre higienizado. Use 'nao_informado', null ou listas vazias quando o texto não disser; liste esses campos em campos_nao_informados. Não invente dados.",
    input_schema: inputSchemaDe("anamnese.schema.json", ["texto_fonte_hash"]),
  };
}

export function ferramentaRelatorio(): DefinicaoFerramenta {
  return {
    name: FERRAMENTA_RELATORIO,
    description:
      "Redige SOMENTE os parágrafos de prosa do relatório para a paciente (relatorio_prosa/1.0). Os números ficam no template travado; na prosa só podem aparecer números de numeros_permitidos, copiados exatamente, e nenhum número por extenso.",
    input_schema: inputSchemaDe("relatorio_prosa.schema.json"),
  };
}
