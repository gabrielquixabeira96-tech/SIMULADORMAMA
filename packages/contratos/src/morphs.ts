import { z } from "zod";
import { caminhoRelativoSchema, dataHoraSchema, uuidSchema } from "./comum";
import { landmarksSchema } from "./landmarks";
import type { Imf, Lado, Plano } from "./simulacao";

/**
 * Morph targets (contratos §10; ADR 0014): manifest `morphs/1.0` e requisição de `POST /morphs`.
 * Espelha config/schemas/morphs_manifest.schema.json.
 */
export const PLANOS = ["subglandular", "dual_plane"] as const satisfies readonly Plano[];
export const IMFS = ["manter", "rebaixar"] as const satisfies readonly Imf[];
export const LADOS = ["ambos", "dir", "esq"] as const satisfies readonly Lado[];

export const ROTULOS_PLANO: Record<Plano, string> = {
  subglandular: "Subglandular / subfascial",
  dual_plane: "Dual plane",
};
export const ROTULOS_IMF: Record<Imf, string> = { manter: "Manter sulco", rebaixar: "Rebaixar sulco" };

const idImplante = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const NOME_TARGET_REGEX = /^mt__([a-z0-9]+(?:-[a-z0-9]+)*)__(subglandular|dual_plane)__(manter|rebaixar)(?:__(dir|esq))?$/;

/** Nome canônico do target (§10.2). `lado = "ambos"` não leva sufixo. */
export function nomeTarget(implanteId: string, plano: Plano, imf: Imf, lado: Lado = "ambos"): string {
  return `mt__${implanteId}__${plano}__${imf}${lado === "ambos" ? "" : `__${lado}`}`;
}

export const arquivoMorph = (plano: Plano, imf: Imf) => `${plano}__${imf}.glb` as const;

const porLado = z.strictObject({ dir: z.number(), esq: z.number() });
export const previstoSchema = z.strictObject({
  delta_projecao_mamilo_mm: porLado,
  delta_y_sulco_mm: porLado,
  delta_y_mamilo_mm: porLado,
});

export const targetManifestSchema = z.strictObject({
  nome: z.string().regex(NOME_TARGET_REGEX),
  implante_id: idImplante,
  lado: z.enum(LADOS),
  indice: z.number().int().min(0),
  previsto: previstoSchema,
});

export const manifestMorphsSchema = z.strictObject({
  esquema: z.literal("morphs/1.0"),
  malha_id: uuidSchema,
  sha256_malha_base: z.string().regex(/^[a-f0-9]{64}$/),
  versao_software: z.string().regex(/^\d+\.\d+\.\d+$/),
  versao_config_simulacao: z.string(),
  nao_calibrado: z.boolean(),
  gerado_em: dataHoraSchema,
  lados: z.enum(["ambos", "separados"]),
  arquivos: z
    .array(
      z.strictObject({
        arquivo: z.string().regex(/^(subglandular|dual_plane)__(manter|rebaixar)\.glb$/),
        plano: z.enum(PLANOS),
        imf: z.enum(IMFS),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        targets: z.array(targetManifestSchema).min(1),
      }),
    )
    .min(1),
});
export type ManifestMorphs = z.infer<typeof manifestMorphsSchema>;

export const morphsRequisicaoSchema = z.strictObject({
  malha_dir: caminhoRelativoSchema,
  landmarks: landmarksSchema,
  implantes: z.array(idImplante).min(1),
  planos: z.array(z.enum(PLANOS)).min(1),
  imfs: z.array(z.enum(IMFS)).min(1),
  lados: z.enum(["ambos", "separados"]),
  catalogo_arquivo: z.string().nullable().optional(),
  pinca_polo_superior_mm: z.strictObject({ dir: z.number().positive(), esq: z.number().positive() }).nullable().optional(),
});
export type MorphsRequisicao = z.infer<typeof morphsRequisicaoSchema>;
