import { z } from "zod";
import {
  BASES_FORMA,
  baseFormaDe,
  FORMAS_IMPLANTE,
  PERFIS_IMPLANTE,
  SUPERFICIES_IMPLANTE,
  type ImplanteCatalogo,
} from "./catalogo";

/**
 * Filtro para a ESCOLHA MANUAL de implante (permitida nos desenhos A e B; ADR 0005).
 * Só restringe; nunca ordena por "adequação", nunca pontua: a ordem de saída é a ordem
 * neutra de entrada (por id). Faixas são inclusivas.
 */
const faixaSchema = z
  .strictObject({ min: z.number().nonnegative().optional(), max: z.number().nonnegative().optional() })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, { message: "min > max" });

export const filtroCatalogoSchema = z.strictObject({
  /** Busca livre (sem acento/caixa) em id, fabricante, linha, modelo e referência. */
  texto: z.string().trim().max(100).optional(),
  fabricante: z.array(z.string().min(1)).optional(),
  forma: z.array(z.enum(FORMAS_IMPLANTE)).optional(),
  base_forma: z.array(z.enum(BASES_FORMA)).optional(),
  perfil: z.array(z.enum(PERFIS_IMPLANTE)).optional(),
  superficie: z.array(z.enum(SUPERFICIES_IMPLANTE)).optional(),
  volume_ml: faixaSchema.optional(),
  base_mm: faixaSchema.optional(),
  altura_mm: faixaSchema.optional(),
  projecao_mm: faixaSchema.optional(),
  /** true = só seeds "EXEMPLO NÃO CLÍNICO"; false = só catálogo real; ausente = ambos. */
  exemplo_nao_clinico: z.boolean().optional(),
});
export type FiltroCatalogo = z.infer<typeof filtroCatalogoSchema>;

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const naFaixa = (v: number, f?: { min?: number; max?: number }) => !f || ((f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max));

const contem = <T extends string>(lista: readonly T[] | undefined, v: T) => !lista || lista.length === 0 || lista.includes(v);

export function filtrarCatalogo<T extends ImplanteCatalogo>(itens: readonly T[], filtro: FiltroCatalogo = {}): T[] {
  const f = filtroCatalogoSchema.parse(filtro);
  const termo = f.texto ? normalizar(f.texto) : "";
  const fabricantes = f.fabricante?.map(normalizar);
  return itens.filter((it) => {
    if (f.exemplo_nao_clinico !== undefined && it.exemplo_nao_clinico !== f.exemplo_nao_clinico) return false;
    if (fabricantes && fabricantes.length > 0 && !fabricantes.includes(normalizar(it.fabricante))) return false;
    if (!contem(f.forma, it.forma) || !contem(f.base_forma, baseFormaDe(it)) || !contem(f.perfil, it.perfil) || !contem(f.superficie, it.superficie)) return false;
    if (!naFaixa(it.volume_ml, f.volume_ml) || !naFaixa(it.base_mm, f.base_mm) || !naFaixa(it.altura_mm, f.altura_mm) || !naFaixa(it.projecao_mm, f.projecao_mm)) return false;
    if (termo) {
      const alvo = normalizar([it.id, it.fabricante, it.linha ?? "", it.modelo, it.referencia_fabricante ?? ""].join(" "));
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/** Valores distintos presentes no catálogo, para montar os controles do filtro (ordem alfabética/enum). */
export function opcoesDoCatalogo(itens: readonly ImplanteCatalogo[]) {
  const unicos = <T extends string>(vs: T[], ordem?: readonly T[]) => {
    const s = [...new Set(vs)];
    return ordem ? ordem.filter((o) => s.includes(o)) : s.sort((a, b) => a.localeCompare(b));
  };
  const faixa = (vs: number[]) => (vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : null);
  return {
    fabricante: unicos(itens.map((i) => i.fabricante)),
    forma: unicos(itens.map((i) => i.forma), FORMAS_IMPLANTE),
    base_forma: unicos(itens.map((i) => baseFormaDe(i)), BASES_FORMA),
    perfil: unicos(itens.map((i) => i.perfil), PERFIS_IMPLANTE),
    superficie: unicos(itens.map((i) => i.superficie), SUPERFICIES_IMPLANTE),
    volume_ml: faixa(itens.map((i) => i.volume_ml)),
    base_mm: faixa(itens.map((i) => i.base_mm)),
    projecao_mm: faixa(itens.map((i) => i.projecao_mm)),
  };
}

/**
 * Lê o filtro de query string (`?fabricante=Motiva&fabricante=Polytech&perfil=alto&volume_min=250&volume_max=350&q=rsd&exemplo=0`).
 * Parâmetros desconhecidos (ex.: `sugerir`) são ignorados aqui; valores inválidos lançam ZodError.
 */
export function filtroDeQuery(p: URLSearchParams): FiltroCatalogo {
  const lista = (k: string) => {
    const v = p.getAll(k).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    return v.length ? v : undefined;
  };
  const num = (k: string) => {
    const s = p.get(k);
    if (s === null || s.trim() === "") return undefined;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const faixa = (prefixo: string) => {
    const min = num(`${prefixo}_min`);
    const max = num(`${prefixo}_max`);
    return min === undefined && max === undefined ? undefined : { ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
  };
  const bruto = {
    texto: p.get("q") ?? undefined,
    fabricante: lista("fabricante"),
    forma: lista("forma"),
    base_forma: lista("base_forma"),
    perfil: lista("perfil"),
    superficie: lista("superficie"),
    volume_ml: faixa("volume"),
    base_mm: faixa("base"),
    altura_mm: faixa("altura"),
    projecao_mm: faixa("projecao"),
    exemplo_nao_clinico: p.get("exemplo") === "1" ? true : p.get("exemplo") === "0" ? false : undefined,
  };
  const limpo = Object.fromEntries(Object.entries(bruto).filter(([, v]) => v !== undefined));
  return filtroCatalogoSchema.parse(limpo);
}
