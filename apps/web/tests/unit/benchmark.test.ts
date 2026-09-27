/**
 * Benchmark de latência (planos A12/A14): roteiro único (e2e e página /benchmark), estatística e
 * a flag de servidor BENCHMARK_HABILITADO (desligada por padrão: página e rotas somem com 404).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARQUIVOS_BENCHMARK, benchmarkHabilitado, caminhoArquivoBenchmark } from "@/benchmark/servidor";
import { AQUECIMENTO_DESCARTADO, CRITERIOS, LIMITE_P95_2_PAINEIS_MS, ROTEIRO, TOTAL_INTERACOES, dentroDoCriterio, percentil, resumir, resumo, rodarRoteiro, type Acao } from "@/simulacao/benchmark";

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
