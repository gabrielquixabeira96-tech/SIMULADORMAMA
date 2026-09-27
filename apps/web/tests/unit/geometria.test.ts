import type { Landmarks, Vetor3 } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { EscalaInvalidaError, aplicarMatriz, distanciaEuclidiana, distanciasEuclidianas, fatorRegua, quadroAnatomico } from "@/medidas/geometria";

const lm = (p: Vetor3, v = 0) => ({ posicao: p, vertice: v, origem: "clique" as const });

// Torso "de gabarito" simples, em mm, no quadro anatômico (furcula na origem).
const L: Landmarks = {
  furcula: lm([0, 0, 0]),
  mamilo_dir: lm([-95, -190, 90]),
  mamilo_esq: lm([95, -190, 90]),
  sulco_dir: lm([-95, -260, 60]),
  sulco_esq: lm([95, -260, 60]),
  linha_media_inferior: lm([0, -260, 40]),
};

describe("distâncias euclidianas (contratos §3.1)", () => {
  it("valores conhecidos, arredondados a 0,01 mm", () => {
    const d = distanciasEuclidianas(L);
    expect(d.intermamilar).toBe(190);
    expect(d.ssn_n_dir).toBeCloseTo(Math.hypot(95, 190, 90), 2);
    expect(d.ssn_n_dir).toBe(d.ssn_n_esq);
    expect(d.n_imf_dir).toBe(Math.round(Math.hypot(70, 30) * 100) / 100);
  });

  it("base ausente → null (sem os 4 landmarks da base)", () => {
    const d = distanciasEuclidianas(L);
    expect(d.base_dir).toBeNull();
    expect(d.base_esq).toBeNull();
    const d2 = distanciasEuclidianas({ ...L, base_medial_dir: lm([-40, -190, 70]), base_lateral_dir: lm([-160, -190, 50]) });
    expect(d2.base_dir).toBeCloseTo(Math.hypot(120, 20), 2);
    expect(d2.base_esq).toBeNull();
  });

  it("escala em mm: régua de 100 mm dá 100,00 mm", () => {
    expect(distanciaEuclidiana([10, 20, 30], [10, 120, 30])).toBe(100);
  });
});

describe("quadro anatômico (contratos §1.1)", () => {
  it("é identidade para torso já no quadro anatômico e simétrico", () => {
    const q = quadroAnatomico(L)!;
    expect(q.origem).toEqual([0, 0, 0]);
    // y ≈ cranial; x ≈ esquerda da paciente; z anterior e ortogonal
    expect(q.x[0]).toBeGreaterThan(0.99);
    expect(q.y[1]).toBeGreaterThan(0.98);
    expect(q.matriz).toHaveLength(16);
  });

  it("matriz coluna-major leva a furcula à origem e o mamilo esquerdo para +X", () => {
    const deslocado: Landmarks = Object.fromEntries(
      Object.entries(L).map(([k, v]) => [k, lm([v!.posicao[0] + 500, v!.posicao[1] + 1000, v!.posicao[2] - 30])]),
    );
    const q = quadroAnatomico(deslocado)!;
    const f = aplicarMatriz(q.matriz, deslocado.furcula!.posicao);
    f.forEach((c) => expect(Math.abs(c)).toBeLessThan(1e-9));
    const me = aplicarMatriz(q.matriz, deslocado.mamilo_esq!.posicao);
    expect(me[0]).toBeGreaterThan(0);
    expect(me[1]).toBeLessThan(0);
    // preserva distâncias (rotação rígida)
    const md = aplicarMatriz(q.matriz, deslocado.mamilo_dir!.posicao);
    expect(distanciaEuclidiana(me, md)).toBeCloseTo(190, 9);
  });

  it("null se faltar landmark obrigatório do quadro", () => {
    const { linha_media_inferior: _x, ...sem } = L;
    void _x;
    expect(quadroAnatomico(sem)).toBeNull();
  });
});

describe("calibração por régua (ADR 0003 item 4)", () => {
  it("fator = regua_mm / |p2 − p1|", () => {
    expect(fatorRegua([0, 0, 0], [0, 0.1, 0], 100)).toBeCloseTo(1000, 9); // malha em metros
    expect(fatorRegua([0, 0, 0], [98.7, 0, 0], 100)).toBeCloseTo(100 / 98.7, 12);
  });
  it("recusa pontos coincidentes, comprimento inválido e fator absurdo", () => {
    expect(() => fatorRegua([1, 1, 1], [1, 1, 1], 100)).toThrow(EscalaInvalidaError);
    expect(() => fatorRegua([0, 0, 0], [1, 0, 0], 0)).toThrow(EscalaInvalidaError);
    expect(() => fatorRegua([0, 0, 0], [1, 0, 0], -5)).toThrow(EscalaInvalidaError);
    expect(() => fatorRegua([0, 0, 0], [0.00001, 0, 0], 100)).toThrow(/fora da faixa/);
  });
});
