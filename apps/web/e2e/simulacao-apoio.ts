/** Apoio aos e2e da simulação (Marco 2; modo foto, ADR 0019). */
import { expect, type Page } from "@playwright/test";
import { importarTorso, novoAtendimento } from "./apoio";

export const IMPLANTE_1 = "motiva-rsd-300";
export const IMPLANTE_2 = "polytech-21631-255";

export async function escolherImplante(page: Page, slot: 1 | 2, id: string) {
  await page.getByTestId(`slot-implante-${slot}`).check();
  // o catálogo pode abrir filtrado pela base medida (desenho B): a busca direta vê todos
  const desligar = page.getByTestId("catalogo-filtro-base-desligar");
  if (await desligar.isVisible()) await desligar.click();
  const busca = page.getByTestId("catalogo-busca");
  await busca.fill(id);
  await page.getByTestId(`catalogo-item-${id}`).getByRole("radio").check();
  await expect(page.getByTestId(`implante-escolhido-${slot}`)).not.toHaveText("—");
  await busca.fill("");
}

/** Atendimento → torso sintético processado → landmarks do gabarito → implantes → morphs → fotos. */
export async function prepararSimulacao(page: Page, implantes: string[], torso = "t01_simetrico_300"): Promise<string> {
  await page.goto("/");
  await novoAtendimento(page);
  const malhaId = await importarTorso(page, torso);
  await page.getByTestId("aplicar-gabarito").click();
  await expect(page.getByTestId("landmarks-guia")).toContainText(/Base lateral esquerda\s*✓/);
  for (const [k, id] of implantes.entries()) await escolherImplante(page, (k + 1) as 1 | 2, id);
  await page.getByTestId("gerar-simulacao").click();
  await expect(page.getByTestId("simulacao-pronta")).toBeVisible({ timeout: 240_000 });
  // a aba "Fotos" abre no "Antes" e anima para o A (a foto sendo editada)
  await esperarFotos(page, { estado: "a" });
  return malhaId;
}

/** Espera o comparador de fotos pintar e ficar ocioso (sem transição, refinamento nem miniaturas). */
export async function esperarFotos(page: Page, o: { estado?: string; versaoMaiorQue?: number } = {}) {
  await expect
    .poll(
      async () =>
        page.evaluate((o) => {
          const f = (window as any).__simuladorSim?.fotos;
          if (!f || f.versao <= (o.versaoMaiorQue ?? 0) || f.ocupado()) return false;
          return !o.estado || f.estado.estado === o.estado;
        }, o),
      { timeout: 60_000, intervals: [50, 100, 200] },
    )
    .toBe(true);
}

export async function estadoFotos(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as any).__simuladorSim.fotos.estado);
}

export async function versaoFotos(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__simuladorSim?.fotos?.versao ?? 0);
}

/** Abre a aba "Explorar 3D" (viewer orbital, slider e comparação em 2 painéis) e espera o 1º quadro. */
export async function abrirExplorar3D(page: Page) {
  await page.getByTestId("aba-explorar-3d").click();
  await expect(page.getByTestId("simulacao-paineis")).toBeVisible();
  await esperarQuadro(page);
}

export async function esperarQuadro(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => Object.keys((window as any).__simuladorSim?.quadros ?? {}).length), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
}

export async function estadoSim(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => {
    const vis = [...document.querySelectorAll('[data-testid^="sim-painel-"]')].map((e) => e.getAttribute("data-testid")!.replace("sim-painel-", ""));
    const est = (window as any).__simuladorSim?.estado ?? {};
    return Object.fromEntries(vis.map((k) => [k, est[k]]));
  });
}
