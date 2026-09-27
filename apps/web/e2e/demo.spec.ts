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
import { expect, test } from "@playwright/test";
import { importarTorso, lerGabarito, medirNoServico, novoAtendimento } from "./apoio";

const TOKEN = process.env.E2E_APP_TOKEN!;
const PUBLICO = process.env.E2E_HOST_PUBLICO_DEMO!;
const FAIXA = "DEMONSTRAÇÃO — dados sintéticos, não é previsão clínica";
const TORSO = "t01_simetrico_300";

test.use({ viewport: { width: 1920, height: 1080 } });

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
  await page.getByTestId("relatorio-gerar").click();
  await expect(page.getByTestId("relatorio-conteudo")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("faixa-demo")).toBeInViewport();
});
