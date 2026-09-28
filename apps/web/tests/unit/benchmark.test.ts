/**
 * Benchmark de latência (planos A12/A14): roteiro único (e2e e página /benchmark), estatística e
 * a flag de servidor BENCHMARK_HABILITADO (desligada por padrão: página e rotas somem com 404).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARQUIVOS_BENCHMARK, benchmarkHabilitado, caminhoArquivoBenchmark } from "@/benchmark/servidor";
import {
  AQUECIMENTO_DESCARTADO,
  CRITERIOS,
  CRITERIOS_FOTO,
  LIMITE_P95_2_PAINEIS_MS,
  LIMITE_P95_CORTINA_MS,
  ROTEIRO,
  ROTEIRO_FOTO,
  TOTAL_INTERACOES,
  TOTAL_INTERACOES_FOTO,
  dentroDoCriterio,
  percentil,
  resumir,
  resumirFoto,
  resumo,
  rodarRoteiro,
  rodarRoteiroFoto,
  type Acao,
  type AcaoFoto,
} from "@/simulacao/benchmark";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("estatística do benchmark", () => {
  it("percentil pelo posto mais próximo (o mesmo do registro v0.1.1)", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentil(xs, 50)).toBe(10);
    expect(percentil(xs, 95)).toBe(19);
    expect(percentil([5], 95)).toBe(5);
    expect(resumo([3, 1, 2])).toEqual({ n: 3, p50_ms: 2, p95_ms: 3, max_ms: 3, media_ms: 2 });
  });

  it("critério do painel duplo: p95 ≤ 85 ms (inclusivo); 1 painel: < 100 ms", () => {
    const duplo = CRITERIOS.find((c) => c.chave === "slider_comparacao_2_paineis")!;
    expect(duplo.limite).toBe(LIMITE_P95_2_PAINEIS_MS);
    expect(LIMITE_P95_2_PAINEIS_MS).toBe(85);
    expect(dentroDoCriterio(duplo, 85)).toBe(true);
    expect(dentroDoCriterio(duplo, 85.01)).toBe(false);
    const um = CRITERIOS.find((c) => c.chave === "geral_1_painel")!;
    expect(dentroDoCriterio(um, 99.9)).toBe(true);
    expect(dentroDoCriterio(um, 100)).toBe(false);
  });
});

describe("roteiro único (e2e e /benchmark)", () => {
  it("mesma sequência e mesmo n: aquecimento descartado, 1 painel e depois 2 painéis", async () => {
    const acoes: string[] = [];
    const modos: boolean[] = [];
    let comparacao = false;
    const progresso: number[] = [];
    const r = await rodarRoteiro({
      medir: async (a: Acao) => {
        acoes.push(`${comparacao ? 2 : 1}:${a.tipo === "slider" ? `s${a.valor}` : a.testid}`);
        return { quadro: 1, rasterizado: acoes.length };
      },
      comparar: async (l) => {
        comparacao = l;
        modos.push(l);
      },
      progresso: (f) => progresso.push(f),
    });
    expect(r.slider).toHaveLength(ROTEIRO.slider.n);
    expect(r.troca_plano_imf).toHaveLength(ROTEIRO.troca_plano_imf.n);
    expect(r.troca_implante).toHaveLength(ROTEIRO.troca_implante.n);
    expect(r.slider_comparacao_2_paineis).toHaveLength(ROTEIRO.slider_comparacao_2_paineis.n);
    expect(acoes).toHaveLength(TOTAL_INTERACOES);
    expect(progresso.at(-1)).toBe(TOTAL_INTERACOES);
    expect(modos).toEqual([false, false, true]);
    // aquecimento não entra nas amostras; as de 1 painel vêm antes da comparação
    expect(r.slider[0]!.rasterizado).toBe(AQUECIMENTO_DESCARTADO + 1);
    expect(acoes.slice(AQUECIMENTO_DESCARTADO, AQUECIMENTO_DESCARTADO + 5)).toEqual(["1:s0", "1:s25", "1:s50", "1:s75", "1:s100"]);
    expect(acoes.slice(-ROTEIRO.slider_comparacao_2_paineis.n).every((a) => a.startsWith("2:s"))).toBe(true);
    const res = resumir(r);
    expect(res.geral_1_painel.n).toBe(ROTEIRO.slider.n + ROTEIRO.troca_plano_imf.n + ROTEIRO.troca_implante.n);
  });
});

describe("roteiro do modo foto (ADR 0019; e2e e /benchmark)", () => {
  it("1 foto, depois 2 fotos lado a lado, depois a cortina; aquecimento descartado; critérios < 100, ≤ 85 e < 16 ms", async () => {
    const acoes: string[] = [];
    const modos: string[] = [];
    let modo = "?";
    const progresso: number[] = [];
    const r = await rodarRoteiroFoto({
      medir: async (a: AcaoFoto) => {
        acoes.push(`${modo}:${a.tipo === "cortina" ? `c${a.posicao}` : a.testid}`);
        return { quadro: 1, rasterizado: acoes.length };
      },
      modo: async (m) => {
        modo = m;
        modos.push(m);
      },
      progresso: (f) => progresso.push(f),
    });
    expect(modos).toEqual(["foto", "lado", "cortina", "foto"]);
    expect(acoes).toHaveLength(TOTAL_INTERACOES_FOTO);
    expect(progresso.at(-1)).toBe(TOTAL_INTERACOES_FOTO);
    expect(r.foto_troca_1).toHaveLength(ROTEIRO_FOTO.foto_troca_1.n);
    expect(r.foto_troca_2).toHaveLength(ROTEIRO_FOTO.foto_troca_2.n);
    expect(r.cortina).toHaveLength(ROTEIRO_FOTO.cortina.n);
    // aquecimento fora das amostras; troca de implante (A ↔ B) faz parte do cenário de 1 foto
    expect(r.foto_troca_1[0]!.rasterizado).toBe(ROTEIRO_FOTO.aquecimento.length + 1);
    expect(acoes.filter((a) => a.startsWith("foto:foto-estado-")).length).toBeGreaterThan(2);
    expect(acoes.filter((a) => a.startsWith("lado:"))).toHaveLength(ROTEIRO_FOTO.foto_troca_2.n);
    expect(acoes.filter((a) => a.startsWith("cortina:c"))).toHaveLength(ROTEIRO_FOTO.cortina.n);
    expect(Object.keys(resumirFoto(r))).toEqual(["foto_troca_1", "foto_troca_2", "cortina"]);
    const c = Object.fromEntries(CRITERIOS_FOTO.map((x) => [x.chave, x]));
    expect(c.foto_troca_1).toMatchObject({ limite: 100, estrito: true });
    expect(c.foto_troca_2).toMatchObject({ limite: LIMITE_P95_2_PAINEIS_MS, estrito: false });
    expect(c.cortina).toMatchObject({ limite: LIMITE_P95_CORTINA_MS, estrito: true });
    expect(LIMITE_P95_CORTINA_MS).toBe(16);
    expect(dentroDoCriterio(c.cortina!, 15.99)).toBe(true);
    expect(dentroDoCriterio(c.cortina!, 16)).toBe(false);
  });
});

describe("flag BENCHMARK_HABILITADO (servidor; desligada por padrão)", () => {
  it("só '1' liga", () => {
    expect(benchmarkHabilitado({})).toBe(false);
    expect(benchmarkHabilitado({ BENCHMARK_HABILITADO: "0" })).toBe(false);
    expect(benchmarkHabilitado({ BENCHMARK_HABILITADO: "true" })).toBe(false);
    expect(benchmarkHabilitado({ BENCHMARK_HABILITADO: "1" })).toBe(true);
  });

  it("desligada: página e rotas dão 404", async () => {
    vi.stubEnv("BENCHMARK_HABILITADO", "");
    const { POST } = await import("@/app/api/benchmark/route");
    expect((await POST()).status).toBe(404);
    const { GET } = await import("@/app/api/benchmark/arquivo/route");
    expect((await GET(new Request("http://127.0.0.1/api/benchmark/arquivo?nome=morphs/subglandular__manter.glb"))).status).toBe(404);
    const { default: Pagina } = await import("@/app/benchmark/page");
    expect(() => Pagina()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("ligada: a rota de arquivo só serve os 4 .glb de morphs (lista fixa)", async () => {
    vi.stubEnv("BENCHMARK_HABILITADO", "1");
    expect([...ARQUIVOS_BENCHMARK].sort()).toEqual(["morphs/dual_plane__manter.glb", "morphs/dual_plane__rebaixar.glb", "morphs/subglandular__manter.glb", "morphs/subglandular__rebaixar.glb"]);
    for (const n of ["processada.obj", "../x.glb", "morphs/../../pacientes/a.glb", "morphs/manifest.json", ""]) expect(caminhoArquivoBenchmark(n)).toBeNull();
    const { GET } = await import("@/app/api/benchmark/arquivo/route");
    expect((await GET(new Request("http://127.0.0.1/api/benchmark/arquivo?nome=processada.obj"))).status).toBe(400);
  });
});
