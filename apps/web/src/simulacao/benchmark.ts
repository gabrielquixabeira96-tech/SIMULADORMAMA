/**
 * Benchmark de latência de interação da simulação (Marco 2; contratos §10.1). Um só roteiro,
 * usado pelo e2e `e2e/latencia.spec.ts` (Chromium/SwiftShader na CI) e pela página `/benchmark`
 * (hardware-alvo: iPad/Safari), para que os dois meçam a mesma coisa com o mesmo n.
 *
 * Latência = do disparo do evento (input do slider / clique no rádio) até o quadro RASTERIZADO em
 * todos os painéis visíveis: espera-se o contador de quadros de cada painel avançar (useFrame do
 * viewer) e o `requestAnimationFrame` seguinte, e um `readPixels` de 1 px em cada canvas força a
 * GPU a terminar o quadro. Secundária: input → rAF após o quadro emitido (sem esperar a GPU).
 *
 * Nada aqui mede no lugar de ninguém: os números saem do navegador que roda o roteiro.
 */

export type Acao = { tipo: "slider"; valor: number } | { tipo: "clique"; testid: string };

export interface Amostra {
  /** input → rAF após o quadro emitido em todos os painéis (secundária). */
  quadro: number;
  /** input → quadro rasterizado (readPixels força a GPU a terminar). Métrica principal e critério. */
  rasterizado: number;
}

export interface Resumo {
  n: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  media_ms: number;
}

/** Critério do painel único (contratos §10.1: < 100 ms). */
export const LIMITE_P95_MS = 100;
/** Critério da comparação lado a lado (2 painéis), com margem sobre os 100 ms (plano A12). */
export const LIMITE_P95_2_PAINEIS_MS = 85;

/** Tamanho de cada bloco do roteiro (o mesmo no e2e e na página /benchmark). */
export const ROTEIRO = {
  aquecimento: ["plano-dual_plane", "imf-rebaixar", "plano-subglandular", "imf-manter", "mostrar-implante-2", "mostrar-implante-1"],
  aquecimento_comparacao: 2,
  slider: { n: 60, valores: [0, 25, 50, 75, 100] },
  troca_plano_imf: { n: 24, ciclo: ["plano-dual_plane", "imf-rebaixar", "plano-subglandular", "imf-manter"] },
  troca_implante: { n: 20, ciclo: ["mostrar-implante-2", "mostrar-implante-1"] },
  slider_comparacao_2_paineis: { n: 30, valores: [60, 20, 80, 40, 100] },
} as const;

export const AQUECIMENTO_DESCARTADO = ROTEIRO.aquecimento.length + ROTEIRO.aquecimento_comparacao;

/**
 * Executa UMA interação dentro da página, a partir de um estado ocioso (nenhum quadro pendente),
 * e mede as duas latências. Autocontida (sem referências externas) para poder ir inteira ao
 * navegador pelo `page.evaluate` do Playwright; a página /benchmark a chama direto.
 */
export async function medirInteracao(a: Acao): Promise<Amostra> {
  const g = (window as unknown as { __simuladorSim?: { quadros: Record<string, number> } }).__simuladorSim;
  if (!g) throw new Error("contador de quadros ausente (viewer sem instrumentação)");
  const raf = () => new Promise<void>((ok) => requestAnimationFrame(() => ok()));
  const paineis = () => [...document.querySelectorAll('[data-testid^="sim-painel-"]')].map((e) => e.getAttribute("data-testid")!.replace("sim-painel-", ""));
  // ocioso: nenhum quadro novo por 2 rAFs seguidos
  for (let i = 0, ultimo = JSON.stringify(g.quadros); i < 50; i++) {
    await raf();
    await raf();
    const agora = JSON.stringify(g.quadros);
    if (agora === ultimo) break;
    ultimo = agora;
  }
  await new Promise((ok) => setTimeout(ok, 30));
  const antes: Record<string, number> = { ...g.quadros };
  const t0 = performance.now();
  if (a.tipo === "slider") {
    const el = document.querySelector('[data-testid="slider-peso"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(a.valor));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    (document.querySelector(`[data-testid="${a.testid}"]`) as HTMLElement).click();
  }
  const quadro = await new Promise<number>((ok, erro) => {
    const passo = () => {
      const agora = performance.now();
      if (paineis().every((k) => (g.quadros[k] ?? 0) > (antes[k] ?? 0))) return ok(agora - t0);
      if (agora - t0 > 5000) return erro(new Error("quadro não renderizado em 5 s"));
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
  const px = new Uint8Array(4);
  for (const k of paineis()) {
    const c = document.querySelector(`[data-testid="sim-painel-${k}"] canvas`) as HTMLCanvasElement;
    const ctx = c.getContext("webgl2") as WebGL2RenderingContext;
    ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  }
  return { quadro, rasterizado: performance.now() - t0 };
}

/** Percentil pelo método do posto mais próximo (o mesmo do registro v0.1.1). */
export function percentil(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export function resumo(xs: readonly number[]): Resumo {
  return {
    n: xs.length,
    p50_ms: +percentil(xs, 50).toFixed(2),
    p95_ms: +percentil(xs, 95).toFixed(2),
    max_ms: +Math.max(...xs).toFixed(2),
    media_ms: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2),
  };
}

export interface AmostrasRoteiro {
  slider: Amostra[];
  troca_plano_imf: Amostra[];
  troca_implante: Amostra[];
  slider_comparacao_2_paineis: Amostra[];
}

export type ChaveResultado = keyof AmostrasRoteiro | "geral_1_painel";

export interface ExecutorRoteiro {
  medir(a: Acao): Promise<Amostra>;
  /** Liga/desliga a comparação lado a lado e espera o primeiro quadro no novo modo. */
  comparar(ligado: boolean): Promise<void>;
  /** Progresso (opcional; a página mostra). */
  progresso?(feito: number, total: number): void;
}

export const TOTAL_INTERACOES =
  AQUECIMENTO_DESCARTADO + ROTEIRO.slider.n + ROTEIRO.troca_plano_imf.n + ROTEIRO.troca_implante.n + ROTEIRO.slider_comparacao_2_paineis.n;

/**
 * Roteiro completo: aquecimento (descartado), slider / plano-IMF / implante em 1 painel e slider na
 * comparação lado a lado (2 painéis). Parte do modo 1 painel com os 2 implantes gerados.
 */
export async function rodarRoteiro(x: ExecutorRoteiro): Promise<AmostrasRoteiro> {
  let feito = 0;
  const medir = async (a: Acao) => {
    const r = await x.medir(a);
    x.progresso?.(++feito, TOTAL_INTERACOES);
    return r;
  };
  await x.comparar(false);
  // aquecimento (compilação de shaders e upload das texturas de morph dos 4 .glb): descartado
  for (const t of ROTEIRO.aquecimento) await medir({ tipo: "clique", testid: t });
  for (let i = 0; i < ROTEIRO.aquecimento_comparacao; i++) await medir({ tipo: "clique", testid: "comparar" });
  await x.comparar(false);
  const r: AmostrasRoteiro = { slider: [], troca_plano_imf: [], troca_implante: [], slider_comparacao_2_paineis: [] };
  const s = ROTEIRO.slider;
  for (let i = 0; i < s.n; i++) r.slider.push(await medir({ tipo: "slider", valor: s.valores[i % s.valores.length]! }));
  const p = ROTEIRO.troca_plano_imf;
  for (let i = 0; i < p.n; i++) r.troca_plano_imf.push(await medir({ tipo: "clique", testid: p.ciclo[i % p.ciclo.length]! }));
  const t = ROTEIRO.troca_implante;
  for (let i = 0; i < t.n; i++) r.troca_implante.push(await medir({ tipo: "clique", testid: t.ciclo[i % t.ciclo.length]! }));
  await x.comparar(true);
  const c = ROTEIRO.slider_comparacao_2_paineis;
  for (let i = 0; i < c.n; i++) r.slider_comparacao_2_paineis.push(await medir({ tipo: "slider", valor: c.valores[i % c.valores.length]! }));
  return r;
}

/** Resumos por interação (métrica principal: rasterizado; secundária: rAF após a emissão). */
export function resumir(a: AmostrasRoteiro, m: keyof Amostra = "rasterizado"): Record<ChaveResultado, Resumo> {
  const v = (xs: Amostra[]) => xs.map((x) => x[m]);
  return {
    slider: resumo(v(a.slider)),
    troca_plano_imf: resumo(v(a.troca_plano_imf)),
    troca_implante: resumo(v(a.troca_implante)),
    geral_1_painel: resumo(v([...a.slider, ...a.troca_plano_imf, ...a.troca_implante])),
    slider_comparacao_2_paineis: resumo(v(a.slider_comparacao_2_paineis)),
  };
}

/** Critérios: p95 < 100 ms nas interações de 1 painel e p95 ≤ 85 ms no slider com 2 painéis. */
export const CRITERIOS: ReadonlyArray<{ chave: ChaveResultado; limite: number; estrito: boolean }> = [
  { chave: "slider", limite: LIMITE_P95_MS, estrito: true },
  { chave: "troca_plano_imf", limite: LIMITE_P95_MS, estrito: true },
  { chave: "troca_implante", limite: LIMITE_P95_MS, estrito: true },
  { chave: "geral_1_painel", limite: LIMITE_P95_MS, estrito: true },
  { chave: "slider_comparacao_2_paineis", limite: LIMITE_P95_2_PAINEIS_MS, estrito: false },
];

export function dentroDoCriterio(c: (typeof CRITERIOS)[number], p95: number): boolean {
  return c.estrito ? p95 < c.limite : p95 <= c.limite;
}
