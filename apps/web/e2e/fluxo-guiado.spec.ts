/**
 * Fluxo guiado em 3 passos (pacote P3), no iPad (1180×820, toque), contra o stack real:
 *  - demo: caminho mais curto com os pontos do torso sintético até o PDF — conta cliques e
 *    preenchimentos (≤ 12), mede a altura da página com o passo 3 pronto (≤ 3 telas) e de cada
 *    passo (≤ 1,5 tela), procura jargão/UUID fora de <details> (contrato C4), mede os alvos de toque
 *    (≥ 44 px) e confere os testids do contrato C3 no estado alcançado;
 *  - desenho B: base do TEPID pré-preenchida pelo 3D, feedback "gravado" junto de cada botão (as duas
 *    mensagens coexistem na seção do passo 2), barra de passos com ✓ e motivo;
 *  - desenho A: base NUNCA pré-preenchida, nenhum texto "pré-preenchid".
 * Também confere o viewer de medição sem tone mapping (gancho __simuladorViewer.toneMapping === 0).
 */
import { expect, test, type Page } from "@playwright/test";
import { importarTorso, medirNoServico, novoAtendimento } from "./apoio";
import { preencherTepid, valoresTepid } from "./fluxo-apoio";

const TORSO = "t01_simetrico_300";
const IMPLANTE = "motiva-rsd-300";
const TELA = { width: 1180, height: 820 };

test.use({ viewport: TELA, hasTouch: true });

/** Regex do contrato C4 (texto sem jargão, fora de <details> "Avançado"). */
const JARGAO = /vértice|caixa envolvente|\+Y cranial|quadro (scan|anatômico)|\bv\d{3,}\b|geometrico_parametrico|config\/tepid|Desenho [AB]\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

/**
 * Texto VISÍVEL da página fora de qualquer <details> (e fora dos seletores excluídos). Por padrão
 * exclui o painel da simulação (pacote P1, com textos próprios corrigidos pelo P1); com
 * E2E_JARGAO_ESTRITO=1 (integração) a página inteira é verificada.
 */
async function textoVisivelForaDeDetails(page: Page, excluir: string[]): Promise<string> {
  return page.evaluate((exc) => {
    const partes: string[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("details, script, style, [hidden]")) continue;
      if (exc.some((s) => el.closest(s))) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) continue;
      const t = n.textContent?.trim();
      if (t) partes.push(t);
    }
    return partes.join("\n");
  }, excluir);
}

/** Alvos de toque visíveis fora de "Avançado": altura (radio/checkbox medem o <label> que os contém). */
async function alvosPequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ruins: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, input, select, a.botao"))) {
      if (el.classList.contains("link") || el.closest("details.avancado") || (el as HTMLInputElement).type === "hidden") continue;
      if (!el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) continue;
      const tipo = (el as HTMLInputElement).type;
      const alvo = (tipo === "radio" || tipo === "checkbox") && el.closest("label") ? el.closest("label")! : el;
      const r = alvo.getBoundingClientRect();
      if (r.height < 44 - 0.5) ruins.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 30)}] ${r.height.toFixed(1)}px`);
    }
    return ruins;
  });
}

async function alturas(page: Page) {
  return page.evaluate(() => ({
    pagina: document.documentElement.scrollHeight,
    passos: Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>("section[data-passo]")).map((s) => [s.dataset.passo!, Math.round(s.getBoundingClientRect().height)])),
  }));
}

async function toneMappingViewer(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as unknown as { __simuladorViewer?: { toneMapping: number } }).__simuladorViewer?.toneMapping ?? null);
}

/** Testids do contrato C3 (pacote P3) que existem no estado alcançado pelo fluxo da demo. */
const C3_DEMO = [
  "pseudonimo", `importar-${TORSO}`, "upload-desligado-demo", "caixa-mm", "landmarks-guia", "aplicar-gabarito", "vista-frente", "vista-obliqua_dir",
  "vista-obliqua_esq", "vista-perfil_dir", "vista-perfil_esq", "viewer", "distancias-painel", "distancia-base_dir", "distancia-ssn_n_dir", "volume-painel",
  "volume-dir", "tepid-form", "tepid-nota", "tepid-alertas", "tepid-base_mm-dir", "tepid-base_mm-esq", "painel-relatorio", "relatorio-gerar",
  "relatorio-conteudo", "relatorio-numero-calculado", "relatorio-pdf-gerar", "relatorio-pdf-baixar", "relatorio-pdf-abrir", "anamnese-desligada-demo",
  "estado-simulacao", "status-mesh", "aviso-fixo", "faixa-demo", "link-validacao", "passo-1", "passo-2", "passo-3",
];

test("demo no iPad: até o PDF em ≤ 12 ações, altura, jargão, toque e contrato C3", async ({ page }, info) => {
  test.skip(info.project.name !== "demo", "caminho mais curto medido na demonstração");
  test.setTimeout(10 * 60_000);
  const acoes: string[] = [];
  const acao = async (nome: string, f: () => Promise<unknown>) => {
    acoes.push(nome);
    await f();
  };

  await page.goto("/");
  await expect(page.getByTestId("passo-motivo")).toContainText("Nova simulação");
  await expect(page.getByTestId("passo-proximo")).toBeDisabled();
  const aviso = await page.getByTestId("aviso-fixo").boundingBox();
  expect(aviso!.height, "aviso + faixa demo numa barra ≤ 56 px").toBeLessThanOrEqual(56);

  // passo 1: um toque no card (cria o atendimento e processa)
  await acao("usar este torso", () => page.getByTestId(`importar-${TORSO}`).click());
  await expect(page.getByRole("status").filter({ hasText: `Torso ${TORSO} processado` })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("pseudonimo")).toHaveText(/^P-[0-9A-HJ-NP-Z]{6}$/);
  await expect(page.getByTestId("passo-1")).toHaveAttribute("data-feito", "1");
  expect(await toneMappingViewer(page), "viewer de medição sem tone mapping (flat)").toBe(0);

  // passo 2: pontos do torso sintético + medir + gravar
  await acao("marcar os 10 pontos", () => page.getByTestId("aplicar-gabarito").click());
  await expect(page.getByTestId("landmarks-guia").locator("li")).toHaveCount(10);
  await expect(page.getByTestId("landmarks-guia").locator('li[data-marcado="1"]')).toHaveCount(10);
  await acao("medir", () => medirNoServico(page));
  await expect(page.getByTestId("volume-dir")).toContainText("±");
  await expect(page.getByTestId("passo-2")).toHaveAttribute("data-feito", "1");
  await acao("gravar medidas", () => page.getByRole("button", { name: "Gravar registro de medidas" }).click());
  const gravado = page.getByRole("status").filter({ hasText: "Registro de medidas gravado" });
  await expect(gravado).toBeVisible({ timeout: 60_000 });
  expect(await gravado.evaluate((e) => e.closest("section[data-passo]")?.getAttribute("data-passo"))).toBe("2");
  await expect(gravado).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}/);

  // passo 3: um implante do catálogo e gerar
  await acao("escolher implante", () => page.getByTestId(`catalogo-item-${IMPLANTE}`).getByRole("radio").check());
  await expect(page.getByTestId("implante-escolhido-1")).not.toHaveText("—");
  await acao("gerar simulação", () => page.getByTestId("gerar-simulacao").click());
  await expect(page.getByTestId("simulacao-pronta")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("passo-3")).toHaveAttribute("data-feito", "1");

  // ---- medições com o passo 3 pronto, "Avançado" fechado
  await expect(page.getByTestId("avancado-captura")).not.toHaveAttribute("open", "");
  const alt = await alturas(page);
  console.log(`[fluxo-guiado] altura com o passo 3 pronto: página ${alt.pagina} px; passos ${JSON.stringify(alt.passos)} (tela ${TELA.width}×${TELA.height})`);
  expect(alt.pagina, "página ≤ 3 telas").toBeLessThanOrEqual(3 * TELA.height);
  for (const [n, h] of Object.entries(alt.passos)) expect(h, `passo ${n} ≤ 1,5 tela`).toBeLessThanOrEqual(1.5 * TELA.height);

  const estrito = process.env.E2E_JARGAO_ESTRITO === "1";
  const texto = await textoVisivelForaDeDetails(page, estrito ? [] : ['[data-testid="simulacao"]']);
  const jargao = texto.split("\n").filter((l) => JARGAO.test(l));
  expect(jargao, "C4: jargão ou UUID visível fora de <details>").toEqual([]);
  if (!estrito) {
    const sim = (await textoVisivelForaDeDetails(page, [])).split("\n").filter((l) => JARGAO.test(l));
    console.log(`[fluxo-guiado] C4 no painel da simulação (P1, verificado com E2E_JARGAO_ESTRITO=1): ${sim.length} linha(s) ${JSON.stringify(sim)}`);
  }

  const pequenos = await alvosPequenos(page);
  expect(pequenos, "alvos de toque < 44 px fora de Avançado").toEqual([]);
  for (const v of ["frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq"]) {
    const h = (await page.getByTestId(`vista-${v}`).boundingBox())!.height;
    expect(h, `vista-${v} em uma linha`).toBeLessThanOrEqual(48);
  }

  // registro: gerar relatório → gerar PDF → baixar
  await acao("gerar relatório", () => page.getByTestId("relatorio-gerar").click());
  await expect(page.getByTestId("relatorio-conteudo")).toBeVisible({ timeout: 60_000 });
  await acao("gerar PDF", () => page.getByTestId("relatorio-pdf-gerar").click());
  await expect(page.getByTestId("relatorio-pdf-baixar")).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), acao("baixar PDF", () => page.getByTestId("relatorio-pdf-baixar").click())]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  console.log(`[fluxo-guiado] ações até o PDF: ${acoes.length} (${acoes.join(" → ")})`);
  expect(acoes.length, "ações até o PDF").toBeLessThanOrEqual(12);

  // contrato C3: testids presentes no estado alcançado; link-validacao visível
  for (const id of C3_DEMO) expect(await page.getByTestId(id).count(), `testid ${id}`).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("link-validacao")).toBeVisible();
  const ganchos = await page.evaluate(() => {
    const g = (window as unknown as { __simuladorViewer?: Record<string, unknown> }).__simuladorViewer;
    return g ? { projetar: typeof g.projetar, melhorVista: typeof g.melhorVista } : null;
  });
  expect(ganchos).toEqual({ projetar: "function", melhorVista: "function" });
  // texto sem UUID nem jargão também depois do relatório (fora de <details> e do painel P1)
  const textoFinal = await textoVisivelForaDeDetails(page, estrito ? [] : ['[data-testid="simulacao"]']);
  expect(textoFinal.split("\n").filter((l) => JARGAO.test(l)), "C4 após o PDF").toEqual([]);
});

test("desenho B: base pré-preenchida pelo 3D e feedback gravado junto de cada botão", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "desenho B");
  test.setTimeout(6 * 60_000);
  await page.goto("/");
  await expect(page.getByTestId("passo-proximo")).toBeDisabled();
  await novoAtendimento(page);
  await expect(page.getByTestId("passo-motivo")).toContainText("scan");
  await importarTorso(page, TORSO);
  await expect(page.getByTestId("passo-1")).toHaveAttribute("data-feito", "1");
  await expect(page.getByTestId("passo-motivo")).toHaveCount(0);
  expect(await toneMappingViewer(page)).toBe(0);

  // Próximo: rola até o passo 2 e foca um controle dele
  await page.getByTestId("passo-proximo").click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("section[data-passo]")?.getAttribute("data-passo"))).toBe("2");
  await expect(page.getByTestId("passo-2")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("passo-motivo")).toContainText("Marque os 10 pontos (faltam 10)");

  await page.getByTestId("aplicar-gabarito").click();
  // base pré-preenchida pela largura medida (linha reta), marcada para confirmar
  await expect(page.getByTestId("tepid-base_mm-dir")).not.toHaveValue("");
  await expect(page.getByTestId("tepid-base-pre-dir")).toContainText("pré-preenchida pelo 3D — confirme");
  // valor digitado não é sobrescrito
  await page.getByTestId("tepid-base_mm-esq").fill("121");
  await page.getByTestId("aplicar-gabarito").click();
  await expect(page.getByTestId("tepid-base_mm-esq")).toHaveValue("121");
  await expect(page.getByTestId("tepid-base-pre-esq")).toHaveCount(0);

  await medirNoServico(page);
  await expect(page.getByTestId("cartao-ssn_n")).toContainText("sobre a pele");
  await expect(page.getByTestId("cartao-base")).toContainText(/D \d+,\d/);
  await preencherTepid(page, valoresTepid(true));
  await page.getByRole("button", { name: "Validar e avaliar alertas" }).click();
  await expect(page.getByTestId("tepid-alertas").locator("li.alerta")).not.toHaveCount(0);
  await expect(page.locator(".alerta-campo").first()).toBeVisible(); // alerta também ao lado do campo
  await page.getByRole("button", { name: "Gravar TEPID do paciente" }).click();
  const tepidOk = page.getByRole("status").filter({ hasText: "TEPID gravado." });
  await expect(tepidOk).toBeVisible();
  await page.getByRole("button", { name: "Gravar registro de medidas" }).click();
  const medOk = page.getByRole("status").filter({ hasText: "Registro de medidas gravado" });
  await expect(medOk).toBeVisible({ timeout: 60_000 });
  // as duas mensagens coexistem e ficam na mesma seção dos botões (passo 2)
  await expect(tepidOk).toBeVisible();
  for (const [msg, botao] of [
    [tepidOk, page.getByRole("button", { name: "Gravar TEPID do paciente" })],
    [medOk, page.getByRole("button", { name: "Gravar registro de medidas" })],
  ] as const) {
    const secMsg = await msg.evaluate((e) => e.closest("section[data-passo]")?.getAttribute("data-passo"));
    const secBotao = await botao.evaluate((e) => e.closest("section[data-passo]")?.getAttribute("data-passo"));
    expect(secMsg).toBe("2");
    expect(secBotao).toBe(secMsg);
  }
  await expect(medOk).toHaveAttribute("data-medida-id", /^[0-9a-f-]{36}$/);
  // alteração depois de gravar → "alterações não salvas"
  await page.getByTestId("tepid-apss_mm-dir").fill("21");
  await expect(tepidOk).toContainText("alterações não salvas");

  const texto = await textoVisivelForaDeDetails(page, ['[data-testid="simulacao"]']);
  expect(texto.split("\n").filter((l) => JARGAO.test(l)), "C4 no desenho B").toEqual([]);
  expect(await alvosPequenos(page), "alvos de toque no desenho B").toEqual([]);
});

test("desenho A: base do TEPID nunca pré-preenchida", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-A", "desenho A");
  test.setTimeout(4 * 60_000);
  await page.goto("/");
  await novoAtendimento(page);
  await importarTorso(page, TORSO);
  await page.getByTestId("aplicar-gabarito").click();
  await expect(page.getByTestId("landmarks-guia").locator('li[data-marcado="1"]')).toHaveCount(10);
  await expect(page.getByTestId("tepid-base_mm-dir")).toHaveValue("");
  await expect(page.getByTestId("tepid-base_mm-esq")).toHaveValue("");
  expect(await page.locator("body").innerText()).not.toMatch(/pré-preenchid/i);
  for (const id of ["distancias-painel", "volume-painel", "tepid-alertas"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId("link-validacao")).toHaveCount(0);
  const texto = await textoVisivelForaDeDetails(page, ['[data-testid="simulacao"]']);
  expect(texto.split("\n").filter((l) => JARGAO.test(l)), "C4 no desenho A").toEqual([]);
  expect(await alvosPequenos(page), "alvos de toque no desenho A").toEqual([]);
});
