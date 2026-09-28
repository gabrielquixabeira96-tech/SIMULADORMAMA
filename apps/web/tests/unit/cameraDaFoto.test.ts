/**
 * Câmera da foto real (plano "foto → 3D", P3-lite; C1): a PerspectiveCamera montada de K, R, t
 * projeta cada ponto 3D no MESMO pixel que a câmera pinhole do contrato (≤ 0,5 px; na prática
 * ~1e-6), inclusive com fx ≠ fy, ponto principal fora do centro, cisalhamento, foto encaixada num
 * quadro de outra proporção e erro de registro simulado. A textura projetiva (uv da foto) é a
 * mesma conta.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  CameraDaFoto,
  cameraDaFoto,
  centroDaCamera,
  encaixeDaFoto,
  matrizTexturaFoto,
  pixelDaFoto,
  pixelNoQuadro,
  planosParaEsfera,
  uvDaFoto,
  type ParametrosCameraFoto,
} from "@/simulacao/cameraDaFoto";

/** Gerador determinístico (mulberry32). */
function rng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** R coluna-major (9) a partir de um quaternion. */
function rColunaMajor(q: THREE.Quaternion): number[] {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements; // coluna-major 4×4
  return [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!];
}

/** Câmera frontal "clínica" do t01: olha para −z anatômico, x da imagem = +x anatômico (esquerda da paciente). */
const FRENTE: ParametrosCameraFoto = {
  K: [2734.5, 0, 0, 0, 2734.5, 0, 480, 360, 1],
  R: [1, 0, 0, 0, -1, 0, 0, 0, -1],
  t: [0, -165, 1350],
  largura_px: 960,
  altura_px: 720,
};

function cameraAleatoria(r: () => number): ParametrosCameraFoto {
  const W = 800 + Math.round(r() * 1200), H = 600 + Math.round(r() * 900);
  const fx = 1500 + r() * 2500, fy = fx * (0.97 + r() * 0.06);
  const K = [fx, 0, 0, (r() - 0.5) * 4, fy, 0, W / 2 + (r() - 0.5) * 80, H / 2 + (r() - 0.5) * 80, 1];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.6, Math.PI + (r() - 0.5) * 1.6, (r() - 0.5) * 0.3));
  // câmera a ~1,2–1,6 m da origem, olhando para ela
  const R = rColunaMajor(q);
  const d = 1200 + r() * 400;
  const t = [(r() - 0.5) * 40, (r() - 0.5) * 40, d];
  return { K, R, t, largura_px: W, altura_px: H };
}

/** Pontos numa caixa de torso (mm) em volta da origem. */
function pontos(r: () => number, n: number): number[][] {
  return Array.from({ length: n }, () => [(r() - 0.5) * 330, (r() - 0.5) * 450, (r() - 0.5) * 210]);
}

describe("cameraDaFoto", () => {
  it("projeta pontos 3D no pixel de K, R, t (≤ 0,5 px) — 50 câmeras × 200 pontos", () => {
    const r = rng(7);
    let pior = 0;
    for (let c = 0; c < 50; c++) {
      const p = cameraAleatoria(r);
      const cam = cameraDaFoto(p, p.largura_px, p.altura_px, { centro: [0, 0, 0], raio: 300 });
      for (const X of pontos(r, 200)) {
        const ref = pixelDaFoto(p, X);
        if (!ref) continue;
        const [u, v] = pixelNoQuadro(cam, X, p.largura_px, p.altura_px);
        pior = Math.max(pior, Math.hypot(u - ref[0], v - ref[1]));
      }
    }
    expect(pior).toBeLessThan(0.5);
    expect(pior).toBeLessThan(1e-3); // exata a menos do arredondamento
  });

  it("orientação clínica: esquerda da paciente à direita da imagem, cranial para cima, profundidade positiva", () => {
    const o = pixelDaFoto(FRENTE, [0, -165, 0])!;
    expect(o[0]).toBeCloseTo(480, 6);
    expect(o[1]).toBeCloseTo(360, 6);
    expect(pixelDaFoto(FRENTE, [50, -165, 0])![0]).toBeGreaterThan(480);
    expect(pixelDaFoto(FRENTE, [0, -100, 0])![1]).toBeLessThan(360);
    expect(pixelDaFoto(FRENTE, [0, 0, 5000])).toBeNull(); // atrás da câmera
    expect(centroDaCamera(FRENTE).map((v) => v + 0)).toEqual([0, -165, 1350]); // C = −Rᵀ·t
    const cam = cameraDaFoto(FRENTE, 960, 720);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    expect(dir.z).toBeCloseTo(-1, 9);
  });

  it("foto encaixada num quadro menor e de outra proporção: pixel do quadro = u·s + deslocamento", () => {
    const r = rng(11);
    for (const [w, h] of [
      [480, 360],
      [640, 360],
      [300, 400],
    ] as const) {
      const e = encaixeDaFoto(FRENTE.largura_px, FRENTE.altura_px, w, h);
      const cam = cameraDaFoto(FRENTE, w, h);
      for (const X of pontos(r, 50)) {
        const [u, v] = pixelDaFoto(FRENTE, X)!;
        const [uq, vq] = pixelNoQuadro(cam, X, w, h);
        expect(Math.abs(uq - (u * e.escala + e.x))).toBeLessThan(1e-3);
        expect(Math.abs(vq - (v * e.escala + e.y))).toBeLessThan(1e-3);
      }
    }
  });

  it("near/far pela esfera e updateProjectionMatrix() não desfazem a projeção de K", () => {
    const p = cameraAleatoria(rng(3));
    const cam = cameraDaFoto(p, p.largura_px, p.altura_px, { centro: [0, 0, 0], raio: 250 });
    const pl = planosParaEsfera(p, [0, 0, 0], 250);
    expect(cam.near).toBeCloseTo(pl.near, 9);
    expect(cam.far).toBeCloseTo(pl.far, 9);
    const X = [20, -30, 40];
    const antes = pixelNoQuadro(cam, X, p.largura_px, p.altura_px);
    cam.far = 20000;
    cam.near = 5;
    cam.updateProjectionMatrix();
    const depois = pixelNoQuadro(cam, X, p.largura_px, p.altura_px);
    expect(Math.hypot(antes[0] - depois[0], antes[1] - depois[1])).toBeLessThan(1e-6);
    // um ponto na esfera fica entre near e far
    const v = new THREE.Vector3(0, 0, 250).applyMatrix4(cam.matrixWorldInverse);
    expect(-v.z).toBeGreaterThan(cam.near);
    expect(-v.z).toBeLessThan(cam.far);
  });

  it("erro de registro simulado desloca a imagem exatamente dx, dy px da foto", () => {
    const cam0 = cameraDaFoto(FRENTE, 480, 360);
    const cam5 = cameraDaFoto(FRENTE, 480, 360, null, { dx: 5, dy: -5 });
    const X = [40, -150, 50];
    const a = pixelNoQuadro(cam0, X, 480, 360), b = pixelNoQuadro(cam5, X, 480, 360);
    expect(b[0] - a[0]).toBeCloseTo(2.5, 6); // 5 px da foto × escala 0,5
    expect(b[1] - a[1]).toBeCloseTo(-2.5, 6);
    cam5.ajustar(960, 720, null);
    const c = pixelNoQuadro(cam5, X, 960, 720);
    const ref = pixelDaFoto(FRENTE, X)!;
    expect(Math.hypot(c[0] - ref[0], c[1] - ref[1])).toBeLessThan(1e-3);
  });

  it("textura projetiva: uv da foto = u/W, v/H da posição original (coordenadas contínuas do C1)", () => {
    const r = rng(5);
    for (let c = 0; c < 10; c++) {
      const p = cameraAleatoria(r);
      const m = matrizTexturaFoto(p);
      for (const X of pontos(r, 50)) {
        const ref = pixelDaFoto(p, X);
        if (!ref) continue;
        const [s, t] = uvDaFoto(m, X);
        expect(Math.abs(s * p.largura_px - ref[0])).toBeLessThan(1e-3);
        expect(Math.abs(t * p.altura_px - ref[1])).toBeLessThan(1e-3);
      }
    }
    const [s0, t0] = uvDaFoto(matrizTexturaFoto(FRENTE, { dx: 5, dy: 0 }), [0, -165, 0]);
    expect(s0 * 960).toBeCloseTo(485, 6);
    expect(t0 * 720).toBeCloseTo(360, 6);
  });

  it("recusa K linha-major, R que não é rotação e tamanho inválido", () => {
    expect(() => new CameraDaFoto({ ...FRENTE, K: [2734.5, 0, 480, 0, 2734.5, 360, 0, 0, 1] }, 960, 720)).toThrow(/coluna-major/);
    expect(() => new CameraDaFoto({ ...FRENTE, R: [-1, 0, 0, 0, -1, 0, 0, 0, -1] }, 960, 720)).toThrow(/rotação/);
    expect(() => new CameraDaFoto({ ...FRENTE, largura_px: 0 }, 960, 720)).toThrow();
    expect(() => encaixeDaFoto(960, 720, 0, 10)).toThrow();
  });
});
