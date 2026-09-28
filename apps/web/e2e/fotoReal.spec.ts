/**
 * Vista "Foto real" (plano "foto → 3D", P3-lite + P4-lite) contra o stack real: a "foto de exemplo"
 * de um torso sintético (reconstrução preparada em DATA_DIR/sinteticos/<torso>/foto/ — no e2e, a
 * fixture de `fotoSintetica.ts`) entra pelo passo 1, e o passo 3 mostra a PRÓPRIA foto editada:
 *   identidade do antes (os pixels da foto) · 0 pixels alterados fora da região simulada, também
 *   com a pose perturbada 5 px · halo = max(4,5; z) · selo "modelo 3D estimado" · cartão de
 *   incerteza por eixo (A sem números) · erro contra o gabarito (só B) · hachura do não observado
 *   nas vistas clínicas · nenhuma imagem sai do navegador.
 * As imagens nunca são gravadas: só contagens e hashes saem da página.
 */
import { expect, test, type Page } from "@playwright/test";
import { novoAtendimento } from "./apoio";
import { IMPLANTE_1, IMPLANTE_2, escolherImplante, esperarFotos, estadoFotos } from "./simulacao-apoio";

test.use({ viewport: { width: 1600, height: 1000 } });

const TORSO = "t01_simetrico_300";
const VISTA = "foto:frente";
type Qualidade = "interativa" | "final";

/** Passo 1 com a foto de exemplo → pontos do gabarito → implantes → simulação (vista inicial = a foto). */
async function prepararFotoReal(page: Page, implantes: string[]): Promise<string> {
  await page.goto("/");
  await novoAtendimento(page);
  if (!(await page.getByTestId(`importar-foto-${TORSO}`).isVisible())) await page.getByTestId("fotos-exemplo").locator("summary").click();
  await page.getByTestId(`importar-foto-${TORSO}`).click();
  const msg = page.getByRole("status").filter({ hasText: `Modelo 3D de ${TORSO} estimado de 1 foto` });
  await expect(msg).toBeVisible({ timeout: 120_000 });
  const malhaId = (await msg.getAttribute("data-malha-id"))!;
  expect(malhaId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByTestId("aplicar-gabarito").click();
  await expect(page.getByTestId("landmarks-guia")).toContainText(/Base lateral esquerda\s*✓/);
  for (const [k, id] of implantes.entries()) await escolherImplante(page, (k + 1) as 1 | 2, id);
  await page.getByTestId("gerar-simulacao").click();
  await expect(page.getByTestId("simulacao-pronta")).toBeVisible({ timeout: 240_000 });
  await esperarFotos(page, { estado: "a" });
  return malhaId;
}

/** Diferença entre os pixels da foto guardada pelo renderizador (sem selo) e a foto decodificada de novo aqui. */
async function identidadeDaFoto(page: Page, malhaId: string) {
  return page.evaluate(
    async ([id, v]) => {
      const f = (window as any).__simuladorSim.fotos;
      const base = f.fotoBase(v);
      const r = await fetch(`/api/malhas/${id}/arquivo?nome=${encodeURIComponent("original/foto_frente.png")}`, { cache: "no-store" });
      const bmp = await createImageBitmap(await r.blob());
      const c = document.createElement("canvas");
      c.width = base.largura;
      c.height = base.altura;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#3b4450";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, base.encaixe.x, base.encaixe.y, base.encaixe.largura, base.encaixe.altura);
      const ref = ctx.getImageData(0, 0, c.width, c.height).data;
      let dif = 0;
      for (let i = 0; i < ref.length; i++) if (ref[i] !== base.dados[i]) dif++;
      return { dif, largura: base.largura, altura: base.altura, fotoLargura: bmp.width, fotoAltura: bmp.height, encaixe: base.encaixe };
    },
    [malhaId, VISTA] as const,
  );
}

/** Pixels que mudam entre Antes e o estado FORA da região simulada dilatada 3 px (limiar 0: qualquer mudança conta). */
async function localidade(page: Page, estado: "a" | "b", qualidade: Qualidade) {
  return page.evaluate(
    ([v, e, q]) => {
      const f = (window as any).__simuladorSim.fotos;
      const a = f.imagem(v, "antes", { qualidade: q });
      const d = f.imagem(v, e, { qualidade: q });
      const m: Uint8Array = f.mascaraRegiao(v, q);
      const w = a.largura, h = a.altura;
      if (d.largura !== w || m.length !== w * h) throw new Error("tamanhos diferentes");
      const tmp = new Uint8Array(w * h), dil = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let k = -3; k <= 3 && !s; k++) if (x + k >= 0 && x + k < w && m[y * w + x + k]) s = 1;
          tmp[y * w + x] = s;
        }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let k = -3; k <= 3 && !s; k++) if (y + k >= 0 && y + k < h && tmp[(y + k) * w + x]) s = 1;
          dil[y * w + x] = s;
        }
      let fora = 0, foraDif = 0, regiao = 0, regiaoDif = 0;
      for (let i = 0; i < w * h; i++) {
        const mudou = a.dados[4 * i] !== d.dados[4 * i] || a.dados[4 * i + 1] !== d.dados[4 * i + 1] || a.dados[4 * i + 2] !== d.dados[4 * i + 2];
        if (m[i]) {
          regiao++;
          if (mudou) regiaoDif++;
        }
        if (!dil[i]) {
          fora++;
          if (mudou) foraDif++;
        }
      }
      return { w, h, fora, foraDif, regiao, regiaoDif };
    },
    [VISTA, estado, qualidade] as const,
  );
}

async function sha(page: Page, vista: string, estado: string, o: { peso?: number; qualidade?: Qualidade } = {}): Promise<string> {
  return (await page.evaluate(([v, e, oo]) => (window as any).__simuladorSim.fotos.renderizar(v, e, oo), [vista, estado, o] as const)).sha256;
}

/** Pixels "listrados" do não observado (cinza-azulado sobre a pele: r − b < 30) acima da faixa do selo, fora do fundo. */
async function pixelsNaoObservado(page: Page, vista: string): Promise<number> {
  return page.evaluate((v) => {
    const im = (window as any).__simuladorSim.fotos.imagem(v, "antes", { qualidade: "final" });
    const linhas = Math.floor(im.altura * 0.65);
    let n = 0;
    for (let i = 0; i < im.largura * linhas; i++) {
      const r = im.dados[4 * i], g = im.dados[4 * i + 1], b = im.dados[4 * i + 2];
      const fundo = Math.abs(r - 0x3b) + Math.abs(g - 0x44) + Math.abs(b - 0x50) < 24;
      if (!fundo && r - b < 30 && r > 70) n++;
    }
    return n;
  }, vista);
}

test("foto real no desenho B: antes = a foto, edição só na região (também com pose perturbada), halo, selo, incerteza e erro contra o gabarito", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "desenho B");
  test.setTimeout(8 * 60_000);
  const imagensEnviadas: string[] = [];
  page.on("request", (r) => {
    const ct = r.headers()["content-type"] ?? "";
    const corpo = r.postDataBuffer();
    if (/^image\//i.test(ct) || (corpo && (corpo.includes("data:image") || corpo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))))) imagensEnviadas.push(`${r.method()} ${r.url()}`);
  });
  const malhaId = await prepararFotoReal(page, [IMPLANTE_1, IMPLANTE_2]);

  // passo 1: erro contra o gabarito (torso sintético) com números, só em B
  await expect(page.getByTestId("foto-erro-gabarito")).toContainText("RMS na região das mamas");
  await expect(page.getByTestId("foto-erro-gabarito")).toContainText("Volume");

  // a vista inicial é a foto real; a tira tem a foto e as 5 clínicas
  const e0 = await estadoFotos(page);
  expect(e0).toMatchObject({ vista: VISTA, luzes: 0, preserveDrawingBuffer: false, envelope_visivel: true, pele_visivel: true, estado: "a" });
  // halo = max(4,5; incerteza em z) = 12,4 mm (fixture: só a foto frontal)
  expect(e0.envelope_mm).toBe(12.4);
  expect((e0.selo as string[]).join(" ")).toContain("MODELO 3D ESTIMADO DE 1 FOTO");
  expect((e0.selo as string[]).join(" ")).toContain("±12,4 mm");
  await expect(page.getByTestId("foto-vista-real-frente")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("foto-rotulo")).toContainText("A ·");
  await expect(page.getByTestId("foto-legenda")).toContainText("±12,4 mm");

  // cartão de incerteza por eixo, sempre visível; sem perfil, profundidade "só ilustração" e nenhum previsto
  const card = page.getByTestId("foto-incerteza");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-numeros", "1");
  await expect(card).toContainText("modelo 3D estimado de 1 foto");
  await expect(card).toContainText("Largura ±1,8 mm");
  await expect(card).toContainText("Profundidade ±12,4 mm — só ilustração");
  await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0);
  await expect(page.getByTestId("foto-diferencas")).not.toContainText("Avanço do mamilo");

  // identidade: a foto guardada é, byte a byte, a foto decodificada de novo (sem selo)
  const idt = await identidadeDaFoto(page, malhaId);
  expect(idt).toMatchObject({ dif: 0, fotoLargura: 960, fotoAltura: 720 });
  // antes (com selo) = A e B com peso 0, em outro plano/sulco também; o antes não passa pela GPU
  const renders0 = (await estadoFotos(page)).renders;
  const antes = await sha(page, VISTA, "antes");
  expect((await estadoFotos(page)).renders).toBe(renders0);
  expect(await sha(page, VISTA, "a", { peso: 0 })).toBe(antes);
  expect(await sha(page, VISTA, "b", { peso: 0 })).toBe(antes);
  expect(await sha(page, VISTA, "antes", { qualidade: "final" })).toBe(await sha(page, VISTA, "a", { peso: 0, qualidade: "final" }));
  await page.getByTestId("plano-dual_plane").check();
  await esperarFotos(page);
  expect(await sha(page, VISTA, "antes")).toBe(antes);
  await page.getByTestId("plano-subglandular").check();
  await esperarFotos(page);

  // localidade: 0 pixels alterados fora da região simulada (dilatada 3 px), A e B, interativo e final
  for (const q of ["interativa", "final"] as const)
    for (const e of ["a", "b"] as const) {
      const l = await localidade(page, e, q);
      console.log(`[fotoReal] ${e}/${q}: ${l.w}×${l.h}, fora ${l.fora} (mudaram ${l.foraDif}), região ${l.regiao} (mudaram ${l.regiaoDif})`);
      expect(l.foraDif, `${e}/${q}: pixels alterados fora da região`).toBe(0);
      expect(l.regiaoDif, `${e}/${q}: a edição aparece na região`).toBeGreaterThan(200);
    }
  // com erro de registro de 5 px (câmera e textura projetiva juntas): continua 0 fora; o antes não muda
  await page.evaluate(() => (window as any).__simuladorSim.fotos.perturbarPose({ dx: 5, dy: 5 }));
  for (const e of ["a", "b"] as const) {
    const l = await localidade(page, e, "final");
    console.log(`[fotoReal] pose +5 px ${e}: fora ${l.fora} (mudaram ${l.foraDif}), região ${l.regiao} (mudaram ${l.regiaoDif})`);
    expect(l.foraDif, `pose perturbada, ${e}: pixels alterados fora da região`).toBe(0);
  }
  expect(await sha(page, VISTA, "antes")).toBe(antes);
  await page.evaluate(() => (window as any).__simuladorSim.fotos.perturbarPose(null));

  // o halo continua obrigatório: sem ele a foto "depois" é ocultada
  await page.evaluate(() => (window as any).__simuladorSim.fotos.removerHalo());
  await expect(page.getByTestId("foto-erro")).toBeVisible();
  await page.evaluate(() => (window as any).__simuladorSim.fotos.restaurarHalo());
  await expect(page.getByTestId("foto-erro")).toHaveCount(0);

  // vistas clínicas do modelo reconstruído: hachura onde nenhuma foto viu (oblíqua e perfil)
  await page.getByTestId("foto-vista-obliqua_dir").click();
  await esperarFotos(page);
  await expect(page.getByTestId("foto-legenda-nao-observado")).toBeVisible();
  await expect(page.getByTestId("foto-rotulo")).toContainText("A ·");
  const hachura = await pixelsNaoObservado(page, "obliqua_dir");
  console.log(`[fotoReal] pixels do não observado na oblíqua D: ${hachura}`);
  expect(hachura).toBeGreaterThanOrEqual(200);
  expect(await pixelsNaoObservado(page, VISTA)).toBeLessThan(hachura / 10); // a foto real não tem hachura

  // nada de imagem sai do navegador; nenhum controle de compartilhar/baixar
  expect(imagensEnviadas).toEqual([]);
  await expect(page.getByTestId("foto-comparador").getByText(/compartilh|baixar imagem|download|exportar/i)).toHaveCount(0);
});

test("foto real no desenho A: a foto editada e a incerteza existem, sem nenhum número calculado", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-A", "desenho A");
  test.setTimeout(6 * 60_000);
  const malhaId = await prepararFotoReal(page, [IMPLANTE_1, IMPLANTE_2]);
  await expect(page.getByTestId("foto-reconstrucao")).toBeVisible();
  await expect(page.getByTestId("foto-erro-gabarito")).toHaveCount(0);
  const e0 = await estadoFotos(page);
  expect(e0).toMatchObject({ vista: VISTA, envelope_visivel: true, estado: "a" });
  expect((e0.selo as string[]).join(" ")).toContain("MODELO 3D ESTIMADO DE 1 FOTO");
  // cartão sempre visível, qualitativo: nenhum dígito
  const card = page.getByTestId("foto-incerteza");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-numeros", "0");
  await expect(card).toContainText("só ilustração");
  expect(await card.innerText()).not.toMatch(/\d/);
  await expect(page.getByTestId("previsto-simulacao")).toHaveCount(0);
  await expect(page.getByTestId("foto-diferencas")).toHaveCount(0);
  // a API também não entrega números em A (só câmeras e o halo)
  const api = await page.evaluate(async (id) => (await fetch(`/api/malhas/${id}/foto-real`)).json(), malhaId);
  expect(api).toMatchObject({ numeros: null, erro_gabarito: null, halo_mm: 12.4, n_fotos: 1, profundidade_so_ilustracao: true });
  // o reconstrucao.json (com números) não sai pela rota de arquivo
  expect(await page.evaluate(async (id) => (await fetch(`/api/malhas/${id}/arquivo?nome=reconstrucao.json`)).status, malhaId)).toBe(400);
  // a edição continua local também em A
  const l = await localidade(page, "a", "interativa");
  expect(l.foraDif).toBe(0);
  expect(l.regiaoDif).toBeGreaterThan(200);
});
