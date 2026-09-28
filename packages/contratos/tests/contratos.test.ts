import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_DIGITADOS,
  DISTANCIA_IDS,
  LANDMARK_IDS,
  landmarksSchema,
  malhaMetaSchema,
  medidasSchema,
  medirRequisicaoSchema,
  origemLandmarkSchema,
  tepidConfigSchema,
} from "../src";

const raiz = resolve(__dirname, "../../..");
const lerJson = (rel: string): any => JSON.parse(readFileSync(resolve(raiz, rel), "utf8"));

describe("paridade zod x config/schemas/*.schema.json", () => {
  const medidasJson = lerJson("config/schemas/medidas.schema.json");

  it("landmarks canônicos iguais e na mesma ordem", () => {
    expect([...LANDMARK_IDS]).toEqual(Object.keys(medidasJson.properties.landmarks.properties));
  });

  it("IDs de distância iguais", () => {
    expect([...DISTANCIA_IDS].sort()).toEqual([...medidasJson.properties.distancias.oneOf[1].required].sort());
  });

  it("campos digitados iguais", () => {
    expect([...CAMPOS_DIGITADOS].sort()).toEqual([...medidasJson.properties.medidas_digitadas.oneOf[1].required].sort());
  });

  it("origens de landmark iguais (inclui \"foto\", C5)", () => {
    const def = medidasJson.$defs ?? medidasJson.definitions;
    const origens = Object.values(def as Record<string, any>).find((d) => d?.properties?.origem?.enum)?.properties.origem.enum;
    expect([...origemLandmarkSchema.options].sort()).toEqual([...origens].sort());
  });

  it("campos obrigatórios do malha_meta iguais", () => {
    const json = lerJson("config/schemas/malha_meta.schema.json");
    expect(Object.keys(malhaMetaSchema.shape).sort()).toEqual(Object.keys(json.properties).sort());
  });

  it("config/tepid.json valida contra o zod", () => {
    const r = tepidConfigSchema.safeParse(lerJson("config/tepid.json"));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

const landmark = (x: number, y: number, z: number, v = 0) => ({ posicao: [x, y, z] as [number, number, number], vertice: v, origem: "clique" as const });

const base = {
  esquema: "medidas/1.0" as const,
  medida_id: "8f14e45f-ceea-4e7a-9f1b-8e6b7a1c2d3e",
  malha_id: "c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0",
  pseudonimo: "P-7K2M9Q",
  versao_software: "0.0.1",
  versao_config: { tepid: "1.0", simulacao: "1.0" },
  unidade: "mm" as const,
  quadro: "scan" as const,
  gerado_em: "2026-09-26T14:00:00-04:00",
  gerado_por: { componente: "web" as const, usuario_id: "local" },
  escala: { metodo: "nenhuma" as const, fator: 1 },
  landmarks: { furcula: landmark(0, 0, 0) },
  quadro_anatomico: null,
  geodesica: null,
};
const digitadas = {
  base_mm: { dir: 120, esq: 120 },
  apss_mm: { dir: 25, esq: 25 },
  pinca_polo_superior_mm: { dir: 22, esq: 22 },
  pinca_sulco_mm: { dir: 6, esq: 6 },
  n_imf_estirado_mm: { dir: 80, esq: 80 },
};
const distancias = {
  ssn_n_dir: { euclidiana_mm: 212.3, geodesica_mm: null },
  ssn_n_esq: null,
  n_imf_dir: null,
  n_imf_esq: null,
  base_dir: null,
  base_esq: null,
  intermamilar: null,
};

describe("medidas/1.0", () => {
  it("aceita registro B com distâncias", () => {
    const r = medidasSchema.safeParse({ ...base, desenho: "B", distancias, volumes: null, medidas_digitadas: null });
    expect(r.success).toBe(true);
  });

  it("rejeita DESENHO=A com distâncias ou volumes não nulos", () => {
    const comDist = medidasSchema.safeParse({ ...base, desenho: "A", distancias, volumes: null, medidas_digitadas: digitadas });
    expect(comDist.success).toBe(false);
    const comVol = medidasSchema.safeParse({
      ...base,
      desenho: "A",
      distancias: null,
      volumes: { dir: { valor_ml: 300, incerteza_ml: 45, metodo: "plano_base_elipse" }, esq: null },
      medidas_digitadas: digitadas,
    });
    expect(comVol.success).toBe(false);
  });

  it("exige medidas_digitadas em DESENHO=A", () => {
    expect(medidasSchema.safeParse({ ...base, desenho: "A", distancias: null, volumes: null, medidas_digitadas: null }).success).toBe(false);
    expect(medidasSchema.safeParse({ ...base, desenho: "A", distancias: null, volumes: null, medidas_digitadas: digitadas }).success).toBe(true);
  });

  it("rejeita landmark fora da tabela canônica", () => {
    expect(landmarksSchema.safeParse({ umbigo: landmark(0, 0, 0) }).success).toBe(false);
    expect(landmarksSchema.safeParse({ furcula: { ...landmark(0, 0, 0), vertice: -1 } }).success).toBe(false);
  });

  it("requisição /medir rejeita caminho que escapa de DATA_DIR", () => {
    const req = { landmarks: {}, distancias_euclidianas_web: {}, incluir_geodesica: true, incluir_volume: false };
    expect(medirRequisicaoSchema.safeParse({ ...req, malha_dir: "../etc" }).success).toBe(false);
    expect(medirRequisicaoSchema.safeParse({ ...req, malha_dir: "/abs/x" }).success).toBe(false);
    expect(medirRequisicaoSchema.safeParse({ ...req, malha_dir: "pacientes/P-7K2M9Q/malhas/x" }).success).toBe(true);
  });
});

describe("morphs/1.0", () => {
  it("zod do manifest = campos do morphs_manifest.schema.json", async () => {
    const { manifestMorphsSchema } = await import("../src/morphs");
    const json = lerJson("config/schemas/morphs_manifest.schema.json");
    expect(Object.keys(manifestMorphsSchema.shape).sort()).toEqual(Object.keys(json.properties).sort());
  });
  it("previsto é anulável no zod E no JSON Schema (null no DESENHO=A; revisão v0.1.1)", async () => {
    const { targetManifestSchema } = await import("../src/morphs");
    const alvo = { nome: "mt__a__dual_plane__manter", implante_id: "a", lado: "ambos", indice: 0 };
    expect(targetManifestSchema.safeParse({ ...alvo, previsto: null }).success).toBe(true);
    expect(targetManifestSchema.safeParse(alvo).success).toBe(false); // continua obrigatório (null explícito)
    const json = lerJson("config/schemas/morphs_manifest.schema.json");
    const prev = json.properties.arquivos.items.properties.targets.items.properties.previsto;
    expect(prev.anyOf).toEqual([{ $ref: "#/$defs/previsto" }, { type: "null" }]);
    expect(json.properties.arquivos.items.properties.targets.items.required).toContain("previsto");
  });
  it("nome canônico do target", async () => {
    const { nomeTarget, NOME_TARGET_REGEX } = await import("../src/morphs");
    expect(nomeTarget("motiva-ergonomix-round-300", "dual_plane", "rebaixar")).toBe("mt__motiva-ergonomix-round-300__dual_plane__rebaixar");
    expect(nomeTarget("a-1", "subglandular", "manter", "dir")).toBe("mt__a-1__subglandular__manter__dir");
    expect(NOME_TARGET_REGEX.test("mt__a__dual_plane__manter__esq")).toBe(true);
    expect(NOME_TARGET_REGEX.test("mt__a__submuscular__manter")).toBe(false);
  });
});
