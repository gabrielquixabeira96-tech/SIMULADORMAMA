/**
 * Estatística da validação de medidas (ESTRATEGIA fase 1; ADR 0017). Funções puras.
 *
 * `blandAltman` reproduz `services/mesh/mesh/medir/bland_altman.py` (contratos §7.7), que é a
 * referência: diferença = medido − referência; viés = média; DP amostral (n − 1);
 * LoA 95 % = viés ± 1,96·DP; arredondamento a 4 casas. Os mesmos valores conhecidos são
 * conferidos nos dois lados (`tests/unit/validacaoEstatistica.test.ts` e
 * `services/mesh/tests/test_bland_altman_paridade.py`).
 */

export const Z_95 = 1.96;

export interface ParMedida {
  /** chave do agrupamento "por medida" (ex.: "n_imf_dir:geodesica") */
  medida: string;
  referencia_mm: number;
  medido_mm: number;
}

export interface Resumo {
  n: number;
  vies_mm: number | null;
  dp_mm: number | null;
  loa_inferior_mm: number | null;
  loa_superior_mm: number | null;
}

export interface ResultadoBlandAltman extends Resumo {
  erro_abs_max_mm: number | null;
  /** ambos os LoA dentro de ±2 mm (critério do Marco 1 no PROMPT) */
  dentro_de_2mm: boolean | null;
  /** ambos os LoA dentro de ±3 mm (critério da fase 1 na ESTRATEGIA) */
  dentro_de_3mm: boolean | null;
  por_medida: Record<string, Resumo>;
}

export const arred4 = (v: number): number => Math.round(v * 1e4) / 1e4;

function media(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** DP amostral (ddof = 1). Exige n ≥ 2. */
export function dpAmostral(xs: readonly number[]): number {
  const m = media(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function resumir(dif: readonly number[]): Resumo {
  const n = dif.length;
  if (n === 0) return { n: 0, vies_mm: null, dp_mm: null, loa_inferior_mm: null, loa_superior_mm: null };
  const vies = media(dif);
  if (n < 2) return { n, vies_mm: arred4(vies), dp_mm: null, loa_inferior_mm: null, loa_superior_mm: null };
  const dp = dpAmostral(dif);
  return { n, vies_mm: arred4(vies), dp_mm: arred4(dp), loa_inferior_mm: arred4(vies - Z_95 * dp), loa_superior_mm: arred4(vies + Z_95 * dp) };
}

const dentro = (r: Resumo, limite: number): boolean | null =>
  r.loa_inferior_mm === null || r.loa_superior_mm === null ? null : r.loa_inferior_mm >= -limite && r.loa_superior_mm <= limite;

export function blandAltman(pares: readonly ParMedida[]): ResultadoBlandAltman {
  const dif = pares.map((p) => p.medido_mm - p.referencia_mm);
  const geral = resumir(dif);
  const grupos = new Map<string, number[]>();
  pares.forEach((p, i) => {
    const g = grupos.get(p.medida) ?? [];
    g.push(dif[i]!);
    grupos.set(p.medida, g);
  });
  return {
    ...geral,
    erro_abs_max_mm: dif.length === 0 ? null : arred4(Math.max(...dif.map(Math.abs))),
    dentro_de_2mm: dentro(geral, 2),
    dentro_de_3mm: dentro(geral, 3),
    por_medida: Object.fromEntries([...grupos].map(([k, v]) => [k, resumir(v)])),
  };
}

export interface Repetibilidade {
  /** grupos (scan × medida) com ≥ 2 repetições */
  n_grupos: number;
  /** DP intra-sujeito s_w = √(média das variâncias dos grupos) (Bland & Altman 1996) */
  dp_intra_mm: number | null;
  /** coeficiente de repetibilidade = 1,96·√2·s_w: 95 % das diferenças entre 2 repetições ficam abaixo dele */
  coeficiente_repetibilidade_mm: number | null;
}

/**
 * Confiabilidade intra-operador a partir de medidas repetidas do mesmo operador no mesmo scan.
 * `grupos`: cada item é a lista de valores de uma (scan, medida) nas repetições.
 */
export function repetibilidade(grupos: readonly (readonly number[])[]): Repetibilidade {
  const validos = grupos.filter((g) => g.length >= 2);
  if (validos.length === 0) return { n_grupos: 0, dp_intra_mm: null, coeficiente_repetibilidade_mm: null };
  const variancias = validos.map((g) => dpAmostral(g) ** 2);
  const sw = Math.sqrt(media(variancias));
  return { n_grupos: validos.length, dp_intra_mm: arred4(sw), coeficiente_repetibilidade_mm: arred4(Z_95 * Math.SQRT2 * sw) };
}

/** PRNG determinístico (mulberry32) — a ordem dos scans é reprodutível pela semente registrada. */
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates com o PRNG dado (não altera a entrada). */
export function embaralhar<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
