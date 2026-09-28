/**
 * Sessão de Bland-Altman com operador humano (ADR 0017), contra o stack real (services/mesh +
 * Next.js + Postgres), nos torsos sintéticos. Aqui o "operador" é o simulado do e2e de validação
 * (projeção do gabarito + jitter de ±1 px) dirigindo a MESMA UI que o cirurgião usa; a sessão com
 * humano é tarefa humana (pendência B). Prova:
 *  - a UI e as respostas da API não trazem gabarito, nome do torso nem distâncias até o encerramento;
 *  - o encerramento calcula viés, LoA 95 % (N-IMF à parte) e repetibilidade, grava em
 *    DATA_DIR/validacao/sessoes e alimenta a planilha do art. 5º;
 *  - no desenho A a página e a API ficam desligadas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { LANDMARKS, clicarLandmark, dataDirE2E, lerGabarito, melhorVista, prng } from "./apoio";

test.use({ viewport: { width: 1920, height: 1080 } });

const TORSOS_SESSAO = ["t01_simetrico_300", "t03_pequeno_ptose"] as const;

/** Tudo que não pode sair para o cliente com a sessão aberta: nomes dos torsos e números do gabarito. */
function proibidos(): string[] {
  const out = new Set<string>(["t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose", "gabarito", "euclidiana", "geodesica", "referencia_mm"]);
  for (const t of TORSOS_SESSAO) {
    for (const d of Object.values(lerGabarito(t).distancias)) {
      if (!d) continue;
      // só valores com casas decimais (um inteiro curto poderia coincidir com dígitos de um UUID)
      for (const v of [d.euclidiana_mm, d.geodesica_mm]) if (String(v).includes(".")) out.add(String(v));
    }
  }
  return [...out];
}

async function esperarViewer(page: Page) {
  await expect(page.getByTestId("viewer").locator("canvas")).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __simuladorViewer?: unknown }).__simuladorViewer), { timeout: 60_000 }).toBe(true);
}

test.describe("validação humana: sessão de Bland-Altman", () => {
  test("em A a página e a API ficam desligadas", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desenho-A", "só no desenho A");
    await page.goto("/");
    await expect(page.getByTestId("aviso-fixo")).toBeVisible();
    await expect(page.getByTestId("link-validacao")).toHaveCount(0);
    await page.goto("/validacao/bland-altman");
    await expect(page.getByTestId("validacao-desligada")).toBeVisible();
    await expect(page.getByTestId("operador")).toHaveCount(0);
    for (const r of [await request.post("/api/validacao/sessoes", { data: { operador: "OP-01" } }), await request.get("/api/validacao/planilha")]) {
      expect(r.status()).toBe(403);
      expect((await r.json()).erro.codigo).toBe("desligado_no_desenho_a");
    }
  });

  test("em B: sessão cega com repetição, resultado com N-IMF à parte e planilha", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desenho-B", "a sessão mede distâncias: só no desenho B");
    test.setTimeout(20 * 60_000);

    // ---- a página abre pelo link da consulta e inicia uma sessão pela UI (depois cancelada)
    await page.goto("/");
    await page.getByTestId("link-validacao").click();
    await expect(page).toHaveURL(/\/validacao\/bland-altman$/);
    await page.getByTestId("operador").fill("e2e-ui");
    await page.getByTestId("tipo-operador").selectOption("simulado");
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page.getByTestId("sessao-id")).toHaveAttribute("data-estado", "aberta");
    await expect(page.getByTestId("progresso")).toContainText(/0 de \d+ itens concluídos/);
    await expect(page).toHaveURL(/\?sessao=[0-9a-f-]{36}$/);
    await page.getByTestId("cancelar-sessao").click();
    await expect(page.getByTestId("sessao-id")).toHaveAttribute("data-estado", "cancelada");

    // ---- sessão do operador simulado: 2 torsos × 2 repetições, semente fixa
    const cria = await request.post("/api/validacao/sessoes", { data: { operador: "E2E-01", tipo_operador: "simulado", repeticoes: 2, torsos: [...TORSOS_SESSAO], semente: 7 } });
    expect(cria.status()).toBe(201);
    const criada = await cria.json();
    const id = criada.id as string;
    const nItens = criada.itens.length as number;
    expect(nItens).toBe(4);

    // Toda resposta da API vista pelo navegador até o encerramento é inspecionada.
    const lidas: Array<Promise<string>> = [];
    let capturando = true;
    const aoResponder = (r: Response) => {
      const u = new URL(r.url());
      if (!capturando || !u.pathname.startsWith("/api/") || u.pathname.endsWith("/malha")) return;
      lidas.push(r.text().then((t) => `${u.pathname} ${t}`, () => ""));
    };
    page.on("response", aoResponder);
    lidas.push(Promise.resolve(`criar ${JSON.stringify(criada)}`));
    // o gabarito do torso em sessão também não sai pela rota dos sintéticos
    const gab = await request.get(`/api/sinteticos/${TORSOS_SESSAO[0]}/gabarito.json`);
    expect(gab.status()).toBe(403);
    // nem pela planilha (os registros versionados cobrem os mesmos torsos) nem pela lista de sessões
    const pl = await request.get("/api/validacao/planilha?formato=json");
    expect(pl.status()).toBe(409);
    expect((await pl.json()).erro.codigo).toBe("planilha_indisponivel_sessao_aberta");
    lidas.push(request.get("/api/validacao/sessoes").then((r) => r.text()));

    await page.goto(`/validacao/bland-altman?sessao=${id}`);
    const discoSessao = () => JSON.parse(readFileSync(join(dataDirE2E(), "validacao", "sessoes", `${id}.json`), "utf8"));
    for (let i = 0; i < nItens; i++) {
      await expect(page.getByTestId("progresso")).toContainText(`${i} de ${nItens} itens concluídos`);
      await esperarViewer(page);
      // o "olho" do operador simulado lê o gabarito do disco (o navegador nunca recebe)
      const disco = discoSessao();
      const item = disco.itens[i];
      const torso = disco.scans.find((s: { scan_id: string }) => s.scan_id === item.scan_id).torso as string;
      await expect(page.getByTestId("progresso")).toContainText(`scan ${item.scan_id}, repetição ${item.repeticao}`);
      const g = lerGabarito(torso);
      const rng = prng(500 + i);
      for (const lm of LANDMARKS) {
        const mv = await melhorVista(page, g.landmarks[lm].posicao);
        await clicarLandmark(page, lm, g.landmarks[lm].posicao, mv.vista, rng, 1);
      }
      // nenhuma distância na tela durante a sessão
      expect(await page.locator("main").innerText()).not.toMatch(/\d+,\d+\s*mm/);
      const resp = page.waitForResponse((r) => r.url().endsWith(`/api/validacao/sessoes/${id}/itens/${i}`) && r.request().method() === "POST", { timeout: 180_000 });
      await page.getByTestId("registrar-item").click();
      expect((await resp).status()).toBe(200);
      console.log(`[validacaoHumana] item ${i + 1}/${nItens} registrado`);
    }
    await expect(page.getByTestId("progresso")).toContainText(`${nItens} de ${nItens} itens concluídos`);

    // ---- cegueira: nada do gabarito, do torso ou das distâncias saiu antes do encerramento
    capturando = false;
    page.off("response", aoResponder);
    const textos = await Promise.all(lidas);
    expect(textos.length).toBeGreaterThanOrEqual(nItens + 1);
    for (const t of textos) for (const x of proibidos()) expect(t.includes(x), `vazou "${x}" em: ${t.slice(0, 200)}`).toBe(false);

    // ---- encerrar
    await page.getByTestId("observacoes").fill("sessao e2e com operador simulado");
    const respEnc = page.waitForResponse((r) => r.url().endsWith(`/api/validacao/sessoes/${id}/encerrar`));
    await page.getByTestId("encerrar-sessao").click();
    const enc = await respEnc;
    expect(enc.status()).toBe(200);
    const fechada = await enc.json();
    const r = fechada.resultado;
    await expect(page.getByTestId("resultado-sessao")).toBeVisible();
    await expect(page.getByTestId("ba-n-imf")).toBeVisible();
    await expect(page.getByTestId("ba-intra")).toBeVisible();
    await expect(page.getByTestId("criterios")).toContainText("Vale para a fase 1: não");
    console.log(`[validacaoHumana] geral n=${r.geral.n} viés=${r.geral.vies_mm} LoA=[${r.geral.loa_inferior_mm}; ${r.geral.loa_superior_mm}] · N-IMF n=${r.n_imf.n} LoA=[${r.n_imf.loa_inferior_mm}; ${r.n_imf.loa_superior_mm}] · CR=${r.intra_operador.coeficiente_repetibilidade_mm}`);
    expect(r.geral.n).toBe(2 * 2 * 7 * 2);
    expect(r.n_imf.n).toBe(2 * 2 * 2 * 2);
    expect(r.criterios).toMatchObject({ n_pares_min_30: true, n_imf_relatado_a_parte: true, scans_distintos: 2, vale_para_fase1: false });
    // operador simulado (±1 px): LoA dentro de ±2 mm, como no e2e de validação dos marcos
    expect(r.geral.loa_inferior_mm).toBeGreaterThanOrEqual(-2);
    expect(r.geral.loa_superior_mm).toBeLessThanOrEqual(2);
    expect(r.intra_operador.n_grupos).toBeGreaterThan(0);
    expect(discoSessao().estado).toBe("encerrada");
    expect((await request.get(`/api/sinteticos/${TORSOS_SESSAO[0]}/gabarito.json`)).status()).toBe(200);

    // ---- planilha do art. 5º alimentada pela sessão
    const csv = await (await request.get("/api/validacao/planilha?formato=csv")).text();
    const daSessao = csv.split("\r\n").filter((l) => l.includes(`sessao:${id}`));
    expect(daSessao).toHaveLength(r.geral.n);
    expect(daSessao.every((l) => l.includes(",E2E-01,simulado,sintetico:t0"))).toBe(true);
    expect(csv).not.toContain("@");
    expect(csv).not.toContain(dataDirE2E());
  });
});
