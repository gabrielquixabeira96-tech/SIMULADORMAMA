"use client";

import { IMFS, PLANOS, ROTULOS_IMF, ROTULOS_PLANO, arquivoMorph, nomeTarget, type Imf, type ManifestMorphs, type Plano } from "@simulador/contratos";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AQUECIMENTO_DESCARTADO,
  CRITERIOS,
  LIMITE_P95_2_PAINEIS_MS,
  LIMITE_P95_MS,
  ROTEIRO,
  dentroDoCriterio,
  medirInteracao,
  resumir,
  rodarRoteiro,
  type AmostrasRoteiro,
  type ChaveResultado,
  type Resumo,
} from "./benchmark";
import type { ConjuntoMorph, PainelVista } from "./VisualizadorSimulacao";

const VisualizadorSimulacao = dynamic(() => import("./VisualizadorSimulacao"), {
  ssr: false,
  loading: () => <div className="viewer-vazio">Carregando simulação…</div>,
});

type Fase = "ocioso" | "preparando" | "carregando" | "medindo" | "concluido" | "erro";

const ROTULOS: Record<ChaveResultado, string> = {
  slider: "slider antes/depois (1 painel)",
  troca_plano_imf: "troca de plano / IMF (1 painel)",
  troca_implante: "troca de implante (1 painel)",
  geral_1_painel: "todas as interações de 1 painel",
  slider_comparacao_2_paineis: "slider na comparação lado a lado (2 painéis)",
};

const raf = () => new Promise<void>((ok) => requestAnimationFrame(() => ok()));

function infoWebgl(): { renderer: string | null; vendor: string | null } {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { renderer: null, vendor: null };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = { renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)) };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return r;
  } catch {
    return { renderer: null, vendor: null };
  }
}

/** Espera o viewer desenhar pelo menos um quadro em cada painel visível. */
async function esperarPaineis(n: number): Promise<void> {
  const t0 = performance.now();
  for (;;) {
    const ks = [...document.querySelectorAll('[data-testid^="sim-painel-"]')].map((e) => e.getAttribute("data-testid")!.replace("sim-painel-", ""));
    const q = (window as unknown as { __simuladorSim?: { quadros: Record<string, number> } }).__simuladorSim?.quadros ?? {};
    if (ks.length === n && ks.every((k) => (q[k] ?? 0) > 0)) break;
    if (performance.now() - t0 > 30_000) throw new Error("o viewer não desenhou em 30 s");
    await raf();
  }
  await raf();
  await raf();
}

/**
 * Benchmark de latência no aparelho (plano A14): prepara o torso sintético com os morphs de 2
 * implantes, roda o roteiro de `benchmark.ts` (o mesmo do e2e) e mostra p50/p95 por interação,
 * com o JSON para baixar e importar (`scripts/importar_latencia.py`).
 */
export function BenchmarkLatencia({ versaoSoftware, envelopeMm }: { versaoSoftware: string; envelopeMm: number }) {
  const [fase, setFase] = useState<Fase>("ocioso");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<[number, number]>([0, 0]);
  const [dados, setDados] = useState<{ manifest: ManifestMorphs; implantes: string[]; conjuntos: ConjuntoMorph[] } | null>(null);
  const [plano, setPlano] = useState<Plano>("subglandular");
  const [imf, setImf] = useState<Imf>("manter");
  const [peso, setPeso] = useState(1);
  const [comparar, setComparar] = useState(false);
  const [mostrado, setMostrado] = useState<0 | 1>(0);
  const [resultado, setResultado] = useState<{ resultados: Record<ChaveResultado, Resumo>; json: string } | null>(null);
  const [urlJson, setUrlJson] = useState<string | null>(null);
  const executando = useRef(false);

  useEffect(() => () => void (urlJson && URL.revokeObjectURL(urlJson)), [urlJson]);

  const paineis: PainelVista[] = useMemo(() => {
    if (!dados) return [];
    const [a, b] = dados.implantes as [string, string];
    if (comparar)
      return [
        { chave: "i1", rotulo: `Implante 1: ${a}`, implanteId: a },
        { chave: "i2", rotulo: `Implante 2: ${b}`, implanteId: b },
      ];
    const id = mostrado === 0 ? a : b;
    return [{ chave: "i1", rotulo: id, implanteId: id }];
  }, [dados, comparar, mostrado]);

  async function rodar() {
    if (executando.current) return;
    executando.current = true;
    setResultado(null);
    setUrlJson(null);
    try {
      let d = dados;
      if (!d) {
        setFase("preparando");
        setMensagem("Preparando o torso sintético e os morphs no servidor (só na primeira vez; pode levar alguns minutos)…");
        const r = await fetch("/api/benchmark", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.erro?.mensagem ?? j?.erro?.codigo ?? `erro ${r.status}`);
        const manifest = j.manifest as ManifestMorphs;
        const implantes = j.implantes as string[];
        setFase("carregando");
        setMensagem("Baixando os 4 .glb de morphs…");
        const { carregarGlb } = await import("@/viewer/carregar");
        const conjuntos = await Promise.all(
          manifest.arquivos.map(async (a) => ({
            plano: a.plano,
            imf: a.imf,
            carregada: await carregarGlb(`/api/benchmark/arquivo?nome=${encodeURIComponent(`morphs/${arquivoMorph(a.plano, a.imf)}`)}&v=${encodeURIComponent(manifest.gerado_em)}`, "morphs/1.0"),
          })),
        );
        for (const c of conjuntos) for (const id of implantes) if (!(nomeTarget(id, c.plano, c.imf) in (c.carregada.malha.morphTargetDictionary ?? {}))) throw new Error(`target ausente: ${id}`);
        d = { manifest, implantes, conjuntos };
        setDados(d);
      }
      setFase("medindo");
      setMensagem("Medindo: não toque na tela até terminar.");
      setPlano("subglandular");
      setImf("manter");
      setMostrado(0);
      setPeso(1);
      await esperarPaineis(comparar ? 2 : 1);
      const amostras: AmostrasRoteiro = await rodarRoteiro({
        medir: medirInteracao,
        comparar: async (ligado) => {
          setComparar(ligado);
          await esperarPaineis(ligado ? 2 : 1);
        },
        progresso: (feito, total) => setProgresso([feito, total]),
      });
      const resultados = resumir(amostras, "rasterizado");
      const canvas = document.querySelector('[data-testid="sim-painel-i1"] canvas')?.getBoundingClientRect();
      const gl = infoWebgl();
      const nav = navigator as Navigator & { deviceMemory?: number };
      const aprovado = CRITERIOS.every((c) => dentroDoCriterio(c, resultados[c.chave].p95_ms));
      const r = {
        esquema: "validacao_componente/web-marco2-latencia",
        origem: "pagina_benchmark",
        medido_em_hardware_real: true,
        versao_software: versaoSoftware,
        data: new Date().toISOString().slice(0, 10),
        maquina: {
          user_agent: navigator.userAgent,
          plataforma: navigator.platform || null,
          nucleos_logicos: navigator.hardwareConcurrency ?? null,
          memoria_gb: nav.deviceMemory ?? null,
          webgl_renderer: gl.renderer,
          webgl_vendor: gl.vendor,
          device_pixel_ratio: window.devicePixelRatio,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          canvas_px: canvas ? `${Math.round(canvas.width)}x${Math.round(canvas.height)}` : null,
        },
        parametros: {
          torso: "t01_simetrico_300 (sintético, processado pelo services/mesh, ~40 mil vértices)",
          implantes: d.implantes,
          morphs: "4 .glb (plano × IMF), pré-carregados",
          medida: "principal: input → quadro rasterizado (rAF após o render + readPixels); secundária: input → rAF após a emissão",
          limite_p95_ms: LIMITE_P95_MS,
          limite_p95_2_paineis_ms: LIMITE_P95_2_PAINEIS_MS,
          aquecimento_descartado: AQUECIMENTO_DESCARTADO,
          n_por_interacao: { slider: ROTEIRO.slider.n, troca_plano_imf: ROTEIRO.troca_plano_imf.n, troca_implante: ROTEIRO.troca_implante.n, slider_comparacao_2_paineis: ROTEIRO.slider_comparacao_2_paineis.n },
        },
        resultados,
        raf_apos_emissao: resumir(amostras, "quadro"),
        amostras_ms: amostras,
        aprovado,
      };
      const json = JSON.stringify(r, null, 2) + "\n";
      setResultado({ resultados, json });
      setUrlJson(URL.createObjectURL(new Blob([json], { type: "application/json" })));
      setFase("concluido");
      setMensagem(null);
    } catch (e) {
      setFase("erro");
      setMensagem((e as Error).message);
    } finally {
      executando.current = false;
    }
  }

  const ocupado = fase === "preparando" || fase === "carregando" || fase === "medindo";
  return (
    <section className="painel painel-simulacao" data-testid="benchmark">
      <div className="linha-form">
        <button type="button" onClick={rodar} disabled={ocupado} data-testid="benchmark-rodar">
          {ocupado ? "Rodando…" : resultado ? "Rodar de novo" : "Rodar benchmark"}
        </button>
        <span className="nota" data-testid="benchmark-fase" data-fase={fase}>
          {fase === "medindo" && progresso[1] > 0 ? `${progresso[0]}/${progresso[1]} interações. ` : ""}
          {mensagem}
        </span>
      </div>
      {fase === "erro" && (
        <p className="erro" role="alert">
          Benchmark falhou: {mensagem}
        </p>
      )}

      {resultado && (
        <div data-testid="benchmark-resultado">
          <table>
            <thead>
              <tr>
                <th>interação</th>
                <th>n</th>
                <th>p50 (ms)</th>
                <th>p95 (ms)</th>
                <th>máx. (ms)</th>
                <th>critério p95</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(ROTULOS) as ChaveResultado[]).map((k) => {
                const x = resultado.resultados[k];
                const c = CRITERIOS.find((y) => y.chave === k);
                return (
                  <tr key={k} data-testid={`benchmark-linha-${k}`}>
                    <td>{ROTULOS[k]}</td>
                    <td className="num">{x.n}</td>
                    <td className="num">{x.p50_ms.toFixed(1)}</td>
                    <td className="num">{x.p95_ms.toFixed(1)}</td>
                    <td className="num">{x.max_ms.toFixed(1)}</td>
                    <td>{c ? `${c.estrito ? "<" : "≤"} ${c.limite} ms: ${dentroDoCriterio(c, x.p95_ms) ? "atingido" : "NÃO atingido"}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="nota">
            Medido neste aparelho. Importe o arquivo com <code>python3 scripts/importar_latencia.py &lt;arquivo&gt;.json</code> para gerar o registro de validação.
          </p>
          {urlJson && (
            <a href={urlJson} download={`latencia-benchmark-${new Date().toISOString().slice(0, 10)}.json`} data-testid="benchmark-baixar">
              Baixar JSON da medição
            </a>
          )}
        </div>
      )}

      {dados && (
        <div className="sim-controles" data-testid="simulacao-pronta">
          <div className="linha-form" role="radiogroup" aria-label="Plano">
            {PLANOS.map((p) => (
              <label key={p} className="check">
                <input type="radio" name="plano" checked={plano === p} onChange={() => setPlano(p)} data-testid={`plano-${p}`} /> {ROTULOS_PLANO[p]}
              </label>
            ))}
          </div>
          <div className="linha-form" role="radiogroup" aria-label="Sulco inframamário">
            {IMFS.map((i) => (
              <label key={i} className="check">
                <input type="radio" name="imf" checked={imf === i} onChange={() => setImf(i)} data-testid={`imf-${i}`} /> {ROTULOS_IMF[i]}
              </label>
            ))}
          </div>
          <label className="slider">
            Antes
            <input type="range" min={0} max={100} step={1} value={Math.round(peso * 100)} onChange={(e) => setPeso(Number(e.target.value) / 100)} data-testid="slider-peso" aria-label="Antes e depois" />
            Depois <span className="num">{Math.round(peso * 100)}%</span>
          </label>
          <div className="linha-form">
            <label className="check">
              <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} data-testid="comparar" /> Comparar lado a lado
            </label>
            {!comparar &&
              ([0, 1] as const).map((k) => (
                <label key={k} className="check">
                  <input type="radio" name="mostrado" checked={mostrado === k} onChange={() => setMostrado(k)} data-testid={`mostrar-implante-${k + 1}`} /> Implante {k + 1}
                </label>
              ))}
          </div>
          <VisualizadorSimulacao conjuntos={dados.conjuntos} paineis={paineis} plano={plano} imf={imf} peso={peso} envelopeMm={envelopeMm} vista="frente" instrumentar />
        </div>
      )}
    </section>
  );
}
