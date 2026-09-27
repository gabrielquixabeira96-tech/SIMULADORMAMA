import { z } from "zod";
import { caminhoRelativoSchema, vetor3Schema } from "./comum";
import { landmarksSchema } from "./landmarks";
import { distanciasSchema, geodesicaInfoSchema, quadroAnatomicoSchema, volumesSchema } from "./medidas";
import { modoRecorteSchema, unidadeOrigemSchema } from "./malhaMeta";

/** Cabeçalho obrigatório em toda requisição ao services/mesh (contratos §7). */
export const CABECALHO_DESENHO = "X-Desenho" as const;

/** GET /saude (§7.1) */
export const saudeRespostaSchema = z.object({
  status: z.literal("ok"),
  versao_software: z.string(),
  contrato: z.string(),
  geodesica: z.object({ biblioteca: z.string(), versao: z.string() }).partial().optional(),
});
export type SaudeResposta = z.infer<typeof saudeRespostaSchema>;

/** POST /processar (§7.2) — requisição. */
export const processarRequisicaoSchema = z.strictObject({
  malha_dir: caminhoRelativoSchema,
  arquivo_original: caminhoRelativoSchema,
  unidade_origem: unidadeOrigemSchema,
  recorte: z.strictObject({
    modo: modoRecorteSchema,
    y_max_mm: z.number().nullable(),
    y_min_mm: z.number().nullable(),
  }),
  decimacao: z.strictObject({
    alvo_vertices: z.number().int().positive(),
    min_vertices: z.number().int().positive(),
    max_vertices: z.number().int().positive(),
  }),
});
export type ProcessarRequisicao = z.infer<typeof processarRequisicaoSchema>;

/** POST /reescalar (§7.3) — requisição. */
export const reescalarRequisicaoSchema = z.strictObject({
  malha_dir: caminhoRelativoSchema,
  fator: z.number().positive(),
  regua: z.strictObject({
    regua_mm: z.number().positive(),
    pontos: z.tuple([vetor3Schema, vetor3Schema]),
  }),
});
export type ReescalarRequisicao = z.infer<typeof reescalarRequisicaoSchema>;

/** POST /medir (§7.4) — requisição. */
export const medirRequisicaoSchema = z.strictObject({
  malha_dir: caminhoRelativoSchema,
  landmarks: landmarksSchema,
  distancias_euclidianas_web: z.record(z.string(), z.number()),
  incluir_geodesica: z.boolean(),
  incluir_volume: z.boolean(),
});
export type MedirRequisicao = z.infer<typeof medirRequisicaoSchema>;

/** POST /medir — resposta. */
export const medirRespostaSchema = z.object({
  distancias: distanciasSchema,
  volumes: volumesSchema.nullable(),
  quadro_anatomico: quadroAnatomicoSchema.nullable(),
  geodesica: geodesicaInfoSchema.nullable(),
  avisos: z.array(z.string()),
});
export type MedirResposta = z.infer<typeof medirRespostaSchema>;

/** Decimação padrão do contrato (§7.2). */
export const DECIMACAO_PADRAO = { alvo_vertices: 40000, min_vertices: 30000, max_vertices: 50000 } as const;
