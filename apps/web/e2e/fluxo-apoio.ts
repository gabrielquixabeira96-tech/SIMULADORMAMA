/**
 * Apoio compartilhado dos e2e de fluxo: upload do torso sintético t01 ESCALADO por 1,02 (como um
 * scan com escala errada) → /processar → régua nos mamilos (comprimento real do gabarito) →
 * landmarks por clique; TEPID a partir de config/tepid.json.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { LANDMARKS, clicarLandmark, clicarPonto, dataDirE2E, lerGabarito, melhorVista, novoAtendimento, prng, type V3 } from "./apoio";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(AQUI, "../../..");
export const TORSO = "t01_simetrico_300";
export const ESCALA_ERRADA = 1.02;
export const OBRIGATORIOS = LANDMARKS.slice(0, 6);


export function objEscalado(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "fluxo-e2e-"));
  const origem = join(dataDirE2E(), "sinteticos", TORSO);
  const linhas = readFileSync(join(origem, "torso.obj"), "utf8")
    .split("\n")
    .map((l) => (l.startsWith("v ") ? "v " + l.trim().split(/\s+/).slice(1, 4).map((c) => (Number(c) * ESCALA_ERRADA).toFixed(5)).join(" ") : l));
  writeFileSync(join(dir, "scan_consulta.obj"), linhas.join("\n"));
  copyFileSync(join(origem, "torso.mtl"), join(dir, "torso.mtl"));
  copyFileSync(join(origem, "textura.png"), join(dir, "textura.png"));
  return ["scan_consulta.obj", "torso.mtl", "textura.png"].map((a) => join(dir, a));
}

export function valoresTepid(disparar: boolean): Record<string, { dir: number; esq: number }> {
  const c = JSON.parse(readFileSync(join(RAIZ, "config/tepid.json"), "utf8"));
  const v: Record<string, { dir: number; esq: number }> = {};
  for (const [k, d] of Object.entries(c.campos) as Array<[string, { min: number; max: number }]>) v[k] = { dir: (d.min + d.max) / 2, esq: (d.min + d.max) / 2 };
  if (disparar) {
    const r = c.regras.find((x: { operador: string }) => x.operador === "<");
    v[r.campo] = { dir: r.limiar_mm - 1, esq: v[r.campo]!.esq };
  }
  return v;
}

export async function preencherTepid(page: Page, v: Record<string, { dir: number; esq: number }>) {
  for (const [campo, lados] of Object.entries(v)) {
    await page.getByTestId(`tepid-${campo}-dir`).fill(String(lados.dir));
    await page.getByTestId(`tepid-${campo}-esq`).fill(String(lados.esq));
  }
}

/** Upload → processar → régua → landmarks obrigatórios (+ base em B). Devolve o fator aplicado. */
export async function uploadCalibrarMarcar(page: Page, ids: readonly (typeof LANDMARKS)[number][]): Promise<number> {
  const gab = lerGabarito(TORSO);
  await page.goto("/");
  await novoAtendimento(page);
  await page.getByTestId("upload-arquivos").setInputFiles(objEscalado());
  await page.getByLabel("Unidade do arquivo").selectOption("mm");
  await page.getByRole("button", { name: "Enviar e processar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Malha processada" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("caixa-mm")).toContainText("GLB");
  // ordem obrigatória: pontos só depois da escala (o bloco "Ajustar escala" abre sozinho)
  await expect(page.getByRole("button", { name: "Marcar pontos", exact: true })).toBeDisabled();
  await expect(page.getByTestId("ajustar-escala")).toHaveAttribute("open", "");

  // régua: extremos = mamilos (no scan escalado), comprimento real = intermamilar do gabarito
  await page.getByRole("button", { name: "Régua (2 pontos)" }).click();
  const rng = prng(77);
  for (const id of ["mamilo_dir", "mamilo_esq"] as const) {
    const p = gab.landmarks[id].posicao.map((c) => c * ESCALA_ERRADA) as V3;
    await clicarPonto(page, p, "frente", rng);
  }
  await expect(page.getByTestId("regua-pontos")).toHaveText("2/2 pontos");
  await page.getByTestId("regua-mm").fill(String(gab.distancias.intermamilar!.euclidiana_mm));
  await page.getByRole("button", { name: "Aplicar calibração" }).click();
  const msg = page.getByRole("status").filter({ hasText: "Escala aplicada" });
  await expect(msg).toBeVisible({ timeout: 120_000 });
  const fator = Number((await msg.innerText()).match(/fator ([\d.]+)/)![1]);
  expect(Math.abs(fator - 1 / ESCALA_ERRADA)).toBeLessThan(0.005);

  // landmarks por clique, cada um na vista mais adequada
  await expect(page.getByRole("button", { name: "Marcar pontos", exact: true })).toHaveAttribute("aria-pressed", "true");
  const rngL = prng(78);
  for (const id of ids) {
    const p = gab.landmarks[id].posicao;
    const mv = await melhorVista(page, p);
    await clicarLandmark(page, id, p, mv.vista, rngL);
  }
  return fator;
}

