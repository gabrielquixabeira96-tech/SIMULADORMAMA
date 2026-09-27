/**
 * Envelope de incerteza (restrição 3): a superfície simulada NUNCA aparece sem o envelope.
 * Estes testes falham se for possível obter/mostrar a pele simulada sem as marcas do envelope.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EnvelopeAusenteError, criarCenaSimulada, garantirEnvelope } from "@/simulacao/cena";

/** Malha pequena com 2 targets: um que desloca 2 vértices em +Z (5 mm) e um lateral (dir). */
function malhaComMorphs(): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  // grade 3x3 no plano z=0
  const pos: number[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) pos.push(i * 10, j * 10, 0);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(27).fill(0).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  const idx: number[] = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const a = j * 3 + i;
    idx.push(a, a + 1, a + 4, a, a + 4, a + 3);
  }
  g.setIndex(idx);
  const delta = new Float32Array(27);
  delta[4 * 3 + 2] = 5; // vértice central
  const delta2 = new Float32Array(27);
  delta2[0 * 3 + 2] = 5;
  g.morphAttributes.position = [new THREE.BufferAttribute(delta, 3), new THREE.BufferAttribute(delta2, 3)];
  g.morphAttributes.normal = [new THREE.BufferAttribute(new Float32Array(27), 3), new THREE.BufferAttribute(new Float32Array(27), 3)];
  g.morphTargetsRelative = true;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  m.updateMorphTargets();
  m.morphTargetDictionary = { "mt__imp-a__dual_plane__manter": 0, "mt__imp-a__dual_plane__manter__dir": 1 };
  return m;
}

describe("cena simulada", () => {
  it("recusa envelope ausente/zero/NaN (não existe simulação sem envelope)", () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => criarCenaSimulada(malhaComMorphs(), v)).toThrow(EnvelopeAusenteError);
  });

  it("pele e envelope nascem juntos: casca +envelope e faixa na pele", () => {
    const c = criarCenaSimulada(malhaComMorphs(), 4.5);
    expect(c.grupo.children).toContain(c.pele);
    expect(c.cascas).toHaveLength(1);
    expect(c.grupo.children).toContain(c.cascas[0]);
    expect((c.cascas[0].material as THREE.Material).userData.deslocMm).toBe(4.5);
    expect(c.envelopeMm).toBe(4.5);
  });

  it("só usa os targets bilaterais por padrão (lados separados ficam fora)", () => {
    const c = criarCenaSimulada(malhaComMorphs(), 4.5);
    expect(c.nomesTargets).toEqual(["mt__imp-a__dual_plane__manter"]);
    expect(() => c.definir("mt__imp-a__dual_plane__manter__dir", 1)).toThrow(/inexistente/);
  });

  it("peso > 0 → influência aplicada e envelope visível; peso 0 = 'antes' (sem simulação)", () => {
    const c = criarCenaSimulada(malhaComMorphs(), 4.5);
    c.definir("mt__imp-a__dual_plane__manter", 0.4);
    expect(c.pele.morphTargetInfluences).toEqual([0.4]);
    expect(c.cascas[0].morphTargetInfluences).toEqual([0.4]);
    expect(c.estado()).toMatchObject({ peso: 0.4, envelope_mm: 4.5, envelope_visivel: true, pele_visivel: true });
    // casca só sobre os triângulos deformados: os 6 (de 8) que contêm o vértice central
    const tri = (c.cascas[0].geometry.getIndex()!.count ?? 0) / 3;
    expect(tri).toBeGreaterThan(0);
    expect(tri).toBeLessThan(8);
    c.definir("mt__imp-a__dual_plane__manter", 0);
    expect(c.estado().envelope_visivel).toBe(false);
    expect(() => garantirEnvelope(c)).not.toThrow();
  });

  it("FALHA se a pele simulada ficar sem envelope: esconder a casca derruba a pele e lança", () => {
    const c = criarCenaSimulada(malhaComMorphs(), 4.5);
    c.definir("mt__imp-a__dual_plane__manter", 1);
    expect(() => garantirEnvelope(c)).not.toThrow();
    c.cascas[0].visible = false; // simula regressão: alguém esconde o envelope
    expect(() => garantirEnvelope(c)).toThrow(EnvelopeAusenteError);
    expect(c.pele.visible).toBe(false);
  });

  it("FALHA se a casca sair do grupo", () => {
    const c = criarCenaSimulada(malhaComMorphs(), 4.5);
    c.definir("mt__imp-a__dual_plane__manter", 1);
    c.grupo.remove(c.cascas[0]);
    expect(() => garantirEnvelope(c)).toThrow(EnvelopeAusenteError);
  });

  it("mostrar() esconde pele e envelope juntos", () => {
    const c = criarCenaSimulada(malhaComMorphs(), 4.5);
    c.mostrar(false);
    expect(c.grupo.visible).toBe(false);
    c.mostrar(true);
    expect(c.grupo.visible).toBe(true);
  });
});
