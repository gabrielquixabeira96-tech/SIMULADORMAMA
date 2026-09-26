import { z } from "zod";

/** `tepid_config/1.0` (contratos §8; config/schemas/tepid_config.schema.json). */
export const nomeCampoTepidSchema = z.enum(["base_mm", "apss_mm", "pinca_polo_superior_mm", "pinca_sulco_mm", "n_imf_estirado_mm", "volume_ml"]);

export const campoTepidSchema = z.strictObject({
  rotulo: z.string(),
  unidade: z.literal("mm"),
  min: z.number(),
  max: z.number(),
  por_lado: z.boolean(),
  obrigatorio: z.boolean(),
});
export type CampoTepid = z.infer<typeof campoTepidSchema>;

export const regraTepidSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9_]+$/),
    campo: nomeCampoTepidSchema,
    operador: z.enum(["<", "<=", ">", ">=", "entre"]),
    limiar_mm: z.number().optional(),
    limiar_min_mm: z.number().optional(),
    limiar_max_mm: z.number().optional(),
    alerta: z.string(),
    conferir_no_texto_original: z.boolean(),
    fonte_pagina: z.number().int().nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.operador === "entre") {
      if (r.limiar_min_mm === undefined || r.limiar_max_mm === undefined) ctx.addIssue({ code: "custom", message: "entre exige limiar_min_mm e limiar_max_mm" });
    } else if (r.limiar_mm === undefined) {
      ctx.addIssue({ code: "custom", message: "operador exige limiar_mm" });
    }
    if (!r.conferir_no_texto_original && r.fonte_pagina === null) {
      ctx.addIssue({ code: "custom", message: "regra conferida exige fonte_pagina" });
    }
  });
export type RegraTepid = z.infer<typeof regraTepidSchema>;

const faixaSchema = z.union([
  z.strictObject({ ate: z.number(), valor: z.number() }),
  z.strictObject({ acima: z.number(), valor: z.number() }),
]);

export const tabelaTepidSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  descricao: z.string().optional(),
  entrada: nomeCampoTepidSchema,
  saida: z.enum(["volume_ml", "delta_volume_ml", "n_imf_mm"]),
  pontos: z.array(z.tuple([z.number(), z.number()])).min(2).optional(),
  interpolar: z.enum(["linear", "degrau"]).optional(),
  faixas: z.array(faixaSchema).optional(),
  conferir_no_texto_original: z.boolean(),
  fonte_pagina: z.number().int().nullable(),
});
export type TabelaTepid = z.infer<typeof tabelaTepidSchema>;

export const tepidConfigSchema = z.strictObject({
  esquema: z.literal("tepid_config/1.0"),
  versao: z.string(),
  status: z.enum(["nao_conferido", "conferido"]),
  nota: z.string().min(1),
  fonte: z.strictObject({ referencia: z.string(), doi: z.string().optional(), nota: z.string() }),
  campos: z.strictObject({
    base_mm: campoTepidSchema,
    apss_mm: campoTepidSchema,
    pinca_polo_superior_mm: campoTepidSchema,
    pinca_sulco_mm: campoTepidSchema,
    n_imf_estirado_mm: campoTepidSchema,
  }),
  regras: z.array(regraTepidSchema),
  tabelas: z.array(tabelaTepidSchema),
});
export type TepidConfig = z.infer<typeof tepidConfigSchema>;

/** Alerta gerado por uma regra (só em DESENHO=B). Nunca é decisão. */
export interface AlertaTepid {
  regra_id: string;
  campo: string;
  lado: "dir" | "esq" | null;
  valor_mm: number;
  alerta: string;
  conferir_no_texto_original: boolean;
}
