import { resolve } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { abrirAvancado } from "./apoio";
import { MTL, OBJ_TETRAEDRO } from "./fixtures";

/**
 * Viewer em mm sem escala na carga (ADR 0010): um tetraedro sintético de 100 mm deve aparecer
 * com caixa envolvente 100 × 100 × 100 mm, seja GLB (servidor) ou OBJ+MTL local.
 */
test("GLB sintético em mm abre com escala correta e aceita clique de landmark", async ({ page }, info) => {
  await page.goto("/");
  await abrirAvancado(page);
  await page.getByRole("button", { name: "e2e_tetra_mm" }).click();
  await expect(page.getByTestId("caixa-mm")).toContainText("100,0 × 100,0 × 100,0 mm");
  await expect(page.getByTestId("caixa-mm")).toContainText("GLB");
  // a marcação de pontos já vem ativa na pré-visualização
  await expect(page.getByRole("button", { name: "Marcar pontos", exact: true })).toHaveAttribute("aria-pressed", "true");
  const canvas = page.getByTestId("viewer").locator("canvas");
  const guia = page.getByTestId("landmarks-guia");
  // o canvas nasce 300×150 e só depois o R3F o redimensiona: a caixa é medida a cada tentativa.
  // câmera olha de +Z para o centro da caixa; um pouco abaixo e à esquerda do centro da tela
  // o raio atinge a face inclinada x+y+z=100 do tetraedro (longe das arestas)
  await expect(async () => {
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
    await expect(guia).toContainText(/Fúrcula \(SSN\) \*\s*✓/, { timeout: 800 });
  }).toPass({ timeout: 10_000 });
  if (info.project.name.endsWith("B")) {
    await expect(page.getByTestId("distancias-painel")).toBeVisible();
  } else {
    await expect(page.getByTestId("distancias-painel")).toHaveCount(0);
  }
});

test("GLB sem unidade mm é recusado pelo carregador", async ({ page }) => {
  await page.goto("/");
  await abrirAvancado(page);
  await page.getByRole("button", { name: "e2e_tetra_metros" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "GLB recusado" })).toContainText("unidade");
  await expect(page.getByTestId("caixa-mm")).toHaveCount(0);
});

test("OBJ + MTL locais abrem em mm (pré-visualização)", async ({ page }) => {
  const dir = mkdtempSync(resolve(tmpdir(), "obj-e2e-"));
  writeFileSync(resolve(dir, "torso.obj"), OBJ_TETRAEDRO);
  writeFileSync(resolve(dir, "torso.mtl"), MTL);
  await page.goto("/");
  await abrirAvancado(page);
  await page.getByTestId("arquivos-locais").setInputFiles([resolve(dir, "torso.obj"), resolve(dir, "torso.mtl")]);
  await page.getByRole("button", { name: "Abrir no viewer" }).click();
  await expect(page.getByTestId("caixa-mm")).toContainText("100,0 × 100,0 × 100,0 mm");
  await expect(page.getByTestId("caixa-mm")).toContainText("OBJ");
});
