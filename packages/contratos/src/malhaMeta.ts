import { z } from "zod";
import { caminhoRelativoSchema, dataHoraSchema, uuidSchema, vetor3Schema, versaoSoftwareSchema } from "./comum";

export const unidadeOrigemSchema = z.enum(["m", "cm", "mm", "desconhecida"]);
export type UnidadeOrigem = z.infer<typeof unidadeOrigemSchema>;

export const modoRecorteSchema = z.enum(["abaixo_do_pescoco", "caixa", "nenhum"]);
export type ModoRecorte = z.infer<typeof modoRecorteSchema>;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** `malha_meta/1.0` — resposta de /processar e /reescalar (contratos §7.2). */
export const malhaMetaSchema = z.strictObject({
  esquema: z.literal("malha_meta/1.0"),
  malha_id: uuidSchema,
  malha_dir: caminhoRelativoSchema,
  unidade_origem: unidadeOrigemSchema,
  unidade_inferida: z.enum(["m", "cm", "mm"]).nullable(),
  fator_unidade: z.number().positive(),
  fator_escala_acumulado: z.number().positive(),
  quadro: z.enum(["scan", "anatomico"]),
  /** opcional; ausente = upload. "foto": malha do template ajustado a fotos (/reconstruir-foto, C1) */
  origem: z.enum(["upload", "sintetico", "foto"]).optional(),
  original: z.strictObject({
    arquivo: z.string(),
    n_vertices: z.number().int().min(3),
    n_faces: z.number().int().min(1),
    sha256,
    tem_textura: z.boolean(),
  }),
  processada: z.strictObject({
    obj: z.string(),
    glb: z.string(),
    n_vertices: z.number().int().min(3),
    n_faces: z.number().int().min(1),
    sha256_glb: sha256,
    caixa_mm: z.strictObject({ min: vetor3Schema, max: vetor3Schema }),
  }),
  recorte: z.strictObject({
    modo: modoRecorteSchema,
    y_corte_mm: z.number().nullable().optional(),
    aplicado: z.boolean(),
  }),
  escala: z
    .strictObject({
      historico: z
        .array(
          z.strictObject({
            fator: z.number().positive(),
            regua: z.record(z.string(), z.unknown()).nullable().optional(),
            aplicado_em: dataHoraSchema,
          }),
        )
        .optional(),
    })
    .optional(),
  /** só em malha reconstruída por fotos: `textura_reconstruida/1.0` (C3; o web só confere o esquema) */
  textura: z.object({ esquema: z.literal("textura_reconstruida/1.0") }).passthrough().optional(),
  avisos: z.array(z.string()),
  versao_software: versaoSoftwareSchema,
  gerado_em: dataHoraSchema,
});
export type MalhaMeta = z.infer<typeof malhaMetaSchema>;
