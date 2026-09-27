/**
 * Modo demonstração sintética (ADR 0018) contra o servidor REAL (projeto "demo" do
 * playwright.config: DEMO_SINTETICA=1, desenho B, LLM em mock, banco próprio marcado).
 *  - faixa "DEMONSTRAÇÃO" em todas as páginas (consulta, /benchmark, Bland-Altman, 404);
 *  - upload de malha e anamnese em texto livre → 403 `desligado_na_demo` (API) e ausentes na UI;
 *  - só torsos gerados pelo services/mesh listados (os tetraedros-fixture do e2e somem);
 *  - `?token=` atrás de proxy TLS → 303 para https:// e cookie Secure; sem token → 401;
 *  - fluxo com torso sintético: paciente → importar t01 → landmarks do gabarito → medidas B
 *    (geodésica e volume pelo serviço) → relatório (mock).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { importarTorso, lerGabarito, medirNoServico, novoAtendimento } from "./apoio";

const TOKEN = process.env.E2E_APP_TOKEN!;
const PUBLICO = process.env.E2E_HOST_PUBLICO_DEMO!;
const FAIXA = "DEMONSTRAÇÃO — dados sintéticos, não é previsão clínica";
const TORSO = "t01_simetrico_300";

test.use({ viewport: { width: 1920, height: 1080 } });

/** Texto do PDF por página (pdfjs-dist, só em teste). */
async function textoPorPagina(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const req = createRequire(import.meta.url);
  const standardFontDataUrl = `${resolve(dirname(req.resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, standardFontDataUrl });
  const doc = await tarefa.promise;
  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const partes: string[] = [];
    for (const it of (await (await doc.getPage(i)).getTextContent()).items) if ("str" in it) partes.push(it.str);
    paginas.push(partes.join(" ").replace(/\s+/g, " "));
  }
  await tarefa.destroy();
  return paginas;
}

test("faixa DEMONSTRAÇÃO visível em todas as páginas", async ({ page }) => {
  for (const [caminho, status] of [["/", 200], ["/benchmark", 200], ["/validacao/bland-altman", 200], ["/nao-existe", 404]] as const) {
    const r = await page.goto(caminho);
    expect(r?.status(), caminho).toBe(status);
    await expect(page.getByTestId("faixa-demo"), caminho).toHaveText(FAIXA);
    await expect(page.getByTestId("faixa-demo"), caminho).toBeInViewport();
    await expect(page.getByTestId("aviso-fixo"), caminho).toContainText("Ilustração, não previsão de resultado");
  }
  expect((await (await page.request.get("/api/config")).json()).demo).toBe(true);
});

test("upload de malha e anamnese: 403 desligado_na_demo na API e fora da UI", async ({ page, request, baseURL }) => {
  const up = await request.post("/api/malhas", {
    headers: { Origin: baseURL! },
    multipart: { paciente_id: "00000000-0000-4000-8000-000000000000", unidade_origem: "mm", arquivos: { name: "scan.obj", mimeType: "text/plain", buffer: Buffer.from("v 0 0 0\n") } },
  });
  expect(up.status()).toBe(403);
  expect((await up.json()).erro.codigo).toBe("desligado_na_demo");
  const an = await request.post("/api/llm/anamnese", { headers: { Origin: baseURL! }, data: { paciente_id: "00000000-0000-4000-8000-000000000000", texto: "deseja aumento" } });
  expect(an.status()).toBe(403);
  expect((await an.json()).erro.codigo).toBe("desligado_na_demo");

  await page.goto("/");
  await expect(page.getByTestId("upload-desligado-demo")).toBeVisible();
  await expect(page.getByTestId("upload-arquivos")).toHaveCount(0);
  await expect(page.getByTestId("arquivos-locais")).toHaveCount(0);
  await novoAtendimento(page);
  await expect(page.getByTestId("anamnese-desligada-demo")).toBeVisible();
  await expect(page.getByTestId("anamnese-texto")).toHaveCount(0);
  // só os torsos gerados pelo services/mesh (os tetraedros-fixture não têm parametros.json)
  const nomes = ((await (await request.get("/api/sinteticos")).json()).torsos as { nome: string }[]).map((t) => t.nome);
  expect(nomes).toEqual(["t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose"]);
  expect((await request.get("/api/sinteticos/e2e_tetra_mm/torso.glb")).status()).toBe(404);
});

test("token obrigatório; ?token= atrás de proxy TLS → https:// e cookie Secure", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: {} });
  for (const c of ["/", "/benchmark", "/api/config"]) expect((await ctx.request.get(c)).status(), c).toBe(401);
  // host público permitido, sem token → 401 (não 403: o host é aceito)
  expect((await ctx.request.get("/api/config", { headers: { "X-Forwarded-Host": PUBLICO } })).status()).toBe(401);
  // host encaminhado fora da lista → 403
  expect((await ctx.request.get("/api/config", { headers: { "X-Forwarded-Host": "evil.example" } })).status()).toBe(403);
  const r = await ctx.request.get(`/benchmark?token=${TOKEN}`, { headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": PUBLICO }, maxRedirects: 0 });
  expect(r.status()).toBe(303);
  expect(r.headers()["location"]).toBe(`https://${PUBLICO}/benchmark`);
  const cookie = r.headers()["set-cookie"]!;
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
  await ctx.close();
});

test("fluxo com torso sintético: importar t01 → landmarks do gabarito → medidas B → relatório (mock)", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  const gab = lerGabarito(TORSO);
  await page.goto("/");
  await novoAtendimento(page);
  await importarTorso(page, TORSO);
  await page.getByTestId("aplicar-gabarito").click();
  const med = await medirNoServico(page);
  for (const id of ["ssn_n_dir", "ssn_n_esq", "intermamilar"]) {
    expect(Math.abs(med.distancias[id].euclidiana_mm - gab.distancias[id]!.euclidiana_mm), id).toBeLessThanOrEqual(1);
    expect(Math.abs(med.distancias[id].geodesica_mm - gab.distancias[id]!.geodesica_mm), id).toBeLessThanOrEqual(1);
  }
  await expect(page.getByTestId("volume-dir")).toContainText("±");
  const respRel = page.waitForResponse((r) => r.url().endsWith("/api/relatorio") && r.request().method() === "POST");
  await page.getByTestId("relatorio-gerar").click();
  expect((await (await respRel).json()).relatorio.demo).toBe(true);
  await expect(page.getByTestId("relatorio-conteudo")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("faixa-demo")).toBeInViewport();

  // PDF baixado: faixa DEMONSTRAÇÃO na tarja e no rodapé de TODAS as páginas (texto extraído)
  await page.getByTestId("relatorio-pdf-gerar").click();
  await expect(page.getByTestId("relatorio-pdf-baixar")).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("relatorio-pdf-baixar").click()]);
  const paginas = await textoPorPagina(new Uint8Array(readFileSync((await download.path())!)));
  expect(paginas.length).toBeGreaterThanOrEqual(1);
  paginas.forEach((t, i) => expect(t.split(FAIXA).length - 1, `página ${i + 1}`).toBeGreaterThanOrEqual(i === 0 ? 3 : 2));
});

test("sessão de Bland-Altman na demo: operador OP-NN, marcada demo e sem observação livre", async ({ request, baseURL }) => {
  // R1: na demo o operador é só OP-NN (nem pseudônimo livre)
  const livre = await request.post("/api/validacao/sessoes", { headers: { Origin: baseURL! }, data: { operador: "MARIA-S", torsos: [TORSO] } });
  expect(livre.status()).toBe(422);
  expect((await livre.json()).erro.codigo).toBe("operador_invalido");
  const s = await (await request.post("/api/validacao/sessoes", { headers: { Origin: baseURL! }, data: { operador: "OP-01", torsos: [TORSO] } })).json();
  expect(s.operador).toBe("OP-01");
  const enc = await request.post(`/api/validacao/sessoes/${s.id}/encerrar`, { headers: { Origin: baseURL! }, data: { observacoes: "Fulana de Tal" } });
  expect(enc.status()).toBe(403);
  expect((await enc.json()).erro.codigo).toBe("desligado_na_demo");
  expect((await request.post(`/api/validacao/sessoes/${s.id}/cancelar`, { headers: { Origin: baseURL! }, data: {} })).status()).toBe(200);
  const pl = await (await request.get("/api/validacao/planilha?formato=json")).json();
  expect(pl.demo).toBe(true);
  expect(pl.linhas.every((l: { fonte: string }) => l.fonte.startsWith("demo:"))).toBe(true);
});
