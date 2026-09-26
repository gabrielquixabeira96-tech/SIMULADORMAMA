/**
 * E2E do fluxo INTEIRO (critério do Marco 2b), contra o stack real (services/mesh + Next.js +
 * Postgres; LLM em modo mock), nos desenhos A e B:
 *   upload OBJ → /processar → régua → landmarks → medidas (B: calculadas; A: digitadas) → TEPID →
 *   implante + simulação com envelope → anamnese → relatório → PDF gerado e BAIXADO.
 * O texto do PDF baixado é extraído (pdfjs-dist) e conferido: versão, parâmetros, simulações
 * mostradas, aviso fixo e placeholder de assinatura ICP-Brasil. Em A, nenhum número calculado
 * (distâncias, volumes, previstos da simulação) aparece no relatório nem no PDF.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LANDMARKS, dataDirE2E } from "./apoio";
import { RAIZ, preencherTepid, uploadCalibrarMarcar, valoresTepid } from "./fluxo-apoio";
import { IMPLANTE_1, IMPLANTE_2, escolherImplante, esperarQuadro, estadoSim } from "./simulacao-apoio";

test.use({ viewport: { width: 1920, height: 1080 } });

const VERSAO = readFileSync(join(RAIZ, "VERSION"), "utf8").trim();
const PROIBIDO = /compartilh|share|exportar|instagram|whatsapp|facebook|tiktok|redes sociais/i;
const AVISO = "Ilustração, não previsão de resultado";

async function textoPdf(bytes: Uint8Array): Promise<{ texto: string; paginas: number; links: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const req = createRequire(import.meta.url);
  const standardFontDataUrl = `${resolve(dirname(req.resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, standardFontDataUrl });
  const doc = await tarefa.promise;
  const partes: string[] = [];
  let links = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    for (const it of (await pg.getTextContent()).items) if ("str" in it) partes.push(it.str);
    links += (await pg.getAnnotations()).length;
  }
  const paginas = doc.numPages;
  await tarefa.destroy();
  return { texto: partes.join(" ").replace(/\s+/g, " "), paginas, links };
}

/** Representações de um número como o relatório/PDF escreveriam (vírgula decimal). */
const formas = (v: number) => [...new Set([String(Number(v.toFixed(2))), v.toFixed(1), v.toFixed(2)].map((s) => s.replace(".", ",")))];

async function semCompartilhar(page: Page) {
  await expect(page.getByRole("button", { name: PROIBIDO })).toHaveCount(0);
  await expect(page.getByRole("link", { name: PROIBIDO })).toHaveCount(0);
}

async function fluxoAteOPdf(page: Page, desenho: "A" | "B") {
  const chamadasMedir: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/medidas/medir")) chamadasMedir.push(r.url());
  });

  // 1–3) upload → processar → régua → os 10 landmarks por clique (a simulação exige a base)
  await uploadCalibrarMarcar(page, LANDMARKS);
  const pseudonimo = await page.getByTestId("pseudonimo").innerText();

  // 4) medidas
  if (desenho === "B") {
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/medidas/medir"));
    await page.getByRole("button", { name: "Medir geodésicas e volume" }).click();
    expect((await resp).status()).toBe(200);
    await expect(page.getByTestId("volume-dir")).toContainText("±");
  } else {
    await expect(page.getByRole("button", { name: "Medir geodésicas e volume" })).toHaveCount(0);
    for (const id of ["distancias-painel", "volume-painel"]) await expect(page.getByTestId(id)).toHaveCount(0);
  }

  // 5) TEPID digitado (validado, gravado) e registro de medidas (A: só digitadas)
  await preencherTepid(page, valoresTepid(true));
  await page.getByRole("button", { name: desenho === "B" ? "Validar e avaliar alertas" : "Validar medidas" }).click();
  if (desenho === "B") await expect(page.getByTestId("tepid-alertas").locator("li.alerta")).not.toHaveCount(0);
  else await expect(page.getByTestId("tepid-alertas")).toHaveCount(0);
  await page.getByRole("button", { name: "Gravar TEPID do paciente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "TEPID gravado." })).toBeVisible();
  await page.getByRole("button", { name: "Gravar registro de medidas" }).click();
  const gravado = page.getByRole("status").filter({ hasText: "Registro de medidas gravado" });
  await expect(gravado).toBeVisible({ timeout: 120_000 });
  const medidaId = (await gravado.innerText()).match(/\(([0-9a-f-]{36})\)/)![1]!;
  const registro = await (await page.request.get(`/api/medidas/${medidaId}`)).json();
  expect(registro.desenho).toBe(desenho);
  const malhaId: string = registro.malha_id;

  // 6) dois implantes escolhidos à mão + simulação com envelope; plano e IMF trocados (3 combinações mostradas)
  await escolherImplante(page, 1, IMPLANTE_1);
  await escolherImplante(page, 2, IMPLANTE_2);
  await page.getByTestId("gerar-simulacao").click();
  await expect(page.getByTestId("simulacao-pronta")).toBeVisible({ timeout: 240_000 });
  await esperarQuadro(page);
  await expect(page.getByTestId("simulacao-paineis")).toHaveAttribute("data-n", "2");
  await expect(page.getByTestId("selo-nao-calibrado")).toBeVisible();
  for (const [plano, imf] of [["subglandular", "manter"], ["dual_plane", "manter"], ["dual_plane", "rebaixar"]] as const) {
    await page.getByTestId(`plano-${plano}`).check();
    await page.getByTestId(`imf-${imf}`).check();
    await esperarQuadro(page);
    const est = await estadoSim(page);
    for (const k of ["i1", "i2"]) {
      expect(est[k]).toMatchObject({ plano, imf, envelope_mm: 4.5, envelope_visivel: true, pele_visivel: true });
      await expect(page.getByTestId(`envelope-legenda-${k}`)).toContainText("±4,5 mm");
    }
  }
  await expect.poll(async () => (await (await page.request.get(`/api/malhas/${malhaId}/simulacoes`)).json()).simulacoes.length).toBeGreaterThanOrEqual(6);
  if (desenho === "B") await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0); // comparação: previsto só com 1 painel
  await page.getByTestId("comparar").uncheck();
  await page.getByTestId("mostrar-implante-1").check();
  await esperarQuadro(page);
  if (desenho === "B") await expect(page.getByTestId("previsto-simulacao")).toBeVisible();
  else await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0);

  // 7) anamnese (mock determinístico; texto com dado pessoal que deve ser removido)
  await page.getByTestId("anamnese-texto").fill("Paciente deseja aumento moderado, nunca fumou, duas gestações, amamentou. CPF 123.456.789-09, tel (65) 99999-8888.");
  await page.getByTestId("anamnese-enviar").click();
  await expect(page.getByTestId("anamnese-resultado")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("painel-anamnese")).not.toContainText("123.456.789-09");

  // 8) relatório
  await page.getByTestId("relatorio-gerar").click();
  await expect(page.getByTestId("relatorio-conteudo")).toBeVisible({ timeout: 60_000 });
  const relatorio = page.getByTestId("painel-relatorio");
  await expect(relatorio).toContainText(AVISO);
  if (desenho === "B") await expect(page.getByTestId("relatorio-numero-calculado").first()).toBeVisible();
  else await expect(page.getByTestId("relatorio-numero-calculado")).toHaveCount(0);

  // 9) PDF gerado e BAIXADO
  await page.getByTestId("relatorio-pdf-gerar").click();
  await expect(page.getByTestId("relatorio-pdf-baixar")).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("relatorio-pdf-baixar").click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const pdf = await textoPdf(bytes);

  // conteúdo obrigatório do PDF
  expect(pdf.links).toBe(0); // sem links/anotações (nada de compartilhamento)
  expect(pdf.texto).toContain(`Versão do software: ${VERSAO}`);
  expect(pdf.texto).toContain(AVISO);
  expect(pdf.texto).toContain("Assinatura digital ICP-Brasil");
  expect(pdf.texto).toContain("Parâmetros");
  expect(pdf.texto).toMatch(new RegExp(`Desenho: [^•]*${desenho}`));
  expect(pdf.texto).toContain("Envelope de incerteza da superfície simulada: ±4,5 mm");
  expect(pdf.texto).toContain("COEFICIENTES NÃO CALIBRADOS");
  expect(pdf.texto).toContain(`[${IMPLANTE_1}]`);
  expect(pdf.texto).toContain("Simulações mostradas");
  for (const trecho of ["plano: subglandular", "plano: dual plane (plano duplo)", "IMF: rebaixar o sulco inframamário", "IMF: manter o sulco inframamário"]) expect(pdf.texto).toContain(trecho);
  expect(pdf.texto).toContain(pseudonimo);
  expect(pdf.texto).not.toMatch(/123\.456\.789-09|99999-8888/);

  // números calculados: presentes em B, ausentes em A (relatório e PDF)
  const manifest = JSON.parse(readFileSync(join(dataDirE2E(), "pacientes", pseudonimo, "malhas", malhaId, "morphs", "manifest.json"), "utf8"));
  const previstos: number[] = manifest.arquivos.flatMap((a: any) => a.targets.flatMap((t: any) => Object.values(t.previsto).flatMap((pl: any) => [pl.dir, pl.esq])));
  let calculados: number[];
  if (desenho === "B") {
    const d = registro.distancias;
    calculados = [d.intermamilar.euclidiana_mm, d.intermamilar.geodesica_mm, registro.volumes.dir.valor_ml];
    for (const v of calculados) expect(formas(v).some((f) => pdf.texto.includes(f)), `B: ${v} no PDF`).toBe(true);
  } else {
    // o que o modelo teria calculado para os mesmos landmarks (perguntado direto ao serviço, em B)
    const med = await (
      await page.request.post(`${process.env.E2E_MESH_URL}/medir`, {
        headers: { "X-Desenho": "B" },
        data: { malha_dir: `pacientes/${pseudonimo}/malhas/${malhaId}`, landmarks: registro.landmarks, distancias_euclidianas_web: {}, incluir_geodesica: true, incluir_volume: true },
      })
    ).json();
    calculados = [
      ...Object.values(med.distancias as Record<string, { euclidiana_mm: number; geodesica_mm: number } | null>).flatMap((x) => (x ? [x.euclidiana_mm, x.geodesica_mm] : [])),
      ...Object.values(med.volumes as Record<string, { valor_ml: number; incerteza_ml: number } | null>).flatMap((x) => (x ? [x.valor_ml, x.incerteza_ml] : [])),
      ...previstos,
    ].filter((v) => Math.abs(v) >= 5 && !Number.isInteger(Number(v.toFixed(1))));
    expect(calculados.length).toBeGreaterThan(10);
    const textoRelatorio = await relatorio.innerText();
    for (const v of calculados) {
      for (const f of formas(v)) {
        expect(pdf.texto.includes(f), `A: número calculado ${f} no PDF`).toBe(false);
        expect(textoRelatorio.includes(f), `A: número calculado ${f} no relatório`).toBe(false);
      }
    }
    expect(pdf.texto).not.toContain("(calculadas)");
    expect(pdf.texto).not.toContain("(calculado)");
    expect(chamadasMedir).toEqual([]);
  }

  // sem compartilhar/exportar para redes em nenhum ponto da tela
  await semCompartilhar(page);
  return { pdf, medidaId, malhaId };
}

test("fluxo completo do upload ao PDF — desenho B", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "desenho B");
  test.setTimeout(12 * 60_000);
  await fluxoAteOPdf(page, "B");
});

test("fluxo completo do upload ao PDF — desenho A (nada calculado no relatório nem no PDF)", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-A", "desenho A");
  test.setTimeout(12 * 60_000);
  await fluxoAteOPdf(page, "A");
});
