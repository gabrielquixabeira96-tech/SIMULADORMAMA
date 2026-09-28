/**
 * Modo foto na demonstração sintética (ADR 0018 + ADR 0019), projeto "demo" do playwright.config
 * (o nome termina em demo.spec.ts de propósito: só esse projeto o roda). Toda foto leva, gravado nos
 * pixels, "DEMONSTRAÇÃO — TORSO SINTÉTICO" além do aviso de ilustração; sem luz somada; o antes é
 * a textura do torso sintético.
 */
import { expect, test } from "@playwright/test";
import { IMPLANTE_1, IMPLANTE_2, esperarFotos, estadoFotos, prepararSimulacao } from "./simulacao-apoio";

test.use({ viewport: { width: 1600, height: 1000 } });

test("demo: fotos com o selo da demonstração nos pixels e a faixa de incerteza", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  const e = await estadoFotos(page);
  expect(e).toMatchObject({ luzes: 0, preserveDrawingBuffer: false, envelope_visivel: true });
  expect(e.selo).toEqual(["ILUSTRAÇÃO — NÃO É PREVISÃO DE RESULTADO", expect.stringContaining("faixa ±4,5 mm"), "DEMONSTRAÇÃO — TORSO SINTÉTICO"]);
  // a faixa do selo da demo tem 3 linhas: é mais alta que a de 2 linhas (conferida pela cor sólida)
  const faixa = await page.evaluate(() => {
    const im = (window as any).__simuladorSim.fotos.imagem("frente", "a");
    let linhas = 0;
    for (let y = im.altura - 1; y >= 0; y--) {
      let solidos = 0;
      for (let x = 0; x < im.largura; x++) {
        const i = 4 * (y * im.largura + x);
        if (Math.abs(im.dados[i] - 0x1c) + Math.abs(im.dados[i + 1] - 0x21) + Math.abs(im.dados[i + 2] - 0x28) < 6) solidos++;
      }
      if (solidos < im.largura * 0.3) break;
      linhas++;
    }
    return { linhas, altura: im.altura };
  });
  expect(faixa.linhas / faixa.altura).toBeGreaterThan(0.105); // 2 linhas ≈ 8,8 %; 3 linhas ≈ 12 %
  await page.getByTestId("foto-estado-b").click();
  await esperarFotos(page, { estado: "b" });
  await expect(page.getByTestId("foto-legenda")).toContainText("±4,5 mm");
});
