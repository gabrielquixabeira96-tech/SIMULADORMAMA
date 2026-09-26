/**
 * Enforcement do DESENHO=A na API (ADR 0005, camada b): cada recurso calculado é recusado com
 * 403 {"erro":{"codigo":"desligado_no_desenho_a"}} ou devolvido vazio. Estes testes não usam
 * banco: o bloqueio acontece antes de qualquer acesso a dados ou ao services/mesh.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getCatalogo } from "@/app/api/catalogo/route";
import { GET as getConfig } from "@/app/api/config/route";
import { POST as postMedidas } from "@/app/api/medidas/route";
import { POST as postMedir } from "@/app/api/medidas/medir/route";
import { POST as postAvaliar } from "@/app/api/tepid/avaliar/route";
import { carregarTepidConfig } from "@/config/arquivosConfig";
import { chamadas, iniciarMockMesh, pararMockMesh, resetarMockMesh } from "../helpers/meshMock";

beforeAll(iniciarMockMesh);
afterAll(pararMockMesh);
afterEach(() => {
  resetarMockMesh();
  vi.unstubAllEnvs();
});

const UUID = "c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0";
const lm = { posicao: [0, 0, 0], vertice: 0, origem: "clique" };
const post = (url: string, corpo: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

/** Valores digitados que disparam a primeira regra TEPID — derivados da config. */
function valoresQueDisparamAlerta() {
  const c = carregarTepidConfig();
  const v: Record<string, { dir: number; esq: number }> = {};
  for (const [campo, def] of Object.entries(c.campos)) v[campo] = { dir: (def.min + def.max) / 2, esq: (def.min + def.max) / 2 };
  const regra = c.regras.find((r) => r.operador === "<")!;
  v[regra.campo] = { dir: (regra.limiar_mm as number) - 1, esq: (regra.limiar_mm as number) - 1 };
  return v;
}

describe("DESENHO=A desliga cada recurso na API", () => {
  beforeEach(() => vi.stubEnv("DESENHO", "A"));

  it("medicao_automatica_3d: POST /api/medidas/medir → 403, sem chamar o mesh", async () => {
    const r = await postMedir(post("http://x/api/medidas/medir", { malha_id: UUID, landmarks: { furcula: lm } }));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ erro: { codigo: "desligado_no_desenho_a", detalhes: { recurso: "medicao_automatica_3d" } } });
    expect(chamadas).toHaveLength(0);
  });

  it("medicao_automatica_3d: POST /api/medidas com distâncias → 403", async () => {
    const r = await postMedidas(post("http://x/api/medidas", { malha_id: UUID, landmarks: {}, distancias: { intermamilar: { euclidiana_mm: 190, geodesica_mm: null } } }));
    expect(r.status).toBe(403);
    expect((await r.json()).erro.codigo).toBe("desligado_no_desenho_a");
  });

  it("volume_calculado: POST /api/medidas com volumes → 403", async () => {
    const r = await postMedidas(post("http://x/api/medidas", { malha_id: UUID, landmarks: {}, volumes: { dir: { valor_ml: 300, incerteza_ml: 45, metodo: "plano_base_elipse" }, esq: null } }));
    expect(r.status).toBe(403);
    expect((await r.json()).erro.detalhes.recurso).toBe("volume_calculado");
  });

  it("alertas_tepid: POST /api/tepid/avaliar devolve alertas=[] e referencias=[]", async () => {
    const r = await postAvaliar(post("http://x/api/tepid/avaliar", { valores: valoresQueDisparamAlerta() }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.desenho).toBe("A");
    expect(j.alertas).toEqual([]);
    expect(j.referencias).toEqual([]);
  });

  it("sugestao_implante: GET /api/catalogo?sugerir=1 → 403; listagem neutra continua", async () => {
    const r = await getCatalogo(new Request("http://x/api/catalogo?sugerir=1"));
    expect(r.status).toBe(403);
    expect((await r.json()).erro).toMatchObject({ codigo: "desligado_no_desenho_a", detalhes: { recurso: "sugestao_implante" } });
    const lista = await getCatalogo(new Request("http://x/api/catalogo"));
    expect(lista.status).toBe(200);
    const j = await lista.json();
    expect(j.ordem).toBe("neutra_por_id");
    expect(JSON.stringify(j)).not.toMatch(/recomendad|ranking|score/i);
  });

  it("GET /api/config informa A com todos os recursos desligados", async () => {
    const j = await (await getConfig()).json();
    expect(j.desenho).toBe("A");
    expect(j.recursos).toEqual({
      medicao_automatica_3d: false,
      volume_calculado: false,
      alertas_tepid: false,
      sugestao_implante: false,
      numeros_calculados_no_relatorio: false,
    });
  });
});

describe("DESENHO=B mantém os recursos", () => {
  beforeEach(() => vi.stubEnv("DESENHO", "B"));

  it("alertas_tepid: POST /api/tepid/avaliar devolve alertas", async () => {
    const j = await (await postAvaliar(post("http://x/api/tepid/avaliar", { valores: valoresQueDisparamAlerta() }))).json();
    expect(j.alertas.length).toBeGreaterThan(0);
  });

  it("sugestao_implante: ainda não implementada no Marco 1 → 501 (não 403)", async () => {
    const r = await getCatalogo(new Request("http://x/api/catalogo?sugerir=1"));
    expect(r.status).toBe(501);
  });

  it("valores TEPID fora da faixa → 400 com erros por campo", async () => {
    const r = await postAvaliar(post("http://x/api/tepid/avaliar", { valores: { base_mm: { dir: 1, esq: 1 } } }));
    expect(r.status).toBe(400);
    expect((await r.json()).erro.detalhes.erros.length).toBeGreaterThan(0);
  });
});

/** Revisão v0.1.1, item 11: o gabarito do torso sintético não entrega distâncias nem volumes em A. */
describe("GET /api/sinteticos/<nome>/gabarito.json conforme o desenho", () => {
  const GAB = {
    esquema: "gabarito/1.0",
    parametros: { largura_toracica_mm: 300, volume_ml: { dir: 300, esq: 300 }, n_imf_mm: { dir: 70, esq: 70 } },
    landmarks: { furcula: { posicao: [0, 0, 0], vertice: 0 } },
    distancias: { intermamilar: { euclidiana_mm: 190.47, geodesica_mm: 205.31 } },
    volumes: { dir: { adicionado_ml: 300, estimado_plano_base_elipse_ml: 286.4 } },
  };
  const pedir = async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { caminhoEmDataDir } = await import("@/config/ambiente");
    const { GET } = await import("@/app/api/sinteticos/[nome]/[arquivo]/route");
    mkdirSync(caminhoEmDataDir("sinteticos/tx_gab"), { recursive: true });
    writeFileSync(caminhoEmDataDir("sinteticos/tx_gab/gabarito.json"), JSON.stringify(GAB));
    return GET(new Request("http://x"), { params: Promise.resolve({ nome: "tx_gab", arquivo: "gabarito.json" }) });
  };

  it("A: distancias e volumes null, sem volume_ml/n_imf_mm nos parâmetros; landmarks mantidos", async () => {
    vi.stubEnv("DESENHO", "A");
    const r = await pedir();
    expect(r.status).toBe(200);
    const texto = await r.text();
    const j = JSON.parse(texto);
    expect(j.distancias).toBeNull();
    expect(j.volumes).toBeNull();
    expect(j.parametros).toEqual({ largura_toracica_mm: 300 });
    expect(j.landmarks.furcula.posicao).toEqual([0, 0, 0]);
    for (const n of ["190.47", "205.31", "286.4", "adicionado_ml"]) expect(texto).not.toContain(n);
  });

  it("B: gabarito inteiro", async () => {
    vi.stubEnv("DESENHO", "B");
    const j = await (await pedir()).json();
    expect(j).toEqual(GAB);
  });
});
