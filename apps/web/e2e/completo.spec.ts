/**
 * E2E do fluxo INTEIRO (critério do Marco 2b), contra o stack real (services/mesh + Next.js +
 * Postgres; LLM em modo mock), nos desenhos A e B:
 *   upload OBJ → /processar → régua → landmarks → medidas (B: calculadas; A: digitadas) → TEPID →
 *   implante + simulação com envelope (fotos A/B e aba 3D) → anamnese → relatório → PDF gerado e BAIXADO.
 * O texto do PDF baixado é extraído (pdfjs-dist) e conferido: versão, parâmetros, simulações
 * mostradas, aviso fixo e placeholder de assinatura ICP-Brasil. Em A, TODO número do relatório e do PDF
 * pertence a uma lista de PERMITIDOS (digitados, catálogo, constantes declaradas; ADR 0005 item 4).
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LANDMARKS, dataDirE2E } from "./apoio";
import { RAIZ, preencherTepid, uploadCalibrarMarcar, valoresTepid } from "./fluxo-apoio";
import { IMPLANTE_1, IMPLANTE_2, abrirExplorar3D, escolherImplante, esperarFotos, esperarQuadro, estadoFotos, estadoSim } from "./simulacao-apoio";

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

/** Implantes do catálogo por id (config/catalogo/*.json). */
function implanteDoCatalogo(id: string): Record<string, unknown> {
  for (const f of readdirSync(join(RAIZ, "config/catalogo")).filter((n) => n.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(join(RAIZ, "config/catalogo", f), "utf8"));
    const i = (c.implantes ?? []).find((x: { id: string }) => x.id === id);
    if (i) return i;
  }
  throw new Error(`implante ${id} fora do catálogo`);
}

const valorPtBr = (s: string): number => (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(",", ".")));

interface Permitidos {
  /** valores numéricos aceitos (digitados + catálogo + constantes numéricas) */
  valores: Set<number>;
  /** trechos com dígitos aceitos por inteiro (identificadores e constantes declaradas) */
  padroes: RegExp[];
}

/**
 * Lista de PERMITIDOS do desenho A (ADR 0005 item 4): (1) medidas DIGITADAS no TEPID; (2) dados do
 * CATÁLOGO dos implantes escolhidos; (3) constantes declaradas: versão do software, versões das
 * configs, envelope de incerteza, datas/horas do documento e identificadores (UUID, pseudônimo,
 * SHA-256), além de números de página.
 */
function listaDePermitidos(c: { pseudonimo: string; versao: string }): Permitidos {
  const valores = new Set<number>();
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) valores.add(Number(v.toFixed(2)));
  };
  for (const l of Object.values(valoresTepid(true))) [l.dir, l.esq].forEach(add);
  for (const id of [IMPLANTE_1, IMPLANTE_2]) {
    const i = implanteDoCatalogo(id);
    for (const [k, v] of Object.entries(i)) {
      if (typeof v === "number") add(v);
      else if (typeof v === "string" && ["id", "modelo", "referencia_fabricante", "fabricante", "linha"].includes(k)) for (const m of v.match(/\d+(?:[.,]\d+)?/g) ?? []) add(valorPtBr(m));
    }
  }
  const sim = JSON.parse(readFileSync(join(RAIZ, "config/simulacao.json"), "utf8"));
  const tepid = JSON.parse(readFileSync(join(RAIZ, "config/tepid.json"), "utf8"));
  add(sim.incerteza.envelope_rms_mm.valor);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const padroes = [
    new RegExp(esc(c.pseudonimo), "g"),
    /SHA-256(?:\s+[0-9a-f]{12,64}…?)?/gi, // rótulo do hash do PDF (+ prefixo exibido na tela, mesmo que só dígitos)
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, // UUID de atendimento/relatório/implante
    /\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,64}\b/gi, // SHA-256 (ou prefixo) do PDF: hex com ao menos uma letra
    /\b\d{2}\/\d{2}\/\d{4}(?:,? (?:às )?\d{2}:\d{2}(?::\d{2})?)?/g, // data/hora do documento
    /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)?)?/g,
    /\b\d{2}:\d{2}(?::\d{2})?\b/g,
    new RegExp(`\\b${esc(c.versao)}\\b`, "g"), // versão do software
    new RegExp(`versão ${esc(sim.versao)}\\b`, "g"), // versões das configs
    new RegExp(`config\\. simulação ${esc(sim.versao)}\\b`, "g"), // versão da config em cada simulação mostrada (PDF)
    new RegExp(`versão ${esc(tepid.versao)}\\b`, "g"),
    /[Pp]ágina \d+ de \d+/g,
  ];
  return { valores, padroes };
}

/** Trechos numéricos do texto que NÃO estão na lista de permitidos. */
function numerosForaDaLista(texto: string, p: Permitidos): string[] {
  let t = texto.normalize("NFKC");
  for (const re of p.padroes) t = t.replace(re, " ");
  const fora: string[] = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    if (!p.valores.has(Number(valorPtBr(m[0]).toFixed(2)))) fora.push(`${m[0]} («${t.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 10).trim()}»)`);
  }
  // numeral não ASCII nunca é permitido
  for (const m of t.matchAll(/(?:(?![0-9])\p{N})+/gu)) fora.push(m[0]);
  return fora;
}

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
  await esperarFotos(page, { estado: "a" });
  await expect(page.getByTestId("selo-nao-calibrado")).toBeVisible();
  // comparador de fotos (ADR 0019): A e B lado a lado, mesmo enquadramento, envelope em cada "depois"
  await page.getByTestId("foto-modo-lado").click();
  await esperarFotos(page);
  for (const e of ["antes", "a", "b"]) await expect(page.getByTestId(`foto-lado-${e}`)).toBeVisible();
  for (const [plano, imf] of [["subglandular", "manter"], ["dual_plane", "manter"], ["dual_plane", "rebaixar"]] as const) {
    await page.getByTestId(`plano-${plano}`).check();
    await page.getByTestId(`imf-${imf}`).check();
    await esperarFotos(page);
    expect(await estadoFotos(page)).toMatchObject({ plano, imf, modo: "lado", envelope_mm: 4.5, envelope_visivel: true, pele_visivel: true, luzes: 0 });
    await expect(page.getByTestId("foto-legenda")).toContainText("±4,5 mm");
  }
  await expect.poll(async () => (await (await page.request.get(`/api/malhas/${malhaId}/simulacoes`)).json()).simulacoes.length).toBeGreaterThanOrEqual(6);
  if (desenho === "B") {
    await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0); // comparação: previsto só com um implante mostrado
    await expect(page.getByTestId("foto-diferencas")).toBeVisible();
  } else await expect(page.getByTestId("foto-diferencas")).toHaveCount(0);
  await page.getByTestId("foto-modo-foto").click();
  await esperarFotos(page);
  if (desenho === "B") await expect(page.getByTestId("previsto-simulacao")).toBeVisible();
  else await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0);
  // aba "Explorar 3D": 2 painéis (A e B) com câmeras sincronizadas e o envelope nos dois
  await abrirExplorar3D(page);
  await expect(page.getByTestId("simulacao-paineis")).toHaveAttribute("data-n", "2");
  const est = await estadoSim(page);
  for (const k of ["i1", "i2"]) {
    expect(est[k]).toMatchObject({ plano: "dual_plane", imf: "rebaixar", envelope_mm: 4.5, envelope_visivel: true, pele_visivel: true, luzes: 0 });
    await expect(page.getByTestId(`envelope-legenda-${k}`)).toContainText("±4,5 mm");
  }
  if (desenho === "B") await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0);
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
  const previstos: unknown[] = manifest.arquivos.flatMap((a: any) => a.targets.map((t: any) => t.previsto));
  if (desenho === "B") {
    expect(previstos.every((p) => p !== null)).toBe(true);
    const d = registro.distancias;
    const calculados = [d.intermamilar.euclidiana_mm, d.intermamilar.geodesica_mm, registro.volumes.dir.valor_ml];
    for (const v of calculados) expect(formas(v).some((f) => pdf.texto.includes(f)), `B: ${v} no PDF`).toBe(true);
  } else {
    // o serviço gravou o manifest SEM previsto (X-Desenho: A) e a rota do arquivo também o anula
    expect(previstos.length).toBeGreaterThan(0);
    expect(previstos.every((p) => p === null)).toBe(true);
    const servido = await (await page.request.get(`/api/malhas/${malhaId}/arquivo?nome=morphs/manifest.json`)).json();
    expect(servido.arquivos.flatMap((a: any) => a.targets.map((t: any) => t.previsto)).every((p: unknown) => p === null)).toBe(true);
    // LISTA DE PERMITIDOS (ADR 0005 item 4): todo número do relatório e do PDF pertence aos digitados,
    // ao catálogo dos implantes escolhidos ou às constantes declaradas. Nada de filtrar "proibidos".
    const textoRelatorio = await relatorio.innerText();
    const permitidos = listaDePermitidos({ pseudonimo, versao: VERSAO });
    const foraPdf = numerosForaDaLista(pdf.texto, permitidos);
    const foraRelatorio = numerosForaDaLista(textoRelatorio, permitidos);
    expect(foraPdf, `A: números fora da lista no PDF: ${foraPdf.join(" | ")}`).toEqual([]);
    expect(foraRelatorio, `A: números fora da lista no relatório: ${foraRelatorio.join(" | ")}`).toEqual([]);
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
