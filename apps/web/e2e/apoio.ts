/**
 * Apoio aos e2e de validação e de fluxo: leitura do gabarito, projeção de pontos 3D para
 * pixels (gancho de teste do viewer) e clique "humano" com jitter nos landmarks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { DEFINICOES_LANDMARKS, LANDMARK_IDS, type LandmarkId } from "../../../packages/contratos/src/landmarks";
import type { NomeVista } from "../src/viewer/vistas";

export type V3 = [number, number, number];
export interface Gabarito {
  landmarks: Record<LandmarkId, { posicao: V3 }>;
  distancias: Record<string, { euclidiana_mm: number; geodesica_mm: number } | null>;
}

export const dataDirE2E = (): string => process.env.E2E_DATA_DIR!;
export const lerGabarito = (torso: string): Gabarito => JSON.parse(readFileSync(join(dataDirE2E(), "sinteticos", torso, "gabarito.json"), "utf8"));

/** Caixa envolvente dos vértices de um OBJ (mm). */
export function caixaObj(caminho: string): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const l of readFileSync(caminho, "utf8").split("\n")) {
    if (!l.startsWith("v ")) continue;
    const c = l.trim().split(/\s+/).slice(1, 4).map(Number);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, c[i]!);
      max[i] = Math.max(max[i]!, c[i]!);
    }
  }
  return { min, max };
}

/** "Caixa envolvente: 330,2 × 450,0 × 251,3 mm" → [330.2, 450, 251.3] (texto em "Avançado", lido mesmo recolhido) */
export async function dimensoesNaTela(page: Page): Promise<V3> {
  const t = ((await page.getByTestId("caixa-mm").textContent()) ?? "").replace(/\./g, "");
  const m = t.match(/([\d,]+) × ([\d,]+) × ([\d,]+) mm/);
  if (!m) throw new Error(`caixa não encontrada em: ${t}`);
  return [m[1], m[2], m[3]].map((s) => Number(s!.replace(",", "."))) as V3;
}

/** PRNG determinístico (mulberry32) para o jitter reprodutível. */
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Projecao {
  x: number;
  y: number;
  visivel: boolean;
  cos: number;
  mm_por_px: number;
}

async function doisQuadros(page: Page) {
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
}

export async function projetar(page: Page, p: V3): Promise<Projecao> {
  const r = await page.evaluate((pp) => {
    const g = (window as unknown as { __simuladorViewer?: { projetar: (x: number[]) => unknown } }).__simuladorViewer;
    return g ? g.projetar(pp) : null;
  }, p);
  if (!r) throw new Error("gancho de teste ausente: rode `pnpm --filter web test:e2e` (build com NEXT_PUBLIC_GANCHOS_TESTE=1)");
  return r as Projecao;
}

export async function escolherVista(page: Page, v: NomeVista) {
  const botao = page.getByTestId(`vista-${v}`);
  // vistas inferiores ficam em "Mais vistas" (recolhido)
  if (!(await botao.isVisible())) await page.getByTestId("mais-vistas").locator("summary").click();
  await botao.click();
  await doisQuadros(page);
}

/** Vista em que o ponto está visível e o raio é mais perpendicular à superfície (avaliada no gancho, sem renderizar). */
export async function melhorVista(page: Page, p: V3): Promise<{ vista: NomeVista; cos: number }> {
  const r = await page.evaluate((pp) => {
    const g = (window as unknown as { __simuladorViewer?: { melhorVista: (x: number[]) => unknown } }).__simuladorViewer;
    return g ? g.melhorVista(pp) : "sem_gancho";
  }, p);
  if (r === "sem_gancho") throw new Error("gancho de teste ausente: rode `pnpm --filter web test:e2e` (build com NEXT_PUBLIC_GANCHOS_TESTE=1)");
  if (!r) throw new Error(`ponto ${JSON.stringify(p)} não visível em nenhuma vista`);
  return r as { vista: NomeVista; cos: number };
}

const rotuloBotao = (id: LandmarkId) => {
  const d = DEFINICOES_LANDMARKS.find((x) => x.id === id)!;
  return `${d.rotulo}${d.obrigatorio ? " *" : ""}`;
};

/**
 * Clica num ponto 3D como um operador: seleciona a vista, projeta o alvo para pixels e clica
 * com jitter uniforme em [−jitterPx, +jitterPx] em x e y. O viewer faz o raycast de verdade.
 */
export async function clicarPonto(page: Page, p: V3, vista: NomeVista, rng: () => number, jitterPx = 1): Promise<{ dx: number; dy: number }> {
  await escolherVista(page, vista);
  const proj = await projetar(page, p);
  const dx = (rng() * 2 - 1) * jitterPx;
  const dy = (rng() * 2 - 1) * jitterPx;
  await page.mouse.click(proj.x + dx, proj.y + dy);
  return { dx, dy };
}

export async function clicarLandmark(page: Page, id: LandmarkId, p: V3, vista: NomeVista, rng: () => number, jitterPx = 1) {
  const guia = page.getByTestId("landmarks-guia");
  await guia.getByRole("button", { name: rotuloBotao(id), exact: true }).click();
  await clicarPonto(page, p, vista, rng, jitterPx);
  await expect(guia.locator("li", { has: page.getByRole("button", { name: rotuloBotao(id), exact: true }) })).toContainText("✓");
}

export const LANDMARKS: readonly LandmarkId[] = LANDMARK_IDS;

export async function novoAtendimento(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Nova simulação|Novo atendimento/ }).click();
  const ps = page.getByTestId("pseudonimo");
  await expect(ps).toHaveText(/^P-[0-9A-HJ-NP-Z]{6}$/);
  return ps.innerText();
}

/**
 * "Usar este torso" (passo 1) → status "Torso <nome> processado". O id da malha não aparece na tela
 * (sem UUID visível): vem do atributo `data-malha-id` da mensagem. A marcação de pontos já fica
 * ativa no passo 2 (o botão "Marcar pontos" é conferido, não clicado).
 */
export async function importarTorso(page: Page, torso: string): Promise<string> {
  // depois de uma captura os cards ficam recolhidos em "Trocar de torso sintético"
  if (!(await page.getByTestId(`importar-${torso}`).isVisible())) await page.getByTestId("torsos-sinteticos").locator("summary").click();
  await page.getByTestId(`importar-${torso}`).click();
  const msg = page.getByRole("status").filter({ hasText: `Torso ${torso} processado` });
  await expect(msg).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("caixa-mm")).toHaveCount(1);
  const malhaId = (await msg.getAttribute("data-malha-id"))!;
  expect(malhaId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Marcar pontos", exact: true })).toHaveAttribute("aria-pressed", "true");
  return malhaId;
}

/** Abre o bloco "Avançado" do passo 1 (pré-visualização, dados técnicos), se ainda fechado. */
export async function abrirAvancado(page: Page) {
  const det = page.getByTestId("avancado-captura");
  if (!(await det.evaluate((d) => (d as HTMLDetailsElement).open))) await det.locator("summary").click();
}

export async function medirNoServico(page: Page): Promise<any> {
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/medidas/medir") && r.request().method() === "POST", { timeout: 120_000 });
  await page.getByRole("button", { name: "Medir geodésicas e volume" }).click();
  const r = await resp;
  expect(r.status()).toBe(200);
  return r.json();
}
