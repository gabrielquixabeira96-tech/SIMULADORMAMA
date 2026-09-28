/**
 * Modo foto (ADR 0019) contra o stack real (services/mesh gera os morphs; o navegador renderiza em
 * SwiftShader): a "foto do scan" desenhada sem luz somada e com câmera clínica, o "depois" como a
 * mesma foto editada, com a incerteza e o selo nos pixels. Critérios do pacote P1 FOTO:
 *   identidade do antes · localidade da edição · resposta ao volume · incerteza e selo ·
 *   CFM/LGPD (sem compartilhar/baixar, nenhuma imagem sai do navegador) · A/B.
 * As imagens nunca são gravadas: só hashes e contagens saem da página.
 */
import { expect, test, type Page } from "@playwright/test";
import { IMPLANTE_1, IMPLANTE_2, esperarFotos, estadoFotos, prepararSimulacao, versaoFotos } from "./simulacao-apoio";

test.use({ viewport: { width: 1600, height: 1000 } });

const FUNDO: [number, number, number] = [0x3b, 0x44, 0x50];
const JARGAO = /vértice|caixa envolvente|\+Y cranial|quadro (scan|anatômico)|\bv\d{3,}\b|geometrico_parametrico|config\/tepid|Desenho [AB]\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
const PROIBIDO = /compartilh|share|exportar|instagram|whatsapp|facebook|tiktok|baixar imagem|download/i;

type Vista = "frente" | "obliqua_dir" | "obliqua_esq" | "perfil_dir" | "perfil_esq";

type Qualidade = "interativa" | "final";
/** As análises de pixels usam o quadro final (MSAA, o que fica na tela em repouso); a identidade vale nos dois. */
const FINAL: Qualidade = "final";

async function sha(page: Page, vista: Vista, estado: string, peso?: number, qualidade: Qualidade = "interativa"): Promise<string> {
  return (
    await page.evaluate(([v, e, p, q]) => (window as any).__simuladorSim.fotos.renderizar(v, e, p === null ? { qualidade: q } : { peso: p, qualidade: q }), [vista, estado, peso ?? null, qualidade] as const)
  ).sha256;
}

/** Localidade: fração de pixels que mudam (> 2/255) FORA da máscara da região dilatada 3 px; média de diferença dentro. */
async function localidade(page: Page, vista: Vista, estado: "a" | "b", qualidade: Qualidade = FINAL) {
  return page.evaluate(
    ([v, e, q]) => {
      const f = (window as any).__simuladorSim.fotos;
      const a = f.imagem(v, "antes", { qualidade: q });
      const d = f.imagem(v, e, { qualidade: q });
      const m: Uint8Array = f.mascaraRegiao(v, q);
      const w = a.largura, h = a.altura;
      if (d.largura !== w || m.length !== w * h) throw new Error("tamanhos diferentes");
      // dilatação quadrada de 3 px (dois passes separáveis)
      const tmp = new Uint8Array(w * h), dil = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let v1 = 0;
          for (let k = -3; k <= 3 && !v1; k++) {
            const xx = x + k;
            if (xx >= 0 && xx < w && m[y * w + xx]) v1 = 1;
          }
          tmp[y * w + x] = v1;
        }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let v1 = 0;
          for (let k = -3; k <= 3 && !v1; k++) {
            const yy = y + k;
            if (yy >= 0 && yy < h && tmp[yy * w + x]) v1 = 1;
          }
          dil[y * w + x] = v1;
        }
      let fora = 0, foraDif = 0, dentro = 0, somaDentro = 0, regiao = 0, somaRegiao = 0;
      for (let i = 0; i < w * h; i++) {
        const dr = Math.abs(a.dados[4 * i] - d.dados[4 * i]), dg = Math.abs(a.dados[4 * i + 1] - d.dados[4 * i + 1]), db = Math.abs(a.dados[4 * i + 2] - d.dados[4 * i + 2]);
        if (m[i]) {
          regiao++;
          somaRegiao += (dr + dg + db) / 3;
        }
        if (dil[i]) {
          dentro++;
          somaDentro += (dr + dg + db) / 3;
        } else {
          fora++;
          if (Math.max(dr, dg, db) > 2) foraDif++;
        }
      }
      return { w, h, fora, foraDif, fracFora: foraDif / fora, regiao, mediaRegiao: somaRegiao / Math.max(1, regiao), mediaDilatada: somaDentro / Math.max(1, dentro) };
    },
    [vista, estado, qualidade] as const,
  );
}

/** Área da silhueta (pixels ≠ fundo, fora da faixa do selo) de uma foto. */
async function areaSilhueta(page: Page, vista: Vista, estado: string): Promise<number> {
  return page.evaluate(
    ([v, e, fundo]) => {
      const im = (window as any).__simuladorSim.fotos.imagem(v, e, { qualidade: "final" });
      const linhas = Math.floor(im.altura * 0.85); // acima da faixa do selo
      let n = 0;
      for (let i = 0; i < im.largura * linhas; i++) {
        const dif = Math.max(Math.abs(im.dados[4 * i] - fundo[0]), Math.abs(im.dados[4 * i + 1] - fundo[1]), Math.abs(im.dados[4 * i + 2] - fundo[2]));
        if (dif > 24) n++;
      }
      return n;
    },
    [vista, estado, FUNDO] as const,
  );
}

/** Pixels âmbar (ΔE*ab < 12 do #d97706) e pixels de texto na faixa inferior do selo. */
async function ambarESelo(page: Page, vista: Vista, estado: string) {
  return page.evaluate(
    ([v, e]) => {
      const lab = (r: number, g: number, b: number) => {
        const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        const R = lin(r), G = lin(g), B = lin(b);
        const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
        const t = (x: number) => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116);
        return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
      };
      const alvo = lab(0xd9, 0x77, 0x06);
      const im = (window as any).__simuladorSim.fotos.imagem(v, e, { qualidade: "final" });
      let ambar = 0;
      for (let i = 0; i < im.largura * im.altura; i++) {
        const l = lab(im.dados[4 * i], im.dados[4 * i + 1], im.dados[4 * i + 2]);
        if (Math.hypot(l[0] - alvo[0], l[1] - alvo[1], l[2] - alvo[2]) < 12) ambar++;
      }
      // faixa inferior: as últimas 4 % das linhas (sempre dentro da faixa sólida do selo)
      const y0 = Math.floor(im.altura * 0.96);
      let faixa = 0, texto = 0;
      for (let y = y0; y < im.altura; y++)
        for (let x = 0; x < im.largura; x++) {
          const i = y * im.largura + x;
          faixa++;
          if (Math.abs(im.dados[4 * i] - 0x1c) + Math.abs(im.dados[4 * i + 1] - 0x21) + Math.abs(im.dados[4 * i + 2] - 0x28) > 30) texto++;
        }
      return { ambar, fracTextoFaixa: texto / faixa, largura: im.largura, altura: im.altura };
    },
    [vista, estado] as const,
  );
}

test("modo foto no desenho B: antes idêntico, edição local, resposta ao volume, incerteza e selo nos pixels", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "roda uma vez (B)");
  test.setTimeout(10 * 60_000);
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  const e0 = await estadoFotos(page);
  // sem luz somada; contexto sem preservar o buffer (nada de captura do canvas)
  expect(e0).toMatchObject({ luzes: 0, preserveDrawingBuffer: false, envelope_visivel: true, pele_visivel: true, estado: "a" });
  expect(await page.evaluate(() => (window as any).__simuladorSim.fotos.contexto().preserveDrawingBuffer)).toBe(false);

  // ---- identidade do antes
  const h1 = await sha(page, "frente", "antes");
  const h2 = await sha(page, "frente", "antes");
  expect(h2, "determinismo").toBe(h1);
  expect(await sha(page, "frente", "a", 0), "A com peso 0 = antes (R ≡ 1)").toBe(h1);
  expect(await sha(page, "frente", "b", 0), "B com peso 0 = antes").toBe(h1);
  const hA = await sha(page, "frente", "a");
  expect(await sha(page, "frente", "a"), "determinismo do depois").toBe(hA);
  expect(hA).not.toBe(h1);
  // o quadro final (MSAA 4×, o que fica na tela em repouso) também é determinístico e igual com peso 0
  const f1 = await sha(page, "frente", "antes", undefined, FINAL);
  expect(await sha(page, "frente", "antes", undefined, FINAL)).toBe(f1);
  expect(await sha(page, "frente", "a", 0, FINAL)).toBe(f1);
  // o antes não depende do plano nem do sulco (mesma malha base nos 4 .glb)
  await page.getByTestId("plano-dual_plane").check();
  await page.getByTestId("imf-rebaixar").check();
  await esperarFotos(page);
  expect(await sha(page, "frente", "antes")).toBe(h1);
  await page.getByTestId("plano-subglandular").check();
  await page.getByTestId("imf-manter").check();
  await esperarFotos(page);

  // ---- localidade: fora da região (dilatada 3 px) nenhum pixel muda
  for (const v of ["frente", "obliqua_dir"] as const) {
    const l = await localidade(page, v, "a");
    console.log(`[foto] localidade ${v}: ${JSON.stringify(l)}`);
    expect(l.regiao, `${v}: região não vazia`).toBeGreaterThan(1000);
    expect(l.fracFora, `${v}: fração de pixels alterados fora da região`).toBeLessThanOrEqual(0.001);
  }

  // ---- resposta ao implante: no perfil D os dois "depois" crescem sobre o antes. Entre linhas
  // diferentes a silhueta de perfil segue a PROJEÇÃO, não o volume (B 255 mL tem 44 mm de projeção,
  // A 300 mL tem 39 mm); a ordem estrita por volume é conferida no teste seguinte, com a mesma linha.
  const area = { antes: await areaSilhueta(page, "perfil_dir", "antes"), b: await areaSilhueta(page, "perfil_dir", "b"), a: await areaSilhueta(page, "perfil_dir", "a") };
  console.log(`[foto] área da silhueta no perfil D (A = ${IMPLANTE_1}, B = ${IMPLANTE_2}): ${JSON.stringify(area)}`);
  expect(area.antes).toBeLessThan(area.b);
  expect(area.antes).toBeLessThan(area.a);
  const ap = await localidade(page, "frente", "a");
  expect(ap.mediaRegiao, "diferença média Antes × A dentro da máscara da região (AP), em níveis de 0–255").toBeGreaterThan(4);

  // ---- incerteza e selo em TODA imagem: âmbar ≥ 200 px no depois, 0 no antes; faixa do selo com texto
  const contagens: Record<string, number> = {};
  for (const v of ["frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq"] as const) {
    for (const e of ["antes", "a", "b"] as const) {
      const r = await ambarESelo(page, v, e);
      contagens[`${v}/${e}`] = r.ambar;
      if (e === "antes") expect(r.ambar, `${v}/${e}: sem âmbar no antes`).toBe(0);
      else expect(r.ambar, `${v}/${e}: pixels âmbar`).toBeGreaterThanOrEqual(200);
      expect(r.fracTextoFaixa, `${v}/${e}: texto na faixa do selo`).toBeGreaterThanOrEqual(0.02);
    }
  }
  console.log(`[foto] pixels âmbar: ${JSON.stringify(contagens)}`);
  await expect(page.getByTestId("foto-legenda")).toContainText("±4,5 mm");
  expect((await estadoFotos(page)).selo.join(" ")).toContain("ILUSTRAÇÃO — NÃO É PREVISÃO DE RESULTADO");

  // ---- transição: peso 0,3 já tem o envelope visível
  const t = await page.evaluate(() => (window as any).__simuladorSim.fotos.definirPeso(0.3));
  expect(t).toMatchObject({ peso: 0.3, envelope_visivel: true, pele_visivel: true });

  // ---- margem completa só acrescenta: estado() igual com e sem ela (cada troca redesenha o "depois")
  const campos = (e: Record<string, any>) => ({ alvo: e.alvo, peso: e.peso, envelope_mm: e.envelope_mm, envelope_visivel: e.envelope_visivel, pele_visivel: e.pele_visivel });
  let v0 = await versaoFotos(page);
  await page.getByTestId("foto-margem-completa").check();
  await esperarFotos(page, { versaoMaiorQue: v0 });
  const com = await estadoFotos(page);
  expect(com.margem_completa).toBe(true);
  v0 = await versaoFotos(page);
  await page.getByTestId("foto-margem-completa").uncheck();
  await esperarFotos(page, { versaoMaiorQue: v0 });
  const sem = await estadoFotos(page);
  expect(sem.margem_completa).toBe(false);
  expect(campos(com)).toEqual(campos(sem));
  expect(campos(sem)).toMatchObject({ alvo: `mt__${IMPLANTE_1}__subglandular__manter`, peso: 1, envelope_visivel: true, pele_visivel: true });
  expect(await sha(page, "frente", "antes"), "margem completa não toca o antes").toBe(h1);

  // ---- garantirEnvelope no modo foto: sem o halo, a foto "depois" não é mostrada
  await page.evaluate(() => (window as any).__simuladorSim.fotos.removerHalo());
  await expect(page.getByTestId("foto-erro")).toBeVisible();
  await expect(page.getByTestId("foto-erro")).toContainText("Simulação ocultada");
  const centro = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="foto-principal"] canvas') as HTMLCanvasElement;
    return Array.from(c.getContext("2d")!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data);
  });
  expect(centro.slice(0, 3), "canvas limpo (sem a foto depois)").toEqual(FUNDO);
  expect((await estadoFotos(page)).erro).toMatch(/envelope/);
  await page.evaluate(() => (window as any).__simuladorSim.fotos.restaurarHalo());
  await expect(page.getByTestId("foto-erro")).toHaveCount(0);
  await esperarFotos(page);
  expect((await estadoFotos(page)).envelope_visivel).toBe(true);
});

test("modo foto: resposta ao volume na mesma linha de implante — silhueta de perfil Antes < 245 mL < 300 mL", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "roda uma vez (B)");
  test.setTimeout(6 * 60_000);
  // mesma linha (Motiva Round SilkSurface Demi): volume e projeção crescem juntos
  await prepararSimulacao(page, ["motiva-rsd-300", "motiva-rsd-245"]);
  const area = { antes: await areaSilhueta(page, "perfil_dir", "antes"), b: await areaSilhueta(page, "perfil_dir", "b"), a: await areaSilhueta(page, "perfil_dir", "a") };
  console.log(`[foto] área da silhueta no perfil D (A = motiva-rsd-300, B = motiva-rsd-245): ${JSON.stringify(area)}`);
  expect(area.antes).toBeLessThan(area.b);
  expect(area.b).toBeLessThan(area.a);
  // AP: a foto do A (300 mL) muda dentro da região (diferença média > 4/255)
  expect((await localidade(page, "frente", "a")).mediaRegiao).toBeGreaterThan(4);
});

test("modo foto: cortina, segurar, lado a lado, vistas, apresentação com selo e aviso; nada se compartilha nem sai do navegador", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-B", "roda uma vez (B)");
  test.setTimeout(8 * 60_000);
  const imagensEnviadas: string[] = [];
  page.on("request", (r) => {
    const ct = r.headers()["content-type"] ?? "";
    const corpo = r.postDataBuffer();
    if (/^image\//i.test(ct) || (corpo && (corpo.includes("data:image") || corpo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))))) imagensEnviadas.push(`${r.method()} ${r.url()}`);
  });
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  const sim = page.getByTestId("simulacao");

  // CFM 2.336: nenhum botão, link ou texto de compartilhar/baixar imagem; texto sem jargão (C4)
  await expect(sim.getByRole("button", { name: PROIBIDO })).toHaveCount(0);
  await expect(sim.getByRole("link", { name: PROIBIDO })).toHaveCount(0);
  const texto = await sim.evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll("details").forEach((d) => d.remove());
    document.body.appendChild(c);
    const t = c.innerText;
    c.remove();
    return t;
  });
  expect(texto).not.toMatch(PROIBIDO);
  expect(texto).not.toMatch(JARGAO);

  // segurar para ver o antes
  const segurar = page.getByTestId("foto-segurar-antes");
  const b = (await segurar.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("foto-principal")).toHaveAttribute("data-estado", "antes");
  await page.mouse.up();
  await expect(page.getByTestId("foto-principal")).toHaveAttribute("data-estado", "a");

  // tira das 5 vistas
  for (const v of ["frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq"]) await expect(page.getByTestId(`foto-vista-${v}`)).toBeVisible();
  await page.getByTestId("foto-vista-perfil_dir").click();
  await esperarFotos(page);
  expect((await estadoFotos(page)).vista).toBe("perfil_dir");
  await page.getByTestId("foto-vista-frente").click();
  await esperarFotos(page);

  // cortina: alvo ≥ 44 px, teclado e arraste
  await page.getByTestId("foto-modo-cortina").click();
  await esperarFotos(page);
  const alca = page.getByTestId("foto-cortina");
  await expect(alca).toHaveAttribute("role", "slider");
  const ab = (await alca.boundingBox())!;
  expect(ab.width).toBeGreaterThanOrEqual(44);
  await alca.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(alca).toHaveAttribute("aria-valuenow", "54");
  const palco = (await page.getByTestId("foto-principal").boundingBox())!;
  await page.mouse.move(ab.x + ab.width / 2, palco.y + palco.height / 2);
  await page.mouse.down();
  await page.mouse.move(palco.x + palco.width * 0.25, palco.y + palco.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await alca.getAttribute("aria-valuenow"))).toBeLessThan(30);

  // lado a lado: Antes, A e B com o mesmo enquadramento
  await page.getByTestId("foto-modo-lado").click();
  await esperarFotos(page);
  for (const e of ["antes", "a", "b"]) await expect(page.getByTestId(`foto-lado-${e}`).locator("canvas")).toBeVisible();

  // modo apresentação: selo nos pixels e aviso dentro do quadro
  await page.getByTestId("foto-modo-foto").click();
  await esperarFotos(page);
  await page.getByTestId("foto-apresentacao").click();
  await expect(page.getByTestId("foto-comparador")).toHaveAttribute("data-apresentando", "1");
  await expect(page.getByTestId("foto-aviso-apresentacao")).toBeVisible();
  await expect(page.getByTestId("foto-aviso-apresentacao")).toContainText("Ilustração, não previsão de resultado");
  await expect(page.getByTestId("foto-legenda")).toBeVisible();
  await esperarFotos(page);
  const faixa = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="foto-principal"] canvas') as HTMLCanvasElement;
    const y = Math.floor(c.height * 0.97);
    const d = c.getContext("2d")!.getImageData(0, y, c.width, 1).data;
    let fundo = 0, texto = 0;
    for (let i = 0; i < c.width; i++) {
      const dif = Math.abs(d[4 * i] - 0x1c) + Math.abs(d[4 * i + 1] - 0x21) + Math.abs(d[4 * i + 2] - 0x28);
      if (dif < 6) fundo++;
      else texto++;
    }
    return { fundo, texto, largura: c.width };
  });
  expect(faixa.fundo, "faixa sólida do selo na apresentação").toBeGreaterThan(faixa.largura * 0.3);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("foto-comparador")).toHaveAttribute("data-apresentando", "0");

  // nada no DOM que baixe imagem
  expect(await page.locator("a[download]").count()).toBe(0);
  expect(imagensEnviadas, "nenhuma imagem sai do navegador").toEqual([]);
});

test("modo foto no desenho A: a ilustração existe, sem números calculados (diferenças, previsto, filtro pela base)", async ({ page }, info) => {
  test.skip(info.project.name !== "desenho-A", "desenho A");
  test.setTimeout(6 * 60_000);
  await prepararSimulacao(page, [IMPLANTE_1, IMPLANTE_2]);
  expect(await estadoFotos(page)).toMatchObject({ luzes: 0, envelope_visivel: true, estado: "a" });
  await expect(page.getByTestId("foto-legenda")).toContainText("±4,5 mm");
  for (const id of ["foto-diferencas", "previsto-simulacao", "catalogo-filtro-base"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await page.getByTestId("foto-estado-b").click();
  await esperarFotos(page, { estado: "b" });
  await page.getByTestId("foto-modo-lado").click();
  await esperarFotos(page);
  for (const id of ["foto-diferencas", "previsto-simulacao"]) await expect(page.getByTestId(id)).toHaveCount(0);
});
