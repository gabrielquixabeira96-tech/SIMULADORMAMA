/**
 * Fluxo completo na UI contra o stack real, nos desenhos B e A:
 * upload de OBJ (+MTL+PNG) → /processar → calibração pela régua (/reescalar) → landmarks por
 * clique → medidas → TEPID. O OBJ enviado é o torso sintético t01 ESCALADO por 1,02 (como um
 * scan com escala errada); a régua é o par de mamilos, com o comprimento real do gabarito.
 */
import { expect, test } from "@playwright/test";
import { LANDMARKS, lerGabarito } from "./apoio";
import { OBRIGATORIOS, TORSO, preencherTepid, uploadCalibrarMarcar, valoresTepid } from "./fluxo-apoio";

test.use({ viewport: { width: 1920, height: 1080 } });

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
