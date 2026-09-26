import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  catalogoArquivoSchema,
  filtrarCatalogo,
  filtroDeQuery,
  implanteCatalogoSchema,
  LIMITES_CATALOGO,
  NOTA_CATALOGO,
  opcoesDoCatalogo,
  problemasDoImplante,
  type CatalogoArquivo,
  type ImplanteCatalogo,
} from "../src";

const raiz = resolve(__dirname, "../../..");
const lerJson = (rel: string): any => JSON.parse(readFileSync(resolve(raiz, rel), "utf8"));
const schemaJson = lerJson("config/schemas/catalogo.schema.json");

// ----------------------------------------------------------------------------- paridade
/** Normaliza um nó de JSON Schema (o escrito à mão ou o gerado pelo zod) para comparação. */
type No = Record<string, any>;
function resolver(n: No): No {
  if (n.$ref) return resolver(n.$ref.split("/").slice(1).reduce((o: any, k: string) => o[k], schemaJson));
  return n;
}
const SEGURO = 9007199254740991;
function folha(n: No) {
  n = resolver(n);
  const ramos: No[] = n.anyOf ?? [n];
  const tipos = new Set<string>();
  const out: Record<string, unknown> = {};
  for (const r of ramos) {
    const t = r.type ?? (r.const !== undefined ? typeof r.const : r.enum ? typeof r.enum[0] : undefined);
    for (const x of [t].flat()) if (x) tipos.add(x);
    for (const k of ["enum", "const", "minimum", "maximum", "pattern", "format", "minLength", "minItems"]) {
      if (r[k] === undefined) continue;
      if (k === "pattern" && r.format) continue; // zod acrescenta a regex do `format`; o que importa é o format
      if ((k === "minimum" && r[k] === -SEGURO) || (k === "maximum" && r[k] === SEGURO)) continue;
      out[k] = k === "enum" ? [...r[k]].sort() : r[k];
    }
  }
  return { tipos: [...tipos].sort(), ...out };
}
function compararObjeto(caminho: string, manual: No, gerado: No) {
  manual = resolver(manual);
  expect(Object.keys(gerado.properties).sort(), `${caminho}: propriedades`).toEqual(Object.keys(manual.properties).sort());
  expect([...(gerado.required ?? [])].sort(), `${caminho}: required`).toEqual([...(manual.required ?? [])].sort());
  expect(gerado.additionalProperties, `${caminho}: additionalProperties`).toBe(manual.additionalProperties);
  for (const k of Object.keys(manual.properties)) {
    const m = resolver(manual.properties[k]);
    const g = gerado.properties[k];
    if (m.type === "object") compararObjeto(`${caminho}.${k}`, m, g);
    else if (m.type === "array") {
      expect(g.minItems, `${caminho}.${k}: minItems`).toBe(m.minItems);
      compararObjeto(`${caminho}.${k}[]`, m.items, g.items);
    } else expect(folha(g), `${caminho}.${k}`).toEqual(folha(m));
  }
}

describe("paridade zod x config/schemas/catalogo.schema.json", () => {
  const gerado = z.toJSONSchema(catalogoArquivoSchema, { unrepresentable: "any", io: "input" }) as No;

  it("arquivo, implante e objetos aninhados: mesmas chaves, required, enums, consts e faixas", () => {
    compararObjeto("arquivo", schemaJson, gerado);
  });

  it("enums de forma e base_forma (ADR 0015)", () => {
    const imp = schemaJson.$defs.implante.properties;
    expect(imp.forma.enum).toEqual(["redonda", "anatomica"]);
    expect(imp.base_forma.enum).toEqual(["circular", "oval"]);
    expect(schemaJson.$defs.implante.required).not.toContain("base_forma");
    expect(schemaJson.properties.esquema.enum).toEqual(["catalogo/1.0", "catalogo/1.1"]);
  });

  it("regra 1.1 ⇒ base_forma obrigatório existe nos dois lados", () => {
    expect(schemaJson.if.properties.esquema.const).toBe("catalogo/1.1");
    expect(schemaJson.then.properties.implantes.items.required).toEqual(["base_forma"]);
    const arq = lerJson("config/catalogo/polytech.json");
    delete arq.implantes[0].base_forma;
    expect(catalogoArquivoSchema.safeParse(arq).success).toBe(false);
    expect(catalogoArquivoSchema.safeParse({ ...arq, esquema: "catalogo/1.0" }).success).toBe(true);
  });

  it("exemplo.json (catalogo/1.0, sem base_forma) continua válido", () => {
    const r = catalogoArquivoSchema.safeParse(lerJson("config/catalogo/exemplo.json"));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    // sem base_forma, a pegada é inferida (o anatômico 120×130 do exemplo é oval) e as regras passam
    expect(r.data!.implantes.flatMap(problemasDoImplante)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------- catálogo real
const ARQUIVOS_REAIS = { "motiva.json": 70, "polytech.json": 43, "gc_aesthetics.json": 73 } as const;
const todosArquivos = readdirSync(resolve(raiz, "config/catalogo")).filter((f) => f.endsWith(".json")).sort();
const reais: Record<string, CatalogoArquivo> = {};
for (const f of Object.keys(ARQUIVOS_REAIS)) reais[f] = lerJson(`config/catalogo/${f}`);
const itensReais = (): ImplanteCatalogo[] => Object.values(reais).flatMap((a) => a.implantes);
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

describe("catálogo real (config/catalogo/{motiva,polytech,gc_aesthetics}.json)", () => {
  it.each(Object.keys(ARQUIVOS_REAIS))("%s valida contra o zod, é catalogo/1.1 e tem a contagem esperada", (f) => {
    const r = catalogoArquivoSchema.safeParse(reais[f]);
    expect(r.success, JSON.stringify(r.error?.issues.slice(0, 5))).toBe(true);
    expect(reais[f]!.esquema).toBe("catalogo/1.1");
    expect(reais[f]!.implantes).toHaveLength(ARQUIVOS_REAIS[f as keyof typeof ARQUIVOS_REAIS]);
    for (const it of reais[f]!.implantes) expect(it.fabricante).toBe(reais[f]!.fabricante);
  });

  it("todas as linhas validam individualmente e passam nas regras semânticas", () => {
    for (const it of itensReais()) {
      const r = implanteCatalogoSchema.safeParse(it);
      expect(r.success, `${it.id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      expect(problemasDoImplante(it)).toEqual([]);
    }
  });

  it("≥ 30 implantes válidos", () => {
    expect(itensReais().length).toBeGreaterThanOrEqual(30);
  });

  it("ids únicos no repositório inteiro (todos os config/catalogo/*.json) e estáveis (fabricante + referência)", () => {
    const ids = todosArquivos.flatMap((f) => (lerJson(`config/catalogo/${f}`).implantes as ImplanteCatalogo[]).map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const it of itensReais()) expect(it.id).toBe(`${slug(it.fabricante)}-${slug(it.referencia_fabricante!)}`);
  });

  it("toda linha tem verificado:false, a nota exata, registro ANVISA nulo e não é exemplo", () => {
    for (const a of Object.values(reais)) expect(a.nota_geral).toBe(NOTA_CATALOGO);
    for (const it of itensReais()) {
      expect(it.verificado).toBe(false);
      expect(it.nota).toBe(NOTA_CATALOGO);
      expect(it.registro_anvisa).toBeNull();
      expect(it.exemplo_nao_clinico).toBe(false);
      expect(it.fonte.url).toMatch(/^https:\/\/.+\.pdf$/);
      expect(Number.isInteger(it.fonte.pagina)).toBe(true);
    }
  });

  it("números positivos e plausíveis (mm/mL; pega erro de cm↔mm)", () => {
    for (const it of itensReais()) {
      for (const k of Object.keys(LIMITES_CATALOGO) as (keyof typeof LIMITES_CATALOGO)[]) {
        expect(it[k], `${it.id}.${k}`).toBeGreaterThan(0);
        expect(it[k], `${it.id}.${k}`).toBeGreaterThanOrEqual(LIMITES_CATALOGO[k].min);
        expect(it[k], `${it.id}.${k}`).toBeLessThanOrEqual(LIMITES_CATALOGO[k].max);
      }
      // projeção/base de implante mamário: ~0,2 (baixo) a ~0,6 (extra-alto)
      expect(it.projecao_mm / it.base_mm, `${it.id} P/B`).toBeGreaterThan(0.15);
      expect(it.projecao_mm / it.base_mm, `${it.id} P/B`).toBeLessThan(0.65);
      // preenchimento V / (π/4·base·altura·projeção): cone = 1/3, semi-elipsoide = 2/3, cilindro = 1
      const fill = (it.volume_ml * 1000) / ((Math.PI / 4) * it.base_mm * it.altura_mm * it.projecao_mm);
      expect(fill, `${it.id} preenchimento`).toBeGreaterThan(0.45);
      expect(fill, `${it.id} preenchimento`).toBeLessThan(0.95);
    }
  });

  /**
   * Dentro de cada (fabricante, perfil): volume maior ⇒ base OU projeção maior ou igual.
   * Exceções REAIS do PDF ficam listadas aqui (a lista precisa bater exatamente com o encontrado):
   * - Polytech "alto" junta estilos diferentes: 4Two AO HP/T 21641-320 (oval 124×114, P 50, 320 mL) e
   *   4Two RR HP/T 21622-325 (redonda 120×120, P 46, 325 mL) — PDF págs. 18 e 19. Não é erro de extração.
   */
  const EXCECOES_MONOTONIA = [["polytech-21641-320", "polytech-21622-325"]];
  const violacoes = (chave: (i: ImplanteCatalogo) => string) => {
    const grupos = new Map<string, ImplanteCatalogo[]>();
    for (const it of itensReais()) grupos.set(chave(it), [...(grupos.get(chave(it)) ?? []), it]);
    const v: string[][] = [];
    for (const g of grupos.values())
      for (const a of g) for (const b of g) if (b.volume_ml > a.volume_ml && b.base_mm < a.base_mm && b.projecao_mm < a.projecao_mm) v.push([a.id, b.id]);
    return v.sort();
  };

  it("monotonia por (fabricante, perfil): só as exceções reais documentadas", () => {
    expect(violacoes((i) => `${i.fabricante}|${i.perfil}`)).toEqual(EXCECOES_MONOTONIA);
  });

  it("monotonia por (fabricante, modelo): sem exceção", () => {
    expect(violacoes((i) => `${i.fabricante}|${i.modelo}`)).toEqual([]);
  });

  /** Linhas conferidas à mão contra o texto do PDF (página física), inclusive as 4 que a extração bruta inventou. */
  const CONFERIDAS: [string, number, number, number, number, number][] = [
    // id, base, altura, projeção, volume, página do PDF
    ["motiva-rsm-105", 85, 85, 22, 105, 16],
    ["motiva-rsm-430", 140, 140, 33, 430, 16],
    ["motiva-rsd-265", 110, 110, 38, 265, 16],
    ["motiva-rsd-625", 150, 150, 48, 625, 16],
    ["motiva-rsf-235", 100, 100, 41, 235, 16],
    ["motiva-rsc-1050", 150, 150, 78, 1050, 16],
    ["polytech-21631-195", 104, 104, 40, 195, 17],
    ["polytech-21632-500", 132, 132, 62, 500, 17],
    ["polytech-21641-180", 104, 94, 40, 180, 18],
    ["polytech-21642-415", 128, 118, 60, 415, 18],
    ["polytech-21621-190", 108, 108, 34, 190, 19],
    ["polytech-21622-410", 128, 128, 50, 410, 19],
    ["gc-aesthetics-802140n", 93, 93, 32, 140, 6],
    ["gc-aesthetics-802800n", 158, 158, 60, 800, 6],
    ["gc-aesthetics-805480n", 139, 139, 49, 480, 6],
    ["gc-aesthetics-810265n", 106, 106, 44, 265, 7],
    ["gc-aesthetics-810295n", 109, 109, 46, 295, 7],
    ["gc-aesthetics-812100n", 73, 73, 34, 100, 7],
    ["gc-aesthetics-812700n", 134, 134, 71, 700, 7],
  ];
  it.each(CONFERIDAS)("%s confere com o PDF", (id, base, altura, proj, vol, pag) => {
    const it = itensReais().find((i) => i.id === id);
    expect(it, id).toBeDefined();
    expect([it!.base_mm, it!.altura_mm, it!.projecao_mm, it!.volume_ml, it!.fonte.pagina]).toEqual([base, altura, proj, vol, pag]);
  });

  it("linhas inexistentes no PDF (inventadas na extração bruta) não entram", () => {
    const ids = new Set(itensReais().map((i) => i.id));
    for (const id of ["gc-aesthetics-810270n", "gc-aesthetics-810300n", "gc-aesthetics-810335n", "gc-aesthetics-810365n"]) expect(ids.has(id)).toBe(false);
  });

  it("forma/pegada da Polytech: AR = anatômica circular, AO = anatômica oval, RR = redonda", () => {
    for (const it of reais["polytech.json"]!.implantes) {
      const estilo = it.modelo.match(/4Two (AR|AO|RR)/)![1];
      expect([it.forma, it.base_forma], it.id).toEqual(
        estilo === "AO" ? ["anatomica", "oval"] : estilo === "AR" ? ["anatomica", "circular"] : ["redonda", "circular"],
      );
      if (estilo === "AO") expect(it.altura_mm).toBeLessThan(it.base_mm);
    }
  });
});

// ----------------------------------------------------------------------------- filtro
describe("filtro para escolha manual", () => {
  const itens = itensReais().sort((a, b) => a.id.localeCompare(b.id));

  it("sem filtro devolve tudo, na mesma ordem neutra", () => {
    expect(filtrarCatalogo(itens).map((i) => i.id)).toEqual(itens.map((i) => i.id));
  });

  it("combina fabricante, forma, base_forma, perfil e faixas (inclusivas)", () => {
    const r = filtrarCatalogo(itens, { fabricante: ["polytech"], base_forma: ["oval"], volume_ml: { min: 205, max: 305 } });
    expect(r.map((i) => i.id)).toEqual(["polytech-21641-205", "polytech-21641-235", "polytech-21641-260", "polytech-21641-290", "polytech-21642-215", "polytech-21642-245", "polytech-21642-285", "polytech-21642-305"]);
    const m = filtrarCatalogo(itens, { forma: ["redonda"], perfil: ["moderado"], projecao_mm: { max: 34 }, fabricante: ["Motiva"] });
    expect(m.every((i) => i.fabricante === "Motiva" && i.perfil === "moderado" && i.projecao_mm <= 34)).toBe(true);
    expect(m.map((i) => i.id)).toEqual(["motiva-rsd-135", "motiva-rsd-155", "motiva-rsd-180"]);
  });

  it("busca textual ignora caixa e acento; exemplo_nao_clinico filtra seeds", () => {
    expect(filtrarCatalogo(itens, { texto: "CORSÉ" }).length).toBe(20);
    expect(filtrarCatalogo(itens, { texto: "810265n" }).map((i) => i.id)).toEqual(["gc-aesthetics-810265n"]);
    const exemplo = lerJson("config/catalogo/exemplo.json").implantes as ImplanteCatalogo[];
    expect(filtrarCatalogo([...itens, ...exemplo], { exemplo_nao_clinico: true }).map((i) => i.id)).toEqual(exemplo.map((i) => i.id));
    expect(filtrarCatalogo([...itens, ...exemplo], { exemplo_nao_clinico: false })).toHaveLength(itens.length);
  });

  it("query string → filtro; valores inválidos lançam", () => {
    const f = filtroDeQuery(new URLSearchParams("fabricante=Motiva,Polytech&perfil=alto&volume_min=250&volume_max=350&q=rs&exemplo=0&sugerir=1"));
    expect(f).toEqual({ fabricante: ["Motiva", "Polytech"], perfil: ["alto"], volume_ml: { min: 250, max: 350 }, texto: "rs", exemplo_nao_clinico: false });
    expect(filtrarCatalogo(itens, f).every((i) => i.fabricante === "Motiva" && i.perfil === "alto")).toBe(true);
    expect(() => filtroDeQuery(new URLSearchParams("forma=oval"))).toThrow();
    expect(() => filtroDeQuery(new URLSearchParams("volume_min=abc"))).toThrow();
    expect(() => filtroDeQuery(new URLSearchParams("volume_min=400&volume_max=300"))).toThrow();
  });

  it("opções do filtro saem do próprio catálogo", () => {
    const o = opcoesDoCatalogo(itens);
    expect(o.fabricante).toEqual(["GC Aesthetics", "Motiva", "Polytech"]);
    expect(o.base_forma).toEqual(["circular", "oval"]);
    expect(o.volume_ml).toEqual({ min: 100, max: 1050 });
  });
});
