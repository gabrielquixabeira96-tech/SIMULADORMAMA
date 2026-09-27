import { z } from "zod";

/**
 * Catálogo de implantes (contratos §11; config/schemas/catalogo.schema.json; ADR 0015).
 * Espelho estrutural do JSON Schema — a paridade é testada em tests/catalogo.test.ts.
 * Regras que o JSON Schema não expressa (redonda ⇒ altura = base etc.) ficam em
 * `problemasDoImplante`, usada pelos testes e pelo carregador do web.
 */

export const NOTA_CATALOGO = "conferir versão vigente e registro ANVISA com o fabricante" as const;

export const VERSOES_CATALOGO = ["catalogo/1.0", "catalogo/1.1"] as const;
/** Perfil sagital: "redonda" = cúpula simétrica; "anatomica" = polo inferior mais cheio. */
export const FORMAS_IMPLANTE = ["redonda", "anatomica"] as const;
/** Pegada na parede (ADR 0015): "circular" (altura = base) ou "oval" (altura ≠ base, ex.: Polytech 4Two AO). */
export const BASES_FORMA = ["circular", "oval"] as const;
export const PERFIS_IMPLANTE = ["baixo", "baixo_moderado", "moderado", "moderado_alto", "alto", "extra_alto", "outro"] as const;
export const SUPERFICIES_IMPLANTE = ["lisa", "microtexturizada", "macrotexturizada", "nanotexturizada", "poliuretano", "outra"] as const;
export const GEIS_IMPLANTE = ["silicone", "salina", "outro"] as const;
export const ESCALAS_COESIVIDADE = ["fabricante", "desconhecida"] as const;

/** Faixas físicas do esquema (mm / mL). */
export const LIMITES_CATALOGO = {
  base_mm: { min: 60, max: 200 },
  altura_mm: { min: 60, max: 200 },
  projecao_mm: { min: 10, max: 90 },
  volume_ml: { min: 50, max: 1200 },
} as const;

export const ID_IMPLANTE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOTA_REGEX = /conferir versão vigente e registro ANVISA com o fabricante/;

const faixa = (k: keyof typeof LIMITES_CATALOGO) => z.number().min(LIMITES_CATALOGO[k].min).max(LIMITES_CATALOGO[k].max);

export const formaImplanteSchema = z.enum(FORMAS_IMPLANTE);
export const baseFormaSchema = z.enum(BASES_FORMA);
export const perfilImplanteSchema = z.enum(PERFIS_IMPLANTE);
export const superficieImplanteSchema = z.enum(SUPERFICIES_IMPLANTE);

export const coesividadeSchema = z.strictObject({
  nivel: z.number().int().min(1).max(3).nullable(),
  descricao_fabricante: z.string().nullable(),
  escala: z.enum(ESCALAS_COESIVIDADE),
});

export const fonteImplanteSchema = z.strictObject({
  url: z.string().nullable(),
  /** Página do PDF (índice físico, 1 = primeira), não o número impresso. */
  pagina: z.number().int().min(1).nullable(),
  documento: z.string(),
});

export const implanteCatalogoSchema = z.strictObject({
  id: z.string().regex(ID_IMPLANTE_REGEX),
  fabricante: z.string().min(1),
  linha: z.string().nullable(),
  modelo: z.string().min(1),
  referencia_fabricante: z.string().nullable(),
  forma: formaImplanteSchema,
  /** Opcional em catalogo/1.0 (ausente = inferida: altura = base → circular; senão oval); obrigatório em catalogo/1.1. */
  base_forma: baseFormaSchema.optional(),
  perfil: perfilImplanteSchema,
  perfil_fabricante: z.string().nullable(),
  superficie: superficieImplanteSchema,
  superficie_fabricante: z.string().nullable(),
  base_mm: faixa("base_mm"),
  altura_mm: faixa("altura_mm"),
  projecao_mm: faixa("projecao_mm"),
  volume_ml: faixa("volume_ml"),
  coesividade: coesividadeSchema,
  gel: z.enum(GEIS_IMPLANTE),
  registro_anvisa: z.string().regex(/^[0-9]{11,13}$/).nullable(),
  fonte: fonteImplanteSchema,
  verificado: z.literal(false),
  nota: z.string().regex(NOTA_REGEX),
  exemplo_nao_clinico: z.boolean(),
});
export type ImplanteCatalogo = z.infer<typeof implanteCatalogoSchema>;

export const documentoCatalogoSchema = z.strictObject({
  titulo: z.string(),
  url: z.string().nullable(),
  ano: z.number().int().nullable().optional(),
  data_acesso: z.iso.date(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
});

export const catalogoArquivoSchema = z
  .strictObject({
    esquema: z.enum(VERSOES_CATALOGO),
    fabricante: z.string().min(1),
    documento: documentoCatalogoSchema,
    nota_geral: z.literal(NOTA_CATALOGO),
    implantes: z.array(implanteCatalogoSchema).min(1),
  })
  .superRefine((arq, ctx) => {
    // Espelha o if/then do JSON Schema: em 1.1 todo implante declara base_forma.
    if (arq.esquema !== "catalogo/1.1") return;
    arq.implantes.forEach((it, i) => {
      if (it.base_forma === undefined) ctx.addIssue({ code: "custom", path: ["implantes", i, "base_forma"], message: "catalogo/1.1 exige base_forma" });
    });
  });
export type CatalogoArquivo = z.infer<typeof catalogoArquivoSchema>;

/** Pegada efetiva. Ausente (catalogo/1.0): inferida das dimensões (altura = base → circular; senão oval). */
export const baseFormaDe = (it: Pick<ImplanteCatalogo, "base_forma" | "base_mm" | "altura_mm">): (typeof BASES_FORMA)[number] =>
  it.base_forma ?? (Math.abs(it.altura_mm - it.base_mm) <= 1e-6 ? "circular" : "oval");

/**
 * Regras semânticas que o JSON Schema não expressa (contratos §11, ADR 0015):
 * - redonda ⇒ pegada circular;
 * - circular ⇒ altura_mm = base_mm; oval ⇒ altura_mm ≠ base_mm;
 * - verificado sempre false.
 * Devolve a lista de problemas (vazia = ok).
 */
export function problemasDoImplante(it: ImplanteCatalogo): string[] {
  const p: string[] = [];
  const bf = baseFormaDe(it);
  if (it.forma === "redonda" && bf !== "circular") p.push(`${it.id}: forma redonda exige base circular`);
  if (bf === "circular" && Math.abs(it.altura_mm - it.base_mm) > 1e-6) p.push(`${it.id}: base circular exige altura_mm = base_mm`);
  if (bf === "oval" && Math.abs(it.altura_mm - it.base_mm) <= 1e-6) p.push(`${it.id}: base oval exige altura_mm ≠ base_mm`);
  if (it.verificado !== false) p.push(`${it.id}: verificado deve ser false`);
  return p;
}
