/**
 * Página /benchmark (plano A14): desligada por padrão (servidor A sem BENCHMARK_HABILITADO → 404
 * na página e nas rotas) e, ligada (servidor B), roda o roteiro de latência no navegador e baixa
 * o JSON que `scripts/importar_latencia.py` transforma em registro "medido em hardware real".
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { AQUECIMENTO_DESCARTADO, ROTEIRO } from "../src/simulacao/benchmark";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("benchmark desligado por padrão: /benchmark e /api/benchmark dão 404", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desenho-A", "o servidor A roda sem BENCHMARK_HABILITADO");
  const r = await page.goto("/benchmark");
  expect(r?.status()).toBe(404);
  await expect(page.getByTestId("benchmark-rodar")).toHaveCount(0);
  expect((await request.post("/api/benchmark", { data: {} })).status()).toBe(404);
  expect((await request.get("/api/benchmark/arquivo?nome=morphs/subglandular__manter.glb")).status()).toBe(404);
});

test("benchmark ligado: roda o roteiro, mostra p50/p95 e baixa o JSON importável", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desenho-B", "o servidor B roda com BENCHMARK_HABILITADO=1");
  test.setTimeout(10 * 60_000);
  // só a lista fixa de arquivos
  expect((await request.get("/api/benchmark/arquivo?nome=processada.obj")).status()).toBe(400);
  expect((await request.get("/api/benchmark/arquivo?nome=../../pacientes/x.glb")).status()).toBe(400);

  if (process.env.E2E_BENCHMARK_NA_REDE === "1") {
    // modo "benchmark na rede" (ADR 0003, revisão v0.1.2): fora das rotas do benchmark tudo é 403,
    // mesmo com token e Host de loopback; a página abaixo tem de funcionar só com as rotas liberadas
    for (const c of ["/", "/api/config", "/api/pacientes"]) {
      const resp = await request.get(c, { headers: { Host: "localhost" } });
      expect(resp.status(), c).toBe(403);
      expect((await resp.json()).erro.codigo).toBe("rota_restrita_benchmark");
    }
  }
  const r = await page.goto("/benchmark");
  expect(r?.status()).toBe(200);
  await page.getByTestId("benchmark-rodar").click();
  await expect(page.getByTestId("benchmark-resultado")).toBeVisible({ timeout: 9 * 60_000 });
  for (const k of ["slider", "troca_plano_imf", "troca_implante", "geral_1_painel", "slider_comparacao_2_paineis"]) await expect(page.getByTestId(`benchmark-linha-${k}`)).toBeVisible();
  // nenhum número previsto (dado calculado) sai na página
  await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("benchmark-baixar").click()]);
  const dir = mkdtempSync(join(tmpdir(), "benchmark-e2e-"));
  try {
    const arq = join(dir, "medicao.json");
    await download.saveAs(arq);
    const j = JSON.parse(readFileSync(arq, "utf8"));
    expect(j).toMatchObject({ esquema: "validacao_componente/web-marco2-latencia", origem: "pagina_benchmark", medido_em_hardware_real: true });
    expect(j.maquina.user_agent).toMatch(/Chrome/);
    expect(typeof j.maquina.webgl_renderer).toBe("string");
    expect(j.parametros.aquecimento_descartado).toBe(AQUECIMENTO_DESCARTADO);
    // n por interação igual ao do e2e de latência (mesmo roteiro)
    expect(j.resultados.slider.n).toBe(ROTEIRO.slider.n);
    expect(j.resultados.troca_plano_imf.n).toBe(ROTEIRO.troca_plano_imf.n);
    expect(j.resultados.troca_implante.n).toBe(ROTEIRO.troca_implante.n);
    expect(j.resultados.slider_comparacao_2_paineis.n).toBe(ROTEIRO.slider_comparacao_2_paineis.n);
    expect(j.resultados.geral_1_painel.n).toBe(ROTEIRO.slider.n + ROTEIRO.troca_plano_imf.n + ROTEIRO.troca_implante.n);
    for (const x of Object.values(j.resultados) as Array<{ p50_ms: number; p95_ms: number }>) expect(x.p95_ms).toBeGreaterThanOrEqual(x.p50_ms);
    expect(JSON.stringify(j)).not.toMatch(/pseud|paciente|P-[0-9A-Z]{6}/i);

    // importador: gera o registro "medido em hardware real" com o userAgent
    const saida = join(dir, "docs");
    execFileSync("python3", [join(RAIZ, "scripts/importar_latencia.py"), arq, "--rotulo", "e2e", "--saida", saida], { encoding: "utf8" });
    const md = readdirSync(saida).find((f) => f.endsWith("-web-marco2-latencia-hardware-e2e.md"))!;
    const texto = readFileSync(join(saida, md), "utf8");
    expect(texto).toContain("medido_em_hardware_real: true");
    expect(texto).toContain(j.maquina.user_agent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
