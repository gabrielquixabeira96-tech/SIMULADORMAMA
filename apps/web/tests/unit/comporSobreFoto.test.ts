/**
 * Compósito da vista "Foto real" (plano "foto → 3D", P3-lite): o desenho da malha (alvo sRGB com
 * alfa, cor pré-multiplicada em linear, linhas de baixo para cima) sobre os pixels da foto. Alfa 0
 * não toca a foto (identidade byte a byte fora da região simulada); alfa 255 é o pixel da malha;
 * alfa parcial mistura em linear.
 */
import { describe, expect, it } from "vitest";
import { comporSobreFoto, ehVistaFotoReal, vistaDaFotoReal } from "@/simulacao/RenderizadorFotos";

const lin = (b: number) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const srgb = (l: number) => Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055) * 255);

describe("comporSobreFoto", () => {
  it("alfa 0 em toda a malha: a foto sai idêntica e nenhum pixel conta como alterado", () => {
    const w = 7, h = 5;
    const foto = Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i * 37) % 256);
    const antes = foto.slice();
    const malha = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 0 : 200)); // cor sem cobertura: ignorada
    expect(comporSobreFoto(foto, malha, w, h)).toBe(0);
    expect(foto).toEqual(antes);
  });

  it("alfa 255 = o pixel da malha; linhas da GPU (de baixo para cima) vão para a linha certa da foto", () => {
    const w = 3, h = 2;
    const foto = new Uint8ClampedArray(w * h * 4).fill(10);
    const malha = new Uint8Array(w * h * 4);
    // pixel (x=1, y=0 da GPU) = linha de BAIXO da foto (y = 1)
    malha.set([250, 120, 30, 255], (0 * w + 1) * 4);
    expect(comporSobreFoto(foto, malha, w, h)).toBe(1);
    expect([...foto.slice((1 * w + 1) * 4, (1 * w + 1) * 4 + 3)]).toEqual([250, 120, 30]);
    expect([...foto.slice((0 * w + 1) * 4, (0 * w + 1) * 4 + 3)]).toEqual([10, 10, 10]);
    // alfa da foto intocado
    expect(foto[(1 * w + 1) * 4 + 3]).toBe(10);
  });

  it("alfa parcial: mistura em linear (malha pré-multiplicada + foto × (1 − a))", () => {
    const foto = new Uint8ClampedArray([200, 100, 50, 255]);
    const a = 128;
    const cor = [30, 200, 90].map((c) => srgb(lin(c) * (a / 255))); // o que a GPU grava (sRGB de linear pré-multiplicado)
    const malha = new Uint8Array([...cor, a]);
    comporSobreFoto(foto, malha, 1, 1);
    const esperado = [0, 1, 2].map((k) => srgb(lin(cor[k]!) + lin([200, 100, 50][k]!) * (1 - a / 255)));
    expect([...foto.slice(0, 3)]).toEqual(esperado);
  });

  it("vistas da foto real: foto:<vista>", () => {
    expect(ehVistaFotoReal("foto:frente")).toBe(true);
    expect(ehVistaFotoReal("frente")).toBe(false);
    expect(vistaDaFotoReal("foto:perfil_dir")).toBe("perfil_dir");
  });
});
