/**
 * Selo gravado nos pixels (ADR 0019; CFM 2.336/2023): texto do aviso, faixa sólida inferior com
 * texto branco ≥ 16 px e contraste > 7:1, marca diagonal a 8 %, versão compacta das miniaturas e
 * nenhuma promessa de resultado.
 */
import { describe, expect, it } from "vitest";
import {
  ALFA_MARCA_DIAGONAL,
  COR_FAIXA_SELO,
  COR_TEXTO_SELO,
  FONTE_MIN_PX,
  contrasteWcag,
  desenharSelo,
  FRACAO_MAX_FAIXA,
  linhasDoSelo,
  quebrarLinha,
  type Contexto2D,
} from "@/simulacao/marcaDagua";

const PROMESSA = /resultado esperado|você ficará|voce ficara|previsão de aparência|garant/i;

/** Contexto 2D falso: registra as chamadas; largura do texto = 0,55·px por caractere. */
function contextoFalso() {
  const chamadas: Array<{ op: string; args: unknown[]; estado: { font: string; fillStyle: unknown; globalAlpha: number } }> = [];
  const pilha: Array<{ font: string; fillStyle: unknown; globalAlpha: number }> = [];
  const ctx = {
    font: "10px sans-serif",
    fillStyle: "#000000" as string,
    globalAlpha: 1,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "start" as CanvasTextAlign,
    save() {
      pilha.push({ font: ctx.font, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha });
    },
    restore() {
      Object.assign(ctx, pilha.pop());
    },
    fillRect(...args: number[]) {
      chamadas.push({ op: "fillRect", args, estado: { font: ctx.font, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha } });
    },
    fillText(...args: unknown[]) {
      chamadas.push({ op: "fillText", args, estado: { font: ctx.font, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha } });
    },
    measureText(t: string) {
      const px = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: t.length * px * 0.55 };
    },
    translate() {},
    rotate(a: number) {
      chamadas.push({ op: "rotate", args: [a], estado: { font: ctx.font, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha } });
    },
  };
  return { ctx: ctx as Contexto2D, chamadas };
}

describe("selo nos pixels", () => {
  const base = { envelopeMm: 4.5, versao: "0.2.0", demo: false };

  it("linhas: aviso, não generativa, não calibrado, faixa ±4,5 mm e versão; demo acrescenta o torso sintético", () => {
    const l = linhasDoSelo(base);
    expect(l[0]).toBe("ILUSTRAÇÃO — NÃO É PREVISÃO DE RESULTADO");
    expect(l.join(" · ")).toBe("ILUSTRAÇÃO — NÃO É PREVISÃO DE RESULTADO · simulação geométrica não generativa · modelo não calibrado · faixa ±4,5 mm · v0.2.0");
    expect(l.join(" ")).not.toMatch(/DEMONSTRAÇÃO/);
    const d = linhasDoSelo({ ...base, demo: true });
    expect(d).toContain("DEMONSTRAÇÃO — TORSO SINTÉTICO");
    const c = linhasDoSelo({ ...base, demo: true }, { compacto: true });
    expect(c.join(" ")).toMatch(/ILUSTRAÇÃO — NÃO É PREVISÃO/);
    expect(c.join(" ")).toContain("±4,5 mm");
    expect(c).toContain("DEMONSTRAÇÃO — TORSO SINTÉTICO");
    for (const x of [l, d, c]) expect(x.join(" ")).not.toMatch(PROMESSA);
  });

  it("faixa inferior sólida #1c2128 com texto branco ≥ 16 px (contraste > 7:1)", () => {
    expect(contrasteWcag(COR_TEXTO_SELO, COR_FAIXA_SELO)).toBeGreaterThan(7);
    for (const [w, h] of [
      [960, 720],
      [320, 240],
      [1920, 1440],
    ] as const) {
      const { ctx, chamadas } = contextoFalso();
      const r = desenharSelo(ctx, w, h, linhasDoSelo({ ...base, demo: true }, { compacto: w < 400 }));
      const faixa = chamadas.filter((c) => c.op === "fillRect");
      expect(faixa).toHaveLength(1);
      expect(faixa[0]!.estado.fillStyle).toBe(COR_FAIXA_SELO);
      expect(faixa[0]!.estado.globalAlpha).toBe(1);
      expect(faixa[0]!.args).toEqual([0, h - r.alturaFaixa, w, r.alturaFaixa]);
      const textosFaixa = chamadas.filter((c) => c.op === "fillText" && c.estado.globalAlpha === 1);
      expect(textosFaixa.length).toBeGreaterThanOrEqual(w < 400 ? 2 : 3); // compacto: aviso em 1 linha + demo
      for (const t of textosFaixa) {
        expect(t.estado.fillStyle).toBe(COR_TEXTO_SELO);
        expect(Number(/(\d+)px/.exec(t.estado.font)![1])).toBeGreaterThanOrEqual(FONTE_MIN_PX);
        // dentro da faixa e da largura
        expect(t.args[2] as number).toBeGreaterThanOrEqual(h - r.alturaFaixa);
        expect((t.args[0] as string).length * r.fontePx * 0.55).toBeLessThanOrEqual(w);
      }
      // o texto da faixa, junto, é o selo inteiro (nada cortado)
      expect(textosFaixa.map((t) => t.args[0]).join(" ")).toContain("NÃO É PREVISÃO");
      expect(r.alturaFaixa).toBeLessThanOrEqual(h * FRACAO_MAX_FAIXA);
    }
  });

  it("a faixa nunca passa de 30 % da altura: foto estreita abrevia para a versão compacta, e o aviso nunca some", () => {
    for (const [w, h] of [
      [370, 277],
      [300, 225],
      [240, 180],
      [160, 120],
    ] as const) {
      const { ctx, chamadas } = contextoFalso();
      const cfg = { ...base, demo: true };
      const r = desenharSelo(ctx, w, h, linhasDoSelo(cfg), 1, linhasDoSelo(cfg, { compacto: true }));
      expect(r.alturaFaixa, `${w}x${h}`).toBeLessThanOrEqual(h * FRACAO_MAX_FAIXA);
      const textos = chamadas.filter((c) => c.op === "fillText" && c.estado.globalAlpha === 1).map((c) => c.args[0] as string);
      expect(textos.length, `${w}x${h}`).toBeGreaterThanOrEqual(1);
      expect(textos.join(" "), `${w}x${h}`).toMatch(/ILUSTRAÇÃO/);
      for (const t of chamadas.filter((c) => c.op === "fillText" && c.estado.globalAlpha === 1)) expect(Number(/(\d+)px/.exec(t.estado.font)![1])).toBeGreaterThanOrEqual(FONTE_MIN_PX);
    }
    // compacto: o aviso numa linha só
    expect(linhasDoSelo(base, { compacto: true })).toEqual(["ILUSTRAÇÃO — NÃO É PREVISÃO · ±4,5 mm"]);
  });

  it("escala: o quadro interativo reduzido e o final em dpr 2 têm o mesmo desenho relativo (≥ 16 px de referência)", () => {
    const alturas = [0.5, 1, 2].map((e) => {
      const { ctx } = contextoFalso();
      const r = desenharSelo(ctx, 960 * e, 720 * e, linhasDoSelo(base), e);
      expect(r.fontePx / e).toBeGreaterThanOrEqual(FONTE_MIN_PX);
      return r.alturaFaixa / (720 * e);
    });
    for (const a of alturas) expect(a).toBeCloseTo(alturas[1]!, 1);
  });

  it("marca diagonal repetida a 8 % sobre a imagem (recortar a faixa não apaga o aviso)", () => {
    const { ctx, chamadas } = contextoFalso();
    desenharSelo(ctx, 960, 720, linhasDoSelo(base));
    const rot = chamadas.find((c) => c.op === "rotate");
    expect(rot!.args[0]).toBeCloseTo(-Math.PI / 6, 9);
    const marcas = chamadas.filter((c) => c.op === "fillText" && c.estado.globalAlpha === ALFA_MARCA_DIAGONAL);
    expect(ALFA_MARCA_DIAGONAL).toBe(0.08);
    expect(marcas.length).toBeGreaterThan(10);
    expect(marcas.every((m) => /ILUSTRAÇÃO/.test(m.args[0] as string))).toBe(true);
    // a marca vem antes da faixa (a faixa fica por cima)
    expect(chamadas.findIndex((c) => c.op === "fillRect")).toBeGreaterThan(chamadas.indexOf(marcas.at(-1)!));
  });

  it("quebra linhas longas nos separadores ' · ' sem perder texto", () => {
    const { ctx } = contextoFalso();
    ctx.font = "500 16px x";
    const t = "simulação geométrica não generativa · modelo não calibrado · faixa ±4,5 mm · v0.2.0";
    const partes = quebrarLinha(ctx, t, 300);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(ctx.measureText(p).width).toBeLessThanOrEqual(300);
    expect(partes.join(" ")).toBe(t);
  });
});
