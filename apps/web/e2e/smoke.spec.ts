import { expect, test } from "@playwright/test";

/**
 * Smoke (Marco 1): a página abre, o aviso fixo está sempre visível, não há compartilhamento,
 * e os painéis calculados só existem em DESENHO=B. O fluxo E2E completo vem no Marco 2b.
 */
const desenhoDo = (nomeProjeto: string) => (nomeProjeto.endsWith("A") ? "A" : "B");

test("página de consulta abre com aviso fixo sempre visível", async ({ page }) => {
  await page.goto("/");
  const aviso = page.getByTestId("aviso-fixo");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Ilustração, não previsão de resultado");
  await page.mouse.wheel(0, 5000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(aviso).toBeInViewport();
  await expect(page.getByTestId("viewer")).toBeVisible();
});

test("sem botão ou link de compartilhar/exportar para redes (Res. CFM 2.336/2023)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("aviso-fixo")).toBeVisible();
  const proibido = /compartilh|share|exportar|instagram|whatsapp|facebook|tiktok|publicar|redes sociais/i;
  await expect(page.getByRole("button", { name: proibido })).toHaveCount(0);
  await expect(page.getByRole("link", { name: proibido })).toHaveCount(0);
  const texto = await page.locator("body").innerText();
  expect(texto).not.toMatch(/compartilhar|share/i);
});

test("recursos calculados conforme o desenho", async ({ page, request }, info) => {
  const desenho = desenhoDo(info.project.name);
  const cfg = await (await request.get("/api/config")).json();
  expect(cfg.desenho).toBe(desenho);
  await page.goto("/");
  await expect(page.getByTestId("tepid-form")).toBeVisible();
  await expect(page.getByTestId("tepid-nota")).toContainText("conferir no texto original");
  for (const id of ["distancias-painel", "volume-painel", "tepid-alertas"]) {
    if (desenho === "A") await expect(page.getByTestId(id)).toHaveCount(0);
    else await expect(page.getByTestId(id)).toBeVisible();
  }
  if (desenho === "A") {
    const r = await request.post("/api/medidas/medir", { data: { malha_id: "c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0", landmarks: {} } });
    expect(r.status()).toBe(403);
    expect((await r.json()).erro.codigo).toBe("desligado_no_desenho_a");
  }
});
