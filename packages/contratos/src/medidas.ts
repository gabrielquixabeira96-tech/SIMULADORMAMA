import { z } from "zod";
import { dataHoraSchema, desenhoSchema, pseudonimoSchema, uuidSchema, vetor3Schema, versaoSoftwareSchema } from "./comum";
import type { LandmarkId } from "./landmarks";
import { landmarksSchema } from "./landmarks";

/** Distâncias canônicas (contratos §3.1): id → [de, para]. */
export const DISTANCIAS = {
  ssn_n_dir: ["furcula", "mamilo_dir"],
  ssn_n_esq: ["furcula", "mamilo_esq"],
  n_imf_dir: ["mamilo_dir", "sulco_dir"],
  n_imf_esq: ["mamilo_esq", "sulco_esq"],
  base_dir: ["base_medial_dir", "base_lateral_dir"],
  base_esq: ["base_medial_esq", "base_lateral_esq"],
  intermamilar: ["mamilo_dir", "mamilo_esq"],
} as const satisfies Record<string, readonly [LandmarkId, LandmarkId]>;

export type DistanciaId = keyof typeof DISTANCIAS;
export const DISTANCIA_IDS = Object.keys(DISTANCIAS) as DistanciaId[];

export const ROTULOS_DISTANCIAS: Record<DistanciaId, string> = {
  ssn_n_dir: "Fúrcula–mamilo D (SSN-N)",
  ssn_n_esq: "Fúrcula–mamilo E (SSN-N)",
  n_imf_dir: "Mamilo–sulco D (N-IMF, repouso)",
  n_imf_esq: "Mamilo–sulco E (N-IMF, repouso)",
  base_dir: "Largura da base D",
  base_esq: "Largura da base E",
  intermamilar: "Intermamilar",
};

export const distanciaSchema = z.strictObject({
  euclidiana_mm: z.number().min(0),
  geodesica_mm: z.number().min(0).nullable(),
});
export type Distancia = z.infer<typeof distanciaSchema>;

export const distanciasSchema = z.strictObject({
  ssn_n_dir: distanciaSchema.nullable(),
  ssn_n_esq: distanciaSchema.nullable(),
  n_imf_dir: distanciaSchema.nullable(),
  n_imf_esq: distanciaSchema.nullable(),
  base_dir: distanciaSchema.nullable(),
  base_esq: distanciaSchema.nullable(),
  intermamilar: distanciaSchema.nullable(),
});
export type Distancias = z.infer<typeof distanciasSchema>;

export const volumeSchema = z.strictObject({
  valor_ml: z.number().min(0),
  incerteza_ml: z.number().min(0),
  metodo: z.literal("plano_base_elipse"),
  motivo: z.string().optional(),
});
export type Volume = z.infer<typeof volumeSchema>;

export const volumesSchema = z.strictObject({
  dir: volumeSchema.nullable(),
  esq: volumeSchema.nullable(),
});
export type Volumes = z.infer<typeof volumesSchema>;

export const quadroAnatomicoSchema = z.strictObject({
  origem: vetor3Schema,
  x: vetor3Schema,
  y: vetor3Schema,
  z: vetor3Schema,
  matriz: z.array(z.number()).length(16),
});
export type QuadroAnatomico = z.infer<typeof quadroAnatomicoSchema>;

export const geodesicaInfoSchema = z.strictObject({
  algoritmo: z.enum(["mmp", "calor"]),
  biblioteca: z.string(),
  versao: z.string().optional(),
});

export const porLadoSchema = z.strictObject({ dir: z.number().min(0), esq: z.number().min(0) });
export type PorLado = z.infer<typeof porLadoSchema>;

export const CAMPOS_DIGITADOS = ["base_mm", "apss_mm", "pinca_polo_superior_mm", "pinca_sulco_mm", "n_imf_estirado_mm"] as const;
export type CampoDigitado = (typeof CAMPOS_DIGITADOS)[number];

export const medidasDigitadasSchema = z.strictObject({
  base_mm: porLadoSchema,
  apss_mm: porLadoSchema,
  pinca_polo_superior_mm: porLadoSchema,
  pinca_sulco_mm: porLadoSchema,
  n_imf_estirado_mm: porLadoSchema,
});
export type MedidasDigitadas = z.infer<typeof medidasDigitadasSchema>;

export const escalaSchema = z.strictObject({
  metodo: z.enum(["regua_2_pontos", "gabarito", "nenhuma"]),
  regua_mm: z.number().positive().nullable().optional(),
  pontos: z.tuple([vetor3Schema, vetor3Schema]).nullable().optional(),
  fator: z.number().positive(),
  aplicado_em: dataHoraSchema.nullable().optional(),
});
export type Escala = z.infer<typeof escalaSchema>;

/** Registro `medidas/1.0` (contratos §6; config/schemas/medidas.schema.json). */
export const medidasSchema = z
  .strictObject({
    esquema: z.literal("medidas/1.0"),
    medida_id: uuidSchema,
    malha_id: uuidSchema,
    pseudonimo: pseudonimoSchema,
    desenho: desenhoSchema,
    versao_software: versaoSoftwareSchema,
    versao_config: z.strictObject({ tepid: z.string(), simulacao: z.string() }),
    unidade: z.literal("mm"),
    quadro: z.enum(["scan", "anatomico"]),
    gerado_em: dataHoraSchema,
    gerado_por: z.strictObject({ componente: z.enum(["web", "mesh"]), usuario_id: z.string() }),
    escala: escalaSchema,
    landmarks: landmarksSchema,
    quadro_anatomico: quadroAnatomicoSchema.nullable(),
    distancias: distanciasSchema.nullable(),
    volumes: volumesSchema.nullable(),
    geodesica: geodesicaInfoSchema.nullable(),
    medidas_digitadas: medidasDigitadasSchema.nullable(),
  })
  .superRefine((m, ctx) => {
    // Espelha o allOf/if do medidas.schema.json (ADR 0005): em A nada calculado.
    if (m.desenho === "A") {
      if (m.distancias !== null) ctx.addIssue({ code: "custom", path: ["distancias"], message: "em DESENHO=A distancias deve ser null" });
      if (m.volumes !== null) ctx.addIssue({ code: "custom", path: ["volumes"], message: "em DESENHO=A volumes deve ser null" });
      if (m.medidas_digitadas === null) ctx.addIssue({ code: "custom", path: ["medidas_digitadas"], message: "em DESENHO=A medidas_digitadas é obrigatório" });
    }
  });
export type Medidas = z.infer<typeof medidasSchema>;
