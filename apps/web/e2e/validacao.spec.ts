/**
 * PROVAS dos Marcos 0 e 1 (ESTRATEGIA/PROMPT; RDC 657 art. 5º) contra o stack real
 * (services/mesh Python + Next.js + Postgres), nos 3 torsos sintéticos do gerador.
 *
 * Marco 0 — escala: cada torso abre no viewer (GLB do gerador e malha processada pelo serviço);
 *   a caixa envolvente na tela bate com a do torso.obj e as distâncias medidas pelo pipeline do
 *   app (landmarks do gabarito → euclidiana no cliente + /medir) ficam a ±1 mm do gabarito.
 * Marco 1 — cliques: um operador simulado mira cada landmark do gabarito (projeção para pixels
 *   com a câmera viva, na vista mais perpendicular) e clica com jitter uniforme de ±1 px; o
 *   viewer faz o raycast, o cliente calcula as euclidianas e o /medir as geodésicas. Os pares
 *   (medido × gabarito) vão ao Bland-Altman do services/mesh (/validar-bland-altman).
 *
 * Relatório: sempre em test-results/validacao/; com RELATORIO_VALIDACAO=1 também em
 * docs/validacao/v<versao>-web-marcos-0-1.{md,json}.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { TORSOS } from "./fixtures";
import {
  LANDMARKS,
  caixaObj,
  clicarLandmark,
  dataDirE2E,
  dimensoesNaTela,
  importarTorso,
  lerGabarito,
  medirNoServico,
  melhorVista,
  novoAtendimento,
  prng,
  projetar,
  escolherVista,
  type V3,
} from "./apoio";
import type { NomeVista } from "../src/viewer/vistas";

const AQUI = dirname(fileURLToPath(import.meta.url));

const RAIZ = resolve(AQUI, "../../..");
const VERSAO = readFileSync(join(RAIZ, "VERSION"), "utf8").trim();
const JITTER_PX = 1;
const REPETICOES = 2; // dois "operadores" simulados (sementes diferentes)
const DISTS = ["ssn_n_dir", "ssn_n_esq", "n_imf_dir", "n_imf_esq", "base_dir", "base_esq", "intermamilar"] as const;

test.use({ viewport: { width: 1920, height: 1080 } });

interface Par {
  medida: string;
  distancia: string;
  tipo: "euclidiana" | "geodesica";
  referencia_mm: number;
  medido_mm: number;
  torso: string;
  operador: string;
}

async function blandAltman(page: Page, pares: Par[]) {
  const r = await page.request.post(`${process.env.E2E_MESH_URL}/validar-bland-altman`, {
    headers: { "X-Desenho": "B" },
    data: { pares: pares.map((p) => ({ medida: p.medida, referencia_mm: p.referencia_mm, medido_mm: p.medido_mm, torso: p.torso, operador: p.operador })), limite_mm: 2.0 },
  });
  expect(r.status()).toBe(200);
  return r.json();
}

test("Marcos 0 e 1: escala contra o gabarito e Bland-Altman de cliques com jitter", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desenho-B", "medição automática só existe no desenho B");
  test.setTimeout(30 * 60_000);
  const inicio = Date.now();
  await page.goto("/");
  await novoAtendimento(page);

  const marco0: Array<Record<string, unknown>> = [];
  const pares: Par[] = [];
  const vistasUsadas: Record<string, Record<string, NomeVista>> = {};
  const mmPorPx: number[] = [];

  for (const torso of TORSOS) {
    const gab = lerGabarito(torso);
    const caixa = caixaObj(join(dataDirE2E(), "sinteticos", torso, "torso.obj"));
    const esperado = [0, 1, 2].map((i) => caixa.max[i]! - caixa.min[i]!) as V3;

    // ---------------- Marco 0a: GLB do gerador aberto direto no viewer (sem escala na carga)
    await test.step(`${torso}: GLB do gerador, caixa na tela`, async () => {
      await page.getByRole("button", { name: torso, exact: true }).click();
      await expect(page.getByTestId("caixa-mm")).toContainText("GLB");
      await expect.poll(async () => Math.max(...(await dimensoesNaTela(page)).map((d, i) => Math.abs(d - esperado[i]!)))).toBeLessThanOrEqual(0.06);
    });

    // ---------------- Marco 0b: malha processada pelo serviço + landmarks do gabarito
    let erroCaixaProcessada = 0;
    let erroMax = 0;
    const erros: Record<string, { euclidiana: number; geodesica: number }> = {};
    await test.step(`${torso}: processado pelo serviço, distâncias do app × gabarito`, async () => {
      await importarTorso(page, torso);
      const naTela = await dimensoesNaTela(page);
      erroCaixaProcessada = Math.max(...naTela.map((d, i) => Math.abs(d - esperado[i]!)));
      expect(erroCaixaProcessada, `caixa processada ${naTela} × torso.obj ${esperado}`).toBeLessThanOrEqual(1);
      await page.getByTestId("aplicar-gabarito").click();
      const med = await medirNoServico(page);
      for (const id of DISTS) {
        const g = gab.distancias[id]!;
        const m = med.distancias[id];
        const e = { euclidiana: m.euclidiana_mm - g.euclidiana_mm, geodesica: m.geodesica_mm - g.geodesica_mm };
        erros[id] = e;
        erroMax = Math.max(erroMax, Math.abs(e.euclidiana), Math.abs(e.geodesica));
        // a tabela da UI mostra a euclidiana calculada NO CLIENTE (1 casa) = a conferida pelo serviço
        const celula = await page.getByTestId(`distancia-${id}`).locator("td").nth(1).innerText();
        expect(Math.abs(Number(celula.replace(",", ".")) - m.euclidiana_mm)).toBeLessThanOrEqual(0.051);
      }
      expect(erroMax, JSON.stringify(erros)).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("volume-dir")).toContainText("±");
    });
    console.log(`[validacao] ${torso}: marco 0 ok (erro máx ${erroMax.toFixed(3)} mm, caixa ${erroCaixaProcessada.toFixed(3)} mm)`);
    marco0.push({ torso, caixa_obj_mm: esperado.map((v) => +v.toFixed(2)), erro_caixa_processada_mm: +erroCaixaProcessada.toFixed(3), erro_max_distancias_mm: +erroMax.toFixed(3), erros });

    // ---------------- Marco 1: cliques com jitter
    await test.step(`${torso}: cliques com jitter ±${JITTER_PX} px`, async () => {
      vistasUsadas[torso] = {};
      for (const id of LANDMARKS) {
        const mv = await melhorVista(page, gab.landmarks[id].posicao);
        vistasUsadas[torso]![id] = mv.vista;
        await escolherVista(page, mv.vista);
        mmPorPx.push((await projetar(page, gab.landmarks[id].posicao)).mm_por_px);
      }
      for (let rep = 0; rep < REPETICOES; rep++) {
        await page.getByRole("button", { name: "Limpar landmarks" }).click();
        const rng = prng(1000 * (TORSOS.indexOf(torso) + 1) + rep);
        for (const id of LANDMARKS) await clicarLandmark(page, id, gab.landmarks[id].posicao, vistasUsadas[torso]![id]!, rng, JITTER_PX);
        const med = await medirNoServico(page);
        console.log(`[validacao] ${torso}: repetição ${rep + 1} medida`);
        for (const id of DISTS) {
          const g = gab.distancias[id]!;
          const m = med.distancias[id];
          for (const tipo of ["euclidiana", "geodesica"] as const) {
            pares.push({ medida: `${id}:${tipo}`, distancia: id, tipo, referencia_mm: g[`${tipo}_mm`], medido_mm: m[`${tipo}_mm`], torso, operador: `simulado_${rep + 1}` });
          }
        }
      }
    });
  }

  // ---------------- Bland-Altman (módulo do services/mesh)
  const geral = await blandAltman(page, pares);
  const nimf = await blandAltman(page, pares.filter((p) => p.distancia.startsWith("n_imf")));
  const semNimf = await blandAltman(page, pares.filter((p) => !p.distancia.startsWith("n_imf")));
  const euclid = await blandAltman(page, pares.filter((p) => p.tipo === "euclidiana"));
  const geod = await blandAltman(page, pares.filter((p) => p.tipo === "geodesica"));

  const erroMax0 = Math.max(...marco0.map((m) => Math.max(m.erro_max_distancias_mm as number, m.erro_caixa_processada_mm as number)));
  const resultado = {
    esquema: "validacao_componente/web-marcos-0-1",
    versao_software: VERSAO,
    data: new Date().toISOString().slice(0, 10),
    commit_base: execSync("git rev-parse --short HEAD", { cwd: RAIZ }).toString().trim(),
    ambiente: { os: process.platform, node: process.version, navegador: `chromium ${browser.version()}`, viewport: "1920x1080", webgl: "SwiftShader (headless)" },
    parametros: {
      torsos: [...TORSOS],
      decimacao_alvo_vertices: 40000,
      geodesica: "mmp (services/mesh, a partir da posicao exata)",
      jitter_px: JITTER_PX,
      repeticoes: REPETICOES,
      mm_por_px: { min: +Math.min(...mmPorPx).toFixed(3), max: +Math.max(...mmPorPx).toFixed(3) },
      vistas: vistasUsadas,
    },
    marco0: { erro_max_mm: +erroMax0.toFixed(3), criterio_1mm: erroMax0 <= 1, por_torso: marco0 },
    marco1: { bland_altman_geral: geral, n_imf: nimf, sem_n_imf: semNimf, euclidiana: euclid, geodesica: geod, criterio_2mm: !!geral.dentro_de_2mm },
    pares,
    duracao_s: Math.round((Date.now() - inicio) / 1000),
  };
  escreverRelatorio(resultado);

  expect(resultado.marco0.criterio_1mm).toBe(true);
  expect(pares.length).toBeGreaterThanOrEqual(30);
  expect(geral.loa_inferior_mm).toBeGreaterThanOrEqual(-2);
  expect(geral.loa_superior_mm).toBeLessThanOrEqual(2);
  expect(nimf.n).toBeGreaterThan(0);
});

// ------------------------------------------------------------------------------ relatório
const f = (v: number | null | undefined, c = 2) => (v === null || v === undefined ? "—" : (v >= 0 ? "+" : "") + v.toFixed(c));

function escreverRelatorio(r: any) {
  const ba = (x: any) => `n = ${x.n}; viés = ${f(x.vies_mm, 3)} mm; DP = ${x.dp_mm?.toFixed(3)} mm; LoA 95 % = [${f(x.loa_inferior_mm, 3)}; ${f(x.loa_superior_mm, 3)}] mm; |erro| máx. = ${x.erro_abs_max_mm?.toFixed(3)} mm; dentro de ±2 mm: ${x.dentro_de_2mm ? "sim" : "NÃO"}`;
  const linhasM0 = r.marco0.por_torso
    .map((t: any) => `| ${t.torso} | ${t.caixa_obj_mm.join(" × ")} | ${t.erro_caixa_processada_mm.toFixed(3)} | ${t.erro_max_distancias_mm.toFixed(3)} | ${DISTS.map((d) => `${f(t.erros[d].euclidiana)} / ${f(t.erros[d].geodesica)}`).join(" | ")} |`)
    .join("\n");
  const porMedida = Object.entries(r.marco1.bland_altman_geral.por_medida as Record<string, any>)
    .map(([k, v]) => `| ${k} | ${v.n} | ${f(v.vies_mm, 3)} | ${v.dp_mm?.toFixed(3)} | [${f(v.loa_inferior_mm, 3)}; ${f(v.loa_superior_mm, 3)}] |`)
    .join("\n");
  const status = r.marco0.criterio_1mm && r.marco1.criterio_2mm ? "aprovado" : "reprovado";
  const md = `---
esquema: validacao_componente/web-marcos-0-1
versao_software: ${r.versao_software}
data: ${r.data}
commit_base: ${r.commit_base}
desenho_testado: [B]
ambiente: { os: ${r.ambiente.os}, node: "${r.ambiente.node}", navegador: "${r.ambiente.navegador}", viewport: "${r.ambiente.viewport}", webgl: "${r.ambiente.webgl}" }
parametros: { torsos: [${r.parametros.torsos.join(", ")}], decimacao_alvo_vertices: 40000, geodesica: mmp, jitter_px: ${r.parametros.jitter_px}, repeticoes: ${r.parametros.repeticoes}, operador: simulado, config_tepid: "1.0", config_simulacao: "1.0" }
resultados:
  marco0_erro_max_gabarito_mm: ${r.marco0.erro_max_mm}
  marco0_criterio_1mm: ${r.marco0.criterio_1mm}
  marco1_bland_altman: { n: ${r.marco1.bland_altman_geral.n}, vies_mm: ${r.marco1.bland_altman_geral.vies_mm}, dp_mm: ${r.marco1.bland_altman_geral.dp_mm}, loa_mm: [${r.marco1.bland_altman_geral.loa_inferior_mm}, ${r.marco1.bland_altman_geral.loa_superior_mm}], criterio_2mm: ${r.marco1.criterio_2mm} }
  marco1_n_imf: { n: ${r.marco1.n_imf.n}, vies_mm: ${r.marco1.n_imf.vies_mm}, dp_mm: ${r.marco1.n_imf.dp_mm}, loa_mm: [${r.marco1.n_imf.loa_inferior_mm}, ${r.marco1.n_imf.loa_superior_mm}], dentro_de_2mm: ${r.marco1.n_imf.dentro_de_2mm} }
status: ${status}
---

# Validação do apps/web — Marcos 0 e 1 no stack real (v${r.versao_software})

Registro complementar a \`v${r.versao_software}.md\` e \`v${r.versao_software}-services-mesh.md\`, gerado automaticamente pelo e2e \`apps/web/e2e/validacao.spec.ts\` (Playwright + services/mesh real + Postgres). Só torsos sintéticos paramétricos; nenhum dado de paciente.

## Marco 0 — escala no viewer contra o gabarito (tolerância ±1 mm)

Cada torso é aberto (1) direto do GLB do gerador e (2) pelo caminho de uma malha enviada: \`POST /api/sinteticos/<nome>/importar\` → \`/processar\` real → \`processada.glb\` servido por rota auditada. Na malha processada, os landmarks do gabarito (\`origem: "gabarito"\`, vértice mais próximo calculado no navegador) passam pelo pipeline do app: euclidiana no cliente + \`/api/medidas/medir\` → \`/medir\` (geodésica MMP). Erro = app − gabarito.

| torso | caixa torso.obj (mm) | erro caixa na tela (mm) | erro máx. distâncias (mm) | ${DISTS.join(" | ")} |
|---|---|---|---|${DISTS.map(() => "---").join("|")}|
${linhasM0}

Células: erro euclidiano / erro geodésico (mm). O GLB do gerador aberto direto confere com a caixa do torso.obj a ±0,06 mm (arredondamento da tela).

**Resultado:** erro máximo ${r.marco0.erro_max_mm.toFixed(3)} mm → critério ±1 mm ${r.marco0.criterio_1mm ? "ATINGIDO" : "NÃO ATINGIDO"}.

## Marco 1 — landmarks por clique com jitter, Bland-Altman (tolerância: LoA dentro de ±2 mm)

Operador simulado: para cada landmark escolhe-se, entre as vistas padronizadas do viewer (${"frente, oblíquas, perfis, inferiores"}), a vista em que o ponto do gabarito está visível e o raio é mais perpendicular à pele; o ponto é projetado para pixels com a câmera viva (gancho de teste \`window.__simuladorViewer.projetar\`, só em build de teste) e o clique real do mouse é deslocado por jitter uniforme em [−${r.parametros.jitter_px}, +${r.parametros.jitter_px}] px em x e y (PRNG com semente fixa). O viewer faz o raycast (posição exata + vértice mais próximo), o cliente calcula as euclidianas e o serviço as geodésicas. Escala da tela: ${r.parametros.mm_por_px.min}–${r.parametros.mm_por_px.max} mm/px. ${r.parametros.repeticoes} repetições por torso × 7 distâncias × (euclidiana + geodésica).

- **Geral:** ${ba(r.marco1.bland_altman_geral)}
- **N-IMF (à parte):** ${ba(r.marco1.n_imf)}
- Sem N-IMF: ${ba(r.marco1.sem_n_imf)}
- Só euclidianas: ${ba(r.marco1.euclidiana)}
- Só geodésicas: ${ba(r.marco1.geodesica)}

| medida | n | viés (mm) | DP (mm) | LoA 95 % (mm) |
|---|---|---|---|---|
${porMedida}

**Resultado:** LoA geral [${f(r.marco1.bland_altman_geral.loa_inferior_mm, 3)}; ${f(r.marco1.bland_altman_geral.loa_superior_mm, 3)}] mm → critério ±2 mm ${r.marco1.criterio_2mm ? "ATINGIDO" : "NÃO ATINGIDO"}.

## O que mudou

- apps/web integrado ao services/mesh real (upload → /processar → /reescalar → /medir), sem mock; importação de torso sintético pelo mesmo caminho do upload (ADR 0003 item 9); vistas padronizadas da câmera; landmarks do gabarito para torsos sintéticos.
- \`sharp\` (LGPL-3.0 via libvips) removido da árvore por override do pnpm.

## Como reproduzir

\`\`\`bash
bash scripts/mesh.sh venv && bash scripts/mesh.sh torsos      # torsos em data/sinteticos
bash scripts/db.sh start criar
RELATORIO_VALIDACAO=1 pnpm --filter web test:e2e -- --project=desenho-B e2e/validacao.spec.ts
\`\`\`

Pares brutos: \`v${r.versao_software}-web-marcos-0-1.json\` (${r.pares.length} pares). Duração: ${r.duracao_s} s.

## Desvios e pendências

- O "operador" é simulado (projeção exata do gabarito + jitter de ±1 px): mede o erro do pipeline de clique (raycast, vértice, decimação, geodésica), **não** a variabilidade de um cirurgião humano localizando landmarks anatômicos. O Bland-Altman com operadores humanos continua pendente (depende de sessão com cirurgião).
- WebGL por software (SwiftShader) em Chromium headless; em iPad/desktop com GPU a projeção é a mesma (three.js), mas a latência não foi medida aqui.
- Os landmarks do gabarito ficam na superfície paramétrica exata; o clique cai na malha decimada (erro de corda < 1 mm).
- No Marco 0 as euclidianas dão erro 0,00 por construção (o app recebe as posições exatas do gabarito); o que o Marco 0 verifica de fato é a escala (caixa envolvente na tela × torso.obj, sem nenhum fator na carga) e a geodésica MMP do serviço na malha processada contra a geodésica da malha densa do gabarito.
`;
  const destinos = [join(AQUI, "../test-results/validacao")];
  if (process.env.RELATORIO_VALIDACAO === "1") destinos.push(join(RAIZ, "docs/validacao"));
  for (const d of destinos) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, `v${r.versao_software}-web-marcos-0-1.md`), md);
    writeFileSync(join(d, `v${r.versao_software}-web-marcos-0-1.json`), JSON.stringify(r, null, 2) + "\n");
  }
}
