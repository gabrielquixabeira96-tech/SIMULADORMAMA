import { expect, request as novoRequest, test } from "@playwright/test";
import { abrirAvancado } from "./apoio";

/**
 * Revisão v0.1.1 contra o servidor REAL (next start):
 *  - item 1: proxy — token local obrigatório, cookie via ?token=, POST de outra origem / text/plain recusado;
 *  - item 13: CSP, HSTS e Permissions-Policy presentes, e o viewer (R3F/three.js) e o Next funcionam
 *    sem nenhuma violação de CSP.
 */
const TOKEN = process.env.E2E_APP_TOKEN!;

test("cabeçalhos de segurança nas páginas e na API", async ({ request }) => {
  const pagina = await request.get("/");
  expect(pagina.status()).toBe(200);
  const h = pagina.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).not.toContain("unsafe-eval"); // só em next dev
  expect(h["strict-transport-security"]).toMatch(/max-age=\d+/);
  expect(h["permissions-policy"]).toContain("camera=()");
  const api = (await request.get("/api/config")).headers();
  expect(api["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
  expect(api["cache-control"]).toBe("private, no-store");
});

test("R3F e Next funcionam sob a CSP: viewer abre GLB e OBJ sem violação", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
  });
  const erros: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) erros.push(m.text());
  });
  await page.goto("/");
  await abrirAvancado(page);
  await page.getByRole("button", { name: "e2e_tetra_mm" }).click();
  await expect(page.getByTestId("caixa-mm")).toContainText("100,0 × 100,0 × 100,0 mm");
  await expect(page.getByTestId("viewer").locator("canvas")).toBeVisible();
  // hidratação do React (cliques respondem) e WebGL ativo
  expect(await page.getByTestId("viewer").locator("canvas").evaluate((c: HTMLCanvasElement) => !!(c.getContext("webgl2") || c.getContext("webgl")))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  expect(erros).toEqual([]);
});

test("proxy: sem token → 401; com ?token= grava cookie HttpOnly e a página funciona", async ({ browser, baseURL }) => {
  // contexto SEM o cabeçalho Authorization do playwright.config
  // (o runner aplica o `use` do config em newContext: sobrescreve o cabeçalho com vazio)
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: {} });
  const semToken = await ctx.request.get("/api/config");
  expect(semToken.status()).toBe(401);
  expect((await semToken.json()).erro.codigo).toBe("nao_autenticado");
  const page = await ctx.newPage();
  const r = await page.goto(`/?token=${TOKEN}`);
  expect(r!.status()).toBe(200);
  expect(new URL(page.url()).searchParams.get("token")).toBeNull(); // token sai da URL
  const cookie = (await ctx.cookies()).find((c) => c.name === "simulador_token")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  await expect(page.getByTestId("aviso-fixo")).toBeVisible();
  // fetch da própria página (mesma origem, cookie) cria paciente
  const status = await page.evaluate(async () => (await fetch("/api/pacientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
  expect(status).toBe(201);
  await ctx.close();
});

test("proxy: navegação sem token → 401 com página de acesso legível (HTML), sem versão nem código interno", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: {} });
  const page = await ctx.newPage();
  const r = await page.goto("/");
  expect(r!.status()).toBe(401);
  expect(r!.headers()["content-type"]).toMatch(/^text\/html/);
  await expect(page.getByRole("heading", { name: "Acesso" })).toBeVisible();
  await expect(page.locator("body")).toContainText("link enviado pelo administrador");
  const html = await r!.text();
  expect(html).not.toMatch(/nao_autenticado|APP_TOKEN|\d+\.\d+\.\d+/);
  // API sem token: 401 JSON como sempre
  const api = await ctx.request.get("/api/config", { headers: { Accept: "text/html" } });
  expect(api.status()).toBe(401);
  expect((await api.json()).erro.codigo).toBe("nao_autenticado");
  await ctx.close();
});

test("ícone do app: /icon.svg 200 e <link rel=icon> na página", async ({ page, request }) => {
  const r = await request.get("/icon.svg");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("image/svg+xml");
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon\.svg/);
});

test("proxy: POST de outra origem ou text/plain é recusado (CSRF), host estranho também", async ({ baseURL }) => {
  const api = await novoRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` } });
  const origemAlheia = await api.post("/api/pacientes", { headers: { "Content-Type": "text/plain", Origin: "http://evil.example" }, data: "{}" });
  expect(origemAlheia.status()).toBe(415);
  const jsonAlheio = await api.post("/api/pacientes", { headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, data: {} });
  expect(jsonAlheio.status()).toBe(403);
  expect((await jsonAlheio.json()).erro.codigo).toBe("origem_nao_permitida");
  const host = await api.get("/api/config", { headers: { Host: "evil.example" } });
  expect(host.status()).toBe(403);
  await api.dispose();
  // sem token nenhum, o text/plain cross-origin do revisor volta 401 (não 201)
  const anonimo = await novoRequest.newContext({ baseURL, extraHTTPHeaders: {} });
  const r = await anonimo.post("/api/pacientes", { headers: { "Content-Type": "text/plain", Origin: "http://evil.example" }, data: "{}" });
  expect(r.status()).toBe(401);
  await anonimo.dispose();
});
