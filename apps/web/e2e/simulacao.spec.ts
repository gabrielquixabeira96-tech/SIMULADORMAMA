/**
 * Marco 2 — interface de simulação contra o stack real (services/mesh gera os morphs):
 * escolha manual do implante, plano × IMF sem recarregar, slider antes/depois, comparação lado
 * a lado com câmeras sincronizadas, envelope de incerteza sempre presente, selo "não calibrado",
 * aviso fixo e ausência de compartilhamento; A/B.
 */
import { expect, test } from "@playwright/test";
import { IMPLANTE_1, IMPLANTE_2, esperarQuadro, estadoSim, prepararSimulacao } from "./simulacao-apoio";

test.use({ viewport: { width: 1600, height: 1000 } });

async function envelopePresente(page: import("@playwright/test").Page, paineis: string[]) {
  const est = await estadoSim(page);
  expect(Object.keys(est).sort()).toEqual([...paineis].sort());
  for (const k of paineis) {
    expect(est[k].peso).toBeGreaterThan(0);
    expect(est[k].envelope_mm).toBe(4.5);
    expect(est[k].envelope_visivel, `envelope do painel ${k}`).toBe(true);
    expect(est[k].pele_visivel).toBe(true);
    await expect(page.getByTestId(`envelope-legenda-${k}`)).toContainText("±4,5 mm");
  }
  await expect(page.getByTestId("simulacao").getByRole("alert")).toHaveCount(0);
}

test("simulação no desenho B: plano/IMF sem recarregar, slider, envelope, selo, previsto", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "fluxo B");
  test.setTimeout(6 * 60_000);
  const malhaId = await prepararSimulacao(page, [IMPLANTE_1]);
  await page.evaluate(() => ((window as any).__semRecarregar = true));
  await expect(page.getByTestId("selo-nao-calibrado")).toContainText("NÃO calibrados");
  await expect(page.getByTestId("aviso-fixo")).toContainText("Ilustração, não previsão de resultado");
  await envelopePresente(page, ["i1"]);
  await expect(page.getByTestId("previsto-simulacao")).toBeVisible();

  // slider: "antes" (0) não é imagem simulada → envelope inativo; qualquer peso > 0 → envelope
  await page.getByTestId("slider-peso").fill("0");
  await esperarQuadro(page);
  let est = await estadoSim(page);
  expect(est.i1.peso).toBe(0);
  expect(est.i1.envelope_visivel).toBe(false);
  await page.getByTestId("slider-peso").fill("35");
  await esperarQuadro(page);
  await envelopePresente(page, ["i1"]);
  expect((await estadoSim(page)).i1.peso).toBeCloseTo(0.35, 5);

  for (const [plano, imf] of [["dual_plane", "rebaixar"], ["dual_plane", "manter"], ["subglandular", "rebaixar"]] as const) {
    await page.getByTestId(`plano-${plano}`).check();
    await page.getByTestId(`imf-${imf}`).check();
    await esperarQuadro(page);
    est = await estadoSim(page);
    expect(est.i1).toMatchObject({ plano, imf, implante: IMPLANTE_1, alvo: `mt__${IMPLANTE_1}__${plano}__${imf}` });
    await envelopePresente(page, ["i1"]);
  }
  expect(await page.evaluate(() => (window as any).__semRecarregar)).toBe(true);

  // cada combinação mostrada foi registrada (tabela simulacoes, auditoria 'simulou')
  await expect
    .poll(async () => (await (await page.request.get(`/api/malhas/${malhaId}/simulacoes`)).json()).simulacoes.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);
  const sims = (await (await page.request.get(`/api/malhas/${malhaId}/simulacoes`)).json()).simulacoes;
  expect(sims[0].previsto).not.toBeNull();
  expect(sims.every((s: any) => s.nao_calibrado === true && s.implante_id === IMPLANTE_1)).toBe(true);

  const proibido = /compartilh|share|exportar|instagram|whatsapp|facebook|tiktok/i;
  await expect(page.getByRole("button", { name: proibido })).toHaveCount(0);
});

test("comparação lado a lado de 2 implantes com câmeras sincronizadas e envelope nos dois", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "roda uma vez (B)");
  test.setTimeout(6 * 60_000);
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  await expect(page.getByTestId("simulacao-paineis")).toHaveAttribute("data-n", "2");
  await envelopePresente(page, ["i1", "i2"]);
  let est = await estadoSim(page);
  expect(est.i1.implante).toBe(IMPLANTE_1);
  expect(est.i2.implante).toBe(IMPLANTE_2);

  // arrasta a câmera no painel 1 → o painel 2 acompanha
  const canvas1 = page.getByTestId("sim-painel-i1").locator("canvas");
  await canvas1.scrollIntoViewIfNeeded();
  const b = (await canvas1.boundingBox())!;
  const antes = est.i2.camera as number[];
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 160, b.y + b.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await esperarQuadro(page);
  await expect
    .poll(async () => {
      const e = await estadoSim(page);
      return Math.hypot(...(e.i1.camera as number[]).map((c: number, i: number) => c - (e.i2.camera as number[])[i]!));
    })
    .toBeLessThan(0.01);
  est = await estadoSim(page);
  expect(Math.hypot(...(est.i2.camera as number[]).map((c: number, i: number) => c - antes[i]!))).toBeGreaterThan(10);

  // plano/IMF valem para os dois; desligar a comparação mostra um de cada vez
  await page.getByTestId("plano-dual_plane").check();
  await esperarQuadro(page);
  est = await estadoSim(page);
  expect(est.i1.plano).toBe("dual_plane");
  expect(est.i2.plano).toBe("dual_plane");
  await page.getByTestId("comparar").uncheck();
  await page.getByTestId("mostrar-implante-2").check();
  await esperarQuadro(page);
  est = await estadoSim(page);
  expect(Object.keys(est)).toEqual(["i1"]);
  expect(est.i1.implante).toBe(IMPLANTE_2);
  await envelopePresente(page, ["i1"]);
});

test("simulação no desenho A: implante escolhido pelo cirurgião, sem sugestão, volume, alertas nem números previstos", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-A", "fluxo A");
  test.setTimeout(6 * 60_000);
  const malhaId = await prepararSimulacao(page, [IMPLANTE_1]);
  await envelopePresente(page, ["i1"]);
  await expect(page.getByTestId("selo-nao-calibrado")).toBeVisible();
  for (const id of ["previsto-simulacao", "distancias-painel", "volume-painel", "tepid-alertas", "sugestao-implante", "relatorio-numero-calculado"]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await page.getByTestId("plano-dual_plane").check();
  await esperarQuadro(page);
  expect((await estadoSim(page)).i1.plano).toBe("dual_plane");
  const sug = await page.request.get("/api/catalogo?sugerir=1");
  expect(sug.status()).toBe(403);
  await expect.poll(async () => (await (await page.request.get(`/api/malhas/${malhaId}/simulacoes`)).json()).simulacoes.length).toBeGreaterThan(0);
  const sims = (await (await page.request.get(`/api/malhas/${malhaId}/simulacoes`)).json()).simulacoes;
  expect(sims.every((s: any) => s.previsto === null)).toBe(true);
});
