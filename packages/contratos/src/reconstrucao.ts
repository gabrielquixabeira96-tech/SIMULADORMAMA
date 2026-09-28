import { z } from "zod";
import { vetor3Schema } from "./comum";

/**
 * Reconstrução 3D a partir de fotos (plano "foto → 3D", contratos C1/C3/C4 congelados).
 *
 * - `reconstrucao/1.0` (C1): `reconstrucao.json` na pasta da malha, escrito pelo services/mesh
 *   (`/reconstruir-foto`) e lido pelo web. O mesmo objeto pode vir em `asset.extras.reconstrucao`
 *   do `processada.glb` (com `asset.extras.origem = "foto"`).
 * - `avaliacao_reconstrucao/1.0`: erro da reconstrução contra o gabarito (só torsos sintéticos).
 *
 * Câmera por foto (C1): pinhole `K` (px), `R` (3×3) e `t` (mm) no quadro da malha (`anatomico`),
 * com `x_cam = R·X + t` e `[u, v, 1]ᵀ ∝ K·x_cam` (convenção OpenCV: câmera olhando para +z, v para
 * baixo, pixel (0, 0) = CENTRO do pixel do canto superior esquerdo). `K` e `R` em 9 números
 * **coluna-major** (como `THREE.Matrix3.elements` e os contratos §1.1): `K = [fx, 0, 0, s, fy, 0, cx, cy, 1]`.
 * Esquemas tolerantes (passthrough): o web só exige o que usa.
 */

export const VISTAS_FOTO = ["frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq"] as const;
export const vistaFotoSchema = z.enum(VISTAS_FOTO);
export type VistaFoto = z.infer<typeof vistaFotoSchema>;

/** Arquivo da foto na pasta da malha (lista fixa; C4). */
export const ARQUIVO_FOTO_REGEX = /^original\/foto_(frente|obliqua_dir|obliqua_esq|perfil_dir|perfil_esq)\.(jpg|png)$/;

const finito = z.number().refine(Number.isFinite, "número finito");
const matriz9 = z.array(finito).length(9);

/** Elemento (linha i, coluna j) de uma 3×3 coluna-major. */
export const el3 = (m: readonly number[], i: number, j: number): number => m[j * 3 + i]!;

/** K coluna-major válido: última LINHA (0, 0, 1), fx, fy > 0 (um K linha-major tem cx em K[2]). */
export function kColunaMajorValido(K: readonly number[]): boolean {
  return K.length === 9 && el3(K, 2, 0) === 0 && el3(K, 2, 1) === 0 && el3(K, 2, 2) === 1 && el3(K, 1, 0) === 0 && el3(K, 0, 0) > 0 && el3(K, 1, 1) > 0;
}

/** R ortonormal com det = +1 (tolerância 1e-3). */
export function rotacaoValida(R: readonly number[], tol = 1e-3): boolean {
  if (R.length !== 9) return false;
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += el3(R, k, a) * el3(R, k, b);
      if (Math.abs(s - (a === b ? 1 : 0)) > tol) return false;
    }
  const det =
    el3(R, 0, 0) * (el3(R, 1, 1) * el3(R, 2, 2) - el3(R, 1, 2) * el3(R, 2, 1)) -
    el3(R, 0, 1) * (el3(R, 1, 0) * el3(R, 2, 2) - el3(R, 1, 2) * el3(R, 2, 0)) +
    el3(R, 0, 2) * (el3(R, 1, 0) * el3(R, 2, 1) - el3(R, 1, 1) * el3(R, 2, 0));
  return Math.abs(det - 1) <= tol;
}

export const fotoReconstrucaoSchema = z
  .object({
    vista: vistaFotoSchema,
    arquivo: z.string().regex(ARQUIVO_FOTO_REGEX, "arquivo de foto fora da lista (original/foto_<vista>.jpg|png)"),
    largura_px: z.number().int().positive(),
    altura_px: z.number().int().positive(),
    K: matriz9.refine(kColunaMajorValido, "K deve ser coluna-major [fx,0,0, s,fy,0, cx,cy,1]"),
    R: matriz9.refine((r) => rotacaoValida(r), "R deve ser rotação (ortonormal, det +1), coluna-major"),
    t: vetor3Schema,
    k1: finito.optional(),
    f_origem: z.enum(["exif", "estimado"]).optional(),
    landmarks_2d: z.record(z.string(), z.tuple([finito, finito])).optional(),
    residuos_px: z.record(z.string(), finito).optional(),
    rms_px: z.number().min(0).optional(),
  })
  .passthrough();
export type FotoReconstrucao = z.infer<typeof fotoReconstrucaoSchema>;

export const incertezaPorEixoSchema = z.object({ x: z.number().min(0), y: z.number().min(0), z: z.number().min(0) });
export type IncertezaPorEixo = z.infer<typeof incertezaPorEixoSchema>;

export const qualidadeReconstrucaoSchema = z.enum(["boa", "regular", "ruim"]);

/** `reconstrucao/1.0` (C1). */
export const reconstrucaoSchema = z
  .object({
    esquema: z.literal("reconstrucao/1.0"),
    malha_id: z.string().optional(),
    fotos: z
      .array(fotoReconstrucaoSchema)
      .min(1)
      .max(5)
      .refine((fs) => new Set(fs.map((f) => f.vista)).size === fs.length, "uma foto por vista"),
    parametros: z.unknown().optional(),
    escala: z.object({ metodo: z.string(), valor_mm: z.number().nullable().optional(), fator: z.number().optional() }).passthrough().optional(),
    residuo_silhueta_mm: z.number().min(0).optional(),
    incerteza_por_eixo_mm: incertezaPorEixoSchema,
    incerteza_volume_pct: z.number().min(0).optional(),
    qualidade: qualidadeReconstrucaoSchema,
    avisos: z.array(z.string()).default([]),
    cobertura_observada_pct: z.number().min(0).max(100).optional(),
    /** C1 põe o aviso em `avisos`; o extras do .glb pode trazê-lo como booleano. */
    forma_fora_do_modelo: z.boolean().optional(),
    reprojecao_rms_px: z.number().min(0).optional(),
    versao_software: z.string().optional(),
    gerado_em: z.string().optional(),
  })
  .passthrough();
export type Reconstrucao = z.infer<typeof reconstrucaoSchema>;

/** `avaliacao_reconstrucao/1.0`: erro contra o gabarito (torsos sintéticos; P4). */
export const avaliacaoReconstrucaoSchema = z
  .object({
    esquema: z.literal("avaliacao_reconstrucao/1.0"),
    /** RMS ponto–superfície por eixo na região das mamas (mm) */
    rms_mm: incertezaPorEixoSchema,
    rms_global_mm: incertezaPorEixoSchema.optional(),
    /** volume reconstruído vs gabarito (%, com sinal): um número ou por lado */
    volume_erro_pct: z.union([finito, z.object({ dir: finito, esq: finito })]),
    landmarks_erro_mm: z.object({ medio: z.number().min(0), max: z.number().min(0) }).passthrough().optional(),
    reprojecao_rms_px: z.number().min(0).optional(),
    ssim_antes: z.number().optional(),
    psnr_antes_db: z.number().optional(),
    n_fotos: z.number().int().positive().optional(),
    torso: z.string().optional(),
  })
  .passthrough();
export type AvaliacaoReconstrucao = z.infer<typeof avaliacaoReconstrucaoSchema>;

/** Aviso de C1 para forma fora da família do template. */
export const AVISO_FORMA_FORA_DO_MODELO = "forma_fora_do_modelo";

/**
 * Reconstrução a partir de `asset.extras` de um `processada.glb` com `origem: "foto"`: o objeto C1
 * em `extras.reconstrucao` (ou os campos C1 direto em `extras`). Devolve null se não for foto ou
 * se o objeto não cumprir o C1.
 */
export function reconstrucaoDeExtras(extras: Record<string, unknown> | null | undefined): Reconstrucao | null {
  if (!extras || extras.origem !== "foto") return null;
  const r = extras.reconstrucao;
  const candidato = r && typeof r === "object" && "fotos" in (r as object) ? { esquema: "reconstrucao/1.0", ...(r as object) } : { ...extras, esquema: "reconstrucao/1.0" };
  const p = reconstrucaoSchema.safeParse(candidato);
  return p.success ? p.data : null;
}

/** Avaliação em `asset.extras.avaliacao` (ou `extras.reconstrucao.avaliacao`), se houver. */
export function avaliacaoDeExtras(extras: Record<string, unknown> | null | undefined): AvaliacaoReconstrucao | null {
  if (!extras) return null;
  const r = extras.reconstrucao as Record<string, unknown> | undefined;
  for (const c of [extras.avaliacao, r && typeof r === "object" ? r.avaliacao : undefined]) {
    if (!c || typeof c !== "object") continue;
    const p = avaliacaoReconstrucaoSchema.safeParse({ esquema: "avaliacao_reconstrucao/1.0", ...(c as object) });
    if (p.success) return p.data;
  }
  return null;
}
