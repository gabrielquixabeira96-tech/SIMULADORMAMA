/**
 * Fluxo completo na UI contra o stack real, nos desenhos B e A:
 * upload de OBJ (+MTL+PNG) → /processar → calibração pela régua (/reescalar) → landmarks por
 * clique → medidas → TEPID. O OBJ enviado é o torso sintético t01 ESCALADO por 1,02 (como um
 * scan com escala errada); a régua é o par de mamilos, com o comprimento real do gabarito.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { LANDMARKS, clicarLandmark, clicarPonto, dataDirE2E, lerGabarito, melhorVista, novoAtendimento, prng, type V3 } from "./apoio";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../../..");
const TORSO = "t01_simetrico_300";
const ESCALA_ERRADA = 1.02;
const OBRIGATORIOS = LANDMARKS.slice(0, 6);

test.use({ viewport: { width: 1920, height: 1080 } });

function objEscalado(): string[] {
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

function valoresTepid(disparar: boolean): Record<string, { dir: number; esq: number }> {
  const c = JSON.parse(readFileSync(join(RAIZ, "config/tepid.json"), "utf8"));
  const v: Record<string, { dir: number; esq: number }> = {};
  for (const [k, d] of Object.entries(c.campos) as Array<[string, { min: number; max: number }]>) v[k] = { dir: (d.min + d.max) / 2, esq: (d.min + d.max) / 2 };
  if (disparar) {
    const r = c.regras.find((x: { operador: string }) => x.operador === "<");
    v[r.campo] = { dir: r.limiar_mm - 1, esq: v[r.campo]!.esq };
  }
  return v;
}

async function preencherTepid(page: Page, v: Record<string, { dir: number; esq: number }>) {
  for (const [campo, lados] of Object.entries(v)) {
    await page.getByTestId(`tepid-${campo}-dir`).fill(String(lados.dir));
    await page.getByTestId(`tepid-${campo}-esq`).fill(String(lados.esq));
  }
}

/** Upload → processar → régua → landmarks obrigatórios (+ base em B). Devolve o fator aplicado. */
async function uploadCalibrarMarcar(page: Page, ids: readonly (typeof LANDMARKS)[number][]): Promise<number> {
  const gab = lerGabarito(TORSO);
  await page.goto("/");
  await novoAtendimento(page);
  await page.getByTestId("upload-arquivos").setInputFiles(objEscalado());
  await page.getByLabel("Unidade do arquivo").selectOption("mm");
  await page.getByRole("button", { name: "Enviar e processar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Malha processada" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("caixa-mm")).toContainText("GLB");
  // ordem obrigatória: landmarks só depois da calibração
  await expect(page.getByRole("button", { name: "Landmarks", exact: true })).toBeDisabled();

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
  await expect(page.getByRole("button", { name: "Landmarks", exact: true })).toHaveAttribute("aria-pressed", "true");
  const rngL = prng(78);
  for (const id of ids) {
    const p = gab.landmarks[id].posicao;
    const mv = await melhorVista(page, p);
    await clicarLandmark(page, id, p, mv.vista, rngL);
  }
  return fator;
}

test("fluxo completo no desenho B: upload → processar → régua → landmarks → medidas → TEPID", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "fluxo do desenho B");
  test.setTimeout(8 * 60_000);
  const gab = lerGabarito(TORSO);
  await uploadCalibrarMarcar(page, LANDMARKS);

  // medidas: euclidianas no cliente + geodésica/volume pelo serviço
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/medidas/medir"));
  await page.getByRole("button", { name: "Medir geodésicas e volume" }).click();
  const med = await (await resp).json();
  for (const id of ["ssn_n_dir", "ssn_n_esq", "intermamilar", "base_dir", "base_esq"]) {
    expect(Math.abs(med.distancias[id].euclidiana_mm - gab.distancias[id]!.euclidiana_mm), id).toBeLessThanOrEqual(2);
    expect(Math.abs(med.distancias[id].geodesica_mm - gab.distancias[id]!.geodesica_mm), id).toBeLessThanOrEqual(2);
  }
  await expect(page.getByTestId("distancias-painel")).toBeVisible();
  await expect(page.getByTestId("volume-dir")).toContainText("±");

  // TEPID com alerta (só B), depois grava medidas + TEPID
  await preencherTepid(page, valoresTepid(true));
  await page.getByRole("button", { name: "Validar e avaliar alertas" }).click();
  await expect(page.getByTestId("tepid-alertas").locator("li.alerta")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Gravar registro de medidas" }).click();
  const gravado = page.getByRole("status").filter({ hasText: "Registro de medidas gravado" });
  await expect(gravado).toBeVisible({ timeout: 120_000 });
  const medidaId = (await gravado.innerText()).match(/\(([0-9a-f-]{36})\)/)![1];
  const reg = await (await page.request.get(`/api/medidas/${medidaId}`)).json();
  expect(reg.desenho).toBe("B");
  expect(reg.escala.metodo).toBe("regua_2_pontos");
  expect(reg.distancias.intermamilar.geodesica_mm).toBeGreaterThan(0);
  expect(reg.volumes.dir.incerteza_ml).toBeGreaterThan(0);
  expect(reg.medidas_digitadas).not.toBeNull();
  await page.getByRole("button", { name: "Gravar TEPID do paciente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "TEPID gravado." })).toBeVisible();
});

test("fluxo completo no desenho A: medidas digitadas, nada calculado", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-A", "fluxo do desenho A");
  test.setTimeout(8 * 60_000);
  const chamadasMedir: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/medidas/medir")) chamadasMedir.push(r.url());
  });
  await uploadCalibrarMarcar(page, OBRIGATORIOS);

  // nada calculado na tela
  for (const id of ["distancias-painel", "volume-painel", "tepid-alertas", "sugestao-implante", "relatorio-numero-calculado"]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Medir geodésicas e volume" })).toHaveCount(0);
  // no A a gravação exige as medidas digitadas
  await expect(page.getByRole("button", { name: "Gravar registro de medidas" })).toBeDisabled();
  await preencherTepid(page, valoresTepid(true));
  await page.getByRole("button", { name: "Validar medidas" }).click();
  await page.getByRole("button", { name: "Gravar registro de medidas" }).click();
  const gravado = page.getByRole("status").filter({ hasText: "Registro de medidas gravado" });
  await expect(gravado).toBeVisible({ timeout: 60_000 });
  const medidaId = (await gravado.innerText()).match(/\(([0-9a-f-]{36})\)/)![1];
  const reg = await (await page.request.get(`/api/medidas/${medidaId}`)).json();
  expect(reg.desenho).toBe("A");
  expect(reg.distancias).toBeNull();
  expect(reg.volumes).toBeNull();
  expect(reg.geodesica).toBeNull();
  expect(Object.keys(reg.landmarks).sort()).toEqual([...OBRIGATORIOS].sort());
  expect(reg.medidas_digitadas.base_mm.dir).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Gravar TEPID do paciente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "TEPID gravado." })).toBeVisible();
  // o texto visível não tem nenhuma distância do gabarito
  const texto = await page.locator("body").innerText();
  expect(texto).not.toContain(String(lerGabarito(TORSO).distancias.intermamilar!.euclidiana_mm).replace(".", ","));
  expect(chamadasMedir).toEqual([]);
});
