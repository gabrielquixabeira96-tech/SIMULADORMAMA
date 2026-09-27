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
import { expect, test } from "@playwright/test";
import { AQUECIMENTO_DESCARTADO, CRITERIOS, LIMITE_P95_2_PAINEIS_MS, LIMITE_P95_MS, dentroDoCriterio, medirInteracao, resumir, rodarRoteiro } from "../src/simulacao/benchmark";
import { IMPLANTE_1, IMPLANTE_2, esperarQuadro, prepararSimulacao } from "./simulacao-apoio";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../../..");
const VERSAO = readFileSync(join(RAIZ, "VERSION"), "utf8").trim();
const VIEWPORT = { width: 1600, height: 1000 };

test.use({ viewport: VIEWPORT });

test("latência da simulação: 1 painel (p95 < 100 ms) e comparação lado a lado (p95 ≤ 85 ms)", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desenho-B", "benchmark roda uma vez (desenho B)");
  test.setTimeout(10 * 60_000);
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  await page.getByTestId("comparar").uncheck();
  await page.getByTestId("slider-peso").scrollIntoViewIfNeeded();
  await esperarQuadro(page);

  // mesmo roteiro (e mesmo n) da página /benchmark: src/simulacao/benchmark.ts
  const amostras = await rodarRoteiro({
    medir: (a) => page.evaluate(medirInteracao, a),
    comparar: async (ligado) => {
      await page.getByTestId("comparar").setChecked(ligado);
      await esperarQuadro(page);
    },
  });
  const { slider, troca_plano_imf: planoImf, troca_implante: implante, slider_comparacao_2_paineis: sliderComparacao } = amostras;

  const canvas = await page.getByTestId("sim-painel-i1").locator("canvas").boundingBox();
  if (process.env.E2E_CAPTURA) await page.getByTestId("simulacao-paineis").screenshot({ path: process.env.E2E_CAPTURA });
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
      desenho: "cena = pele com faixa do envelope + casca +4,5 mm por painel; frameloop sob demanda; render síncrono no evento; triângulos em ordem de cache; faces de costas da pele descartadas na CPU por vista",
      medida: "principal: input → quadro rasterizado (rAF após o render + readPixels); secundária: input → rAF após a emissão",
      limite_p95_ms: LIMITE_P95_MS,
      limite_p95_2_paineis_ms: LIMITE_P95_2_PAINEIS_MS,
      aquecimento_descartado: AQUECIMENTO_DESCARTADO,
    },
    /** métrica principal: input → quadro rasterizado (readPixels confirma o fim do trabalho da GPU) */
    resultados: resumir(amostras, "rasterizado"),
    /** secundária: input → rAF após o quadro emitido (o render é síncrono no evento, então não inclui a GPU) */
    raf_apos_emissao: resumir(amostras, "quadro"),
    amostras_ms: { slider, troca_plano_imf: planoImf, troca_implante: implante, slider_comparacao_2_paineis: sliderComparacao },
  };
  const aprovado = CRITERIOS.every((c) => dentroDoCriterio(c, r.resultados[c.chave].p95_ms));
  escrever({ ...r, aprovado });
  console.log(`[latencia] rasterizado ${JSON.stringify(r.resultados)}`);
  console.log(`[latencia] raf ${JSON.stringify(r.raf_apos_emissao)}`);

  expect(slider.length).toBeGreaterThanOrEqual(50);
  for (const c of CRITERIOS) {
    const p95 = r.resultados[c.chave].p95_ms;
    if (c.estrito) expect(p95, `p95 de ${c.chave}`).toBeLessThan(c.limite);
    else expect(p95, `p95 de ${c.chave}`).toBeLessThanOrEqual(c.limite);
  }
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

- Cena por painel: pele (Lambert, textura) com morph targets e a faixa do envelope pintada na pele + casca translúcida a +4,5 mm ao longo da normal deformada (só sobre a região que o implante altera), ~40 mil vértices / ~80 mil triângulos; 4 \`.glb\` (plano × IMF) pré-carregados; \`frameloop="demand"\`, sem MSAA, \`dpr = 1\`, sem tone mapping. Triângulos em ordem amigável ao cache de vértices e, a cada mudança de vista ou de alvo, as faces de costas da pele (de costas em peso 0, 0,5 e 1, com margem) saem do índice na CPU: a GPU as descartaria de qualquer forma, então a imagem é a mesma com menos trabalho de vértice/primitiva.
- **Latência (métrica principal e critério)** = \`performance.now()\` no disparo do evento (input do slider / clique no rádio) até o quadro **rasterizado** em todos os painéis visíveis: o viewer renderiza de forma síncrona dentro do evento (\`advance()\` do R3F), espera-se o contador de quadros avançar e o \`requestAnimationFrame\` seguinte, e um \`readPixels\` de 1 px em cada canvas força a GPU (SwiftShader) a terminar o quadro. É mais estrita que "rAF após a atualização" (secundária, na tabela de baixo), que com o render síncrono não inclui o trabalho da GPU.
- Cada amostra parte de estado ocioso (nenhum quadro pendente).
- ${r.parametros.aquecimento_descartado} interações de aquecimento descartadas (compilação de shaders e upload das texturas de morph de cada \`.glb\`). Critérios: p95 < ${r.parametros.limite_p95_ms} ms no slider, na troca de plano/IMF e na troca de implante (1 painel) e p95 ≤ ${r.parametros.limite_p95_2_paineis_ms} ms no slider da comparação lado a lado (2 painéis). Roteiro e n iguais aos da página \`/benchmark\` (\`apps/web/src/simulacao/benchmark.ts\`).
- Canvas: ${r.maquina.canvas_px} px (viewport ${r.maquina.viewport}).

## Resultados (ms)

| interação | n | p50 | p95 | máx. | média |
|---|---|---|---|---|---|
${linha("slider", "slider antes/depois (1 painel)")}
${linha("troca_plano_imf", "troca de plano / IMF")}
${linha("troca_implante", "troca de implante")}
${linha("geral_1_painel", "todas as interações de 1 painel")}
${linha("slider_comparacao_2_paineis", "slider na comparação lado a lado (2 painéis)")}

**Resultado:** ${r.aprovado ? `p95 < ${r.parametros.limite_p95_ms} ms em slider, troca de plano/IMF e troca de implante e p95 ≤ ${r.parametros.limite_p95_2_paineis_ms} ms no slider com 2 painéis → critérios ATINGIDOS` : "algum p95 acima do limite → critério NÃO ATINGIDO"} (no SwiftShader headless). Comparação lado a lado (2 canvases, 2× o trabalho de vértices): p95 ${r.resultados.slider_comparacao_2_paineis.p95_ms} ms (limite ${r.parametros.limite_p95_2_paineis_ms} ms).

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

- Medido em software (SwiftShader), não no iPad; falta a medição no hardware-alvo (Safari/WebKit + GPU Apple). A página \`/benchmark\` (com \`BENCHMARK_HABILITADO=1\`) roda o mesmo roteiro no aparelho e baixa o JSON; \`python3 scripts/importar_latencia.py <json>\` gera o registro "medido em hardware real".
- Em máquina compartilhada (outros processos disputando a CPU), o SwiftShader fica mais lento e o p95 sobe: medir com a máquina ociosa.
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
