/**
 * Benchmark automatizado de latência de interação da simulação (Marco 2: < 100 ms).
 * Latência = do evento de input (slider, troca de plano/IMF, troca de implante) até o quadro
 * renderizado: o contador de quadros de TODOS os painéis visíveis avança (R3F renderiza no
 * rAF agendado pelo invalidate) e mede-se no rAF seguinte a esse render, no mesmo quadro.
 *
 * Ambiente: Chromium headless com WebGL por SOFTWARE (SwiftShader), NÃO é o iPad.
 * Relatório: test-results/validacao/ e, com RELATORIO_VALIDACAO=1, docs/validacao/.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { IMPLANTE_1, IMPLANTE_2, esperarQuadro, prepararSimulacao } from "./simulacao-apoio";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../../..");
const VERSAO = readFileSync(join(RAIZ, "VERSION"), "utf8").trim();
const VIEWPORT = { width: 1600, height: 1000 };
const LIMITE_P95_MS = 100;

test.use({ viewport: VIEWPORT });

type Acao = { tipo: "slider"; valor: number } | { tipo: "clique"; testid: string };

interface Amostra {
  /** input → rAF após o quadro emitido em todos os painéis (métrica pedida). */
  quadro: number;
  /** input → quadro rasterizado (readPixels força a GPU/SwiftShader a terminar). Mais estrita. */
  rasterizado: number;
}

/**
 * Executa a ação DENTRO da página, a partir de um estado ocioso (sem quadro pendente), e mede
 * as duas latências. O contador de quadros vem do useFrame de cada painel (gancho de teste).
 */
async function medir(page: Page, acao: Acao): Promise<Amostra> {
  return page.evaluate(async (a) => {
    const g = (window as any).__simuladorSim as { quadros: Record<string, number> };
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
  }, acao);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const resumo = (xs: number[]) => ({ n: xs.length, p50_ms: +pct(xs, 50).toFixed(2), p95_ms: +pct(xs, 95).toFixed(2), max_ms: +Math.max(...xs).toFixed(2), media_ms: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) });

test("latência da simulação: slider, plano/IMF e implante (p95 < 100 ms)", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desenho-B", "benchmark roda uma vez (desenho B)");
  test.setTimeout(10 * 60_000);
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  await page.getByTestId("comparar").uncheck();
  await page.getByTestId("slider-peso").scrollIntoViewIfNeeded();
  await esperarQuadro(page);

  // aquecimento (compilação de shaders e upload das texturas de morph dos 4 .glb): descartado
  for (const t of ["plano-dual_plane", "imf-rebaixar", "plano-subglandular", "imf-manter", "mostrar-implante-2", "mostrar-implante-1"]) await medir(page, { tipo: "clique", testid: t });
  const q = (xs: Amostra[]) => xs.map((x) => x.quadro);
  const rz = (xs: Amostra[]) => xs.map((x) => x.rasterizado);
  await medir(page, { tipo: "clique", testid: "comparar" });
  await medir(page, { tipo: "clique", testid: "comparar" });

  const slider: Amostra[] = [];
  for (let i = 0; i < 60; i++) slider.push(await medir(page, { tipo: "slider", valor: [0, 25, 50, 75, 100][i % 5]! }));
  const planoImf: Amostra[] = [];
  const ciclo = ["plano-dual_plane", "imf-rebaixar", "plano-subglandular", "imf-manter"];
  for (let i = 0; i < 24; i++) planoImf.push(await medir(page, { tipo: "clique", testid: ciclo[i % 4]! }));
  const implante: Amostra[] = [];
  for (let i = 0; i < 20; i++) implante.push(await medir(page, { tipo: "clique", testid: i % 2 === 0 ? "mostrar-implante-2" : "mostrar-implante-1" }));
  // comparação lado a lado (2 canvases): slider
  await page.getByTestId("comparar").check();
  await esperarQuadro(page);
  const sliderComparacao: Amostra[] = [];
  for (let i = 0; i < 30; i++) sliderComparacao.push(await medir(page, { tipo: "slider", valor: [60, 20, 80, 40, 100][i % 5]! }));

  const canvas = await page.getByTestId("sim-painel-i1").locator("canvas").boundingBox();
  if (process.env.E2E_CAPTURA) await page.getByTestId("simulacao-paineis").screenshot({ path: process.env.E2E_CAPTURA });
  const todos = [...slider, ...planoImf, ...implante];
  const r = {
    esquema: "validacao_componente/web-marco2-latencia",
    versao_software: VERSAO,
    data: new Date().toISOString().slice(0, 10),
    commit_base: execSync("git rev-parse --short HEAD", { cwd: RAIZ }).toString().trim(),
    maquina: {
      os: process.platform,
      cpu: cpus()[0]?.model ?? "?",
      n_cpus: cpus().length,
      memoria_gb: +(totalmem() / 2 ** 30).toFixed(1),
      node: process.version,
      navegador: `chromium ${browser.version()} headless`,
      webgl: "SwiftShader (software) — NÃO é o iPad nem GPU",
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      canvas_px: canvas ? `${Math.round(canvas.width)}x${Math.round(canvas.height)}` : null,
    },
    parametros: {
      torso: "t01_simetrico_300 (processado pelo services/mesh, ~40 mil vértices)",
      implantes: [IMPLANTE_1, IMPLANTE_2],
      morphs: "4 .glb (plano × IMF), 6 targets cada (2 implantes × ambos/dir/esq), pré-carregados",
      desenho: "cena = pele com faixa do envelope + casca +4,5 mm por painel; frameloop sob demanda; render síncrono no evento",
      medida: "principal: input → quadro rasterizado (rAF após o render + readPixels); secundária: input → rAF após a emissão",
      limite_p95_ms: LIMITE_P95_MS,
      aquecimento_descartado: 8,
    },
    /** métrica principal: input → quadro rasterizado (readPixels confirma o fim do trabalho da GPU) */
    resultados: {
      slider: resumo(rz(slider)),
      troca_plano_imf: resumo(rz(planoImf)),
      troca_implante: resumo(rz(implante)),
      geral_1_painel: resumo(rz(todos)),
      slider_comparacao_2_paineis: resumo(rz(sliderComparacao)),
    },
    /** secundária: input → rAF após o quadro emitido (o render é síncrono no evento, então não inclui a GPU) */
    raf_apos_emissao: {
      slider: resumo(q(slider)),
      troca_plano_imf: resumo(q(planoImf)),
      troca_implante: resumo(q(implante)),
      geral_1_painel: resumo(q(todos)),
      slider_comparacao_2_paineis: resumo(q(sliderComparacao)),
    },
    amostras_ms: { slider, troca_plano_imf: planoImf, troca_implante: implante, slider_comparacao_2_paineis: sliderComparacao },
  };
  const GATE = ["slider", "troca_plano_imf", "troca_implante", "geral_1_painel"] as const;
  const aprovado = GATE.every((k) => r.resultados[k].p95_ms < LIMITE_P95_MS);
  escrever({ ...r, aprovado });
  console.log(`[latencia] rasterizado ${JSON.stringify(r.resultados)}`);
  console.log(`[latencia] raf ${JSON.stringify(r.raf_apos_emissao)}`);

  expect(slider.length).toBeGreaterThanOrEqual(50);
  for (const k of GATE) expect(r.resultados[k].p95_ms, `p95 de ${k}`).toBeLessThan(LIMITE_P95_MS);
});

function escrever(r: any) {
  const linhaRaf = (k: string, rot: string) => {
    const x = r.raf_apos_emissao[k];
    return `| ${rot} | ${x.n} | ${x.p50_ms.toFixed(1)} | ${x.p95_ms.toFixed(1)} | ${x.max_ms.toFixed(1)} | ${x.media_ms.toFixed(1)} |`;
  };
  const linha = (k: string, rot: string) => {
    const x = r.resultados[k];
    return `| ${rot} | ${x.n} | ${x.p50_ms.toFixed(1)} | ${x.p95_ms.toFixed(1)} | ${x.max_ms.toFixed(1)} | ${x.media_ms.toFixed(1)} |`;
  };
  const md = `---
esquema: validacao_componente/web-marco2-latencia
versao_software: ${r.versao_software}
data: ${r.data}
commit_base: ${r.commit_base}
desenho_testado: [B]
ambiente: { os: ${r.maquina.os}, cpu: "${r.maquina.cpu}", n_cpus: ${r.maquina.n_cpus}, memoria_gb: ${r.maquina.memoria_gb}, node: "${r.maquina.node}", navegador: "${r.maquina.navegador}", webgl: "SwiftShader (software)", viewport: "${r.maquina.viewport}", canvas_px: "${r.maquina.canvas_px}" }
resultados:
  marco2_latencia_p95_ms: ${r.resultados.geral_1_painel.p95_ms}
  slider: { n: ${r.resultados.slider.n}, p50_ms: ${r.resultados.slider.p50_ms}, p95_ms: ${r.resultados.slider.p95_ms}, max_ms: ${r.resultados.slider.max_ms} }
  troca_plano_imf: { n: ${r.resultados.troca_plano_imf.n}, p50_ms: ${r.resultados.troca_plano_imf.p50_ms}, p95_ms: ${r.resultados.troca_plano_imf.p95_ms}, max_ms: ${r.resultados.troca_plano_imf.max_ms} }
  troca_implante: { n: ${r.resultados.troca_implante.n}, p50_ms: ${r.resultados.troca_implante.p50_ms}, p95_ms: ${r.resultados.troca_implante.p95_ms}, max_ms: ${r.resultados.troca_implante.max_ms} }
  slider_comparacao_2_paineis: { n: ${r.resultados.slider_comparacao_2_paineis.n}, p50_ms: ${r.resultados.slider_comparacao_2_paineis.p50_ms}, p95_ms: ${r.resultados.slider_comparacao_2_paineis.p95_ms}, max_ms: ${r.resultados.slider_comparacao_2_paineis.max_ms} }
status: ${r.aprovado ? "aprovado" : "reprovado"}
---

# Validação do apps/web — Marco 2: latência de interação da simulação (v${r.versao_software})

Gerado automaticamente por \`apps/web/e2e/latencia.spec.ts\` (Playwright contra o stack real: services/mesh gera os morphs, Next.js serve e o viewer interpola). Só torso sintético; nenhum dado de paciente.

**Máquina: Chromium ${r.maquina.navegador.replace("chromium ", "")} com WebGL por SOFTWARE (SwiftShader), ${r.maquina.n_cpus} CPUs (${r.maquina.cpu}), ${r.maquina.memoria_gb} GB. NÃO é o iPad nem um desktop com GPU**: é o pior caso de renderização disponível na CI; a meta do produto (< 100 ms no iPad, < 16 ms no desktop; contratos §10.1) precisa ser remedida no hardware real.

## Método

- Cena por painel: pele (Lambert, textura) com morph targets e a faixa do envelope pintada na pele + casca translúcida a +4,5 mm ao longo da normal deformada (só sobre a região que o implante altera), ~40 mil vértices / ~80 mil triângulos; 4 \`.glb\` (plano × IMF) pré-carregados; \`frameloop="demand"\`, sem MSAA, \`dpr = 1\`, sem tone mapping.
- **Latência (métrica principal e critério)** = \`performance.now()\` no disparo do evento (input do slider / clique no rádio) até o quadro **rasterizado** em todos os painéis visíveis: o viewer renderiza de forma síncrona dentro do evento (\`advance()\` do R3F), espera-se o contador de quadros avançar e o \`requestAnimationFrame\` seguinte, e um \`readPixels\` de 1 px em cada canvas força a GPU (SwiftShader) a terminar o quadro. É mais estrita que "rAF após a atualização" (secundária, na tabela de baixo), que com o render síncrono não inclui o trabalho da GPU.
- Cada amostra parte de estado ocioso (nenhum quadro pendente).
- ${r.parametros.aquecimento_descartado} interações de aquecimento descartadas (compilação de shaders e upload das texturas de morph de cada \`.glb\`). Critério: p95 < ${r.parametros.limite_p95_ms} ms no slider, na troca de plano/IMF e na troca de implante (1 painel); a comparação lado a lado é informativa.
- Canvas: ${r.maquina.canvas_px} px (viewport ${r.maquina.viewport}).

## Resultados (ms)

| interação | n | p50 | p95 | máx. | média |
|---|---|---|---|---|---|
${linha("slider", "slider antes/depois (1 painel)")}
${linha("troca_plano_imf", "troca de plano / IMF")}
${linha("troca_implante", "troca de implante")}
${linha("geral_1_painel", "todas as interações de 1 painel")}
${linha("slider_comparacao_2_paineis", "slider na comparação lado a lado (2 painéis) — informativo")}

**Resultado:** ${r.aprovado ? "p95 < 100 ms em slider, troca de plano/IMF e troca de implante → critério ATINGIDO" : "algum p95 ≥ 100 ms → critério NÃO ATINGIDO"} (no SwiftShader headless). A comparação lado a lado renderiza 2 canvases (2× o trabalho de vértices) e ${r.resultados.slider_comparacao_2_paineis.p95_ms < 100 ? "também fica abaixo de 100 ms" : "**fica acima de 100 ms no SwiftShader**; é informativa e precisa ser medida no hardware-alvo"}.

Secundária — input → rAF após o quadro emitido (não inclui GPU):

| interação | n | p50 | p95 | máx. | média |
|---|---|---|---|---|---|
${linhaRaf("slider", "slider (1 painel)")}
${linhaRaf("troca_plano_imf", "troca de plano / IMF")}
${linhaRaf("troca_implante", "troca de implante")}
${linhaRaf("slider_comparacao_2_paineis", "slider (2 painéis)")}

## Como reproduzir

\`\`\`bash
bash scripts/mesh.sh venv && bash scripts/mesh.sh torsos
RELATORIO_VALIDACAO=1 pnpm --filter web test:e2e -- --project=desenho-B e2e/latencia.spec.ts
\`\`\`

Amostras brutas em \`v${r.versao_software}-web-marco2-latencia.json\`.

## Desvios e pendências

- Medido em software (SwiftShader), não no iPad; falta a medição no hardware-alvo (Safari/WebKit + GPU Apple).
- A geração dos morphs (\`POST /morphs\`, segundos) não entra na latência de interação: acontece uma vez por escolha de implantes, antes da interação.
`;
  const destinos = [join(AQUI, "../test-results/validacao")];
  if (process.env.RELATORIO_VALIDACAO === "1") destinos.push(join(RAIZ, "docs/validacao"));
  for (const d of destinos) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, `v${r.versao_software}-web-marco2-latencia.md`), md);
    writeFileSync(join(d, `v${r.versao_software}-web-marco2-latencia.json`), JSON.stringify(r, null, 2) + "\n");
  }
}
