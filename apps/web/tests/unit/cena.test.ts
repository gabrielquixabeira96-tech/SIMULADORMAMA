/**
 * Envelope de incerteza (restrição 3): a superfície simulada NUNCA aparece sem o envelope.
 * Estes testes falham se for possível obter/mostrar a pele simulada sem as marcas do envelope.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EnvelopeAusenteError, criarCenaSimulada, garantirEnvelope, geometriaOtimizada, indicesDeFrente, ordenarTriangulosCache } from "@/simulacao/cena";

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

/**
 * Otimizações de latência (plano A12): a malha desenhada tem de continuar a MESMA. A ordem de
 * cache só permuta triângulos/vértices; o descarte de costas só tira triângulos que a GPU
 * descartaria (de costas em qualquer peso do alvo).
 */
describe("latência: mesma geometria, menos trabalho", () => {
  const NOMES = ["mt__imp-a__subglandular__manter", "mt__imp-b__subglandular__manter"];

  /** Esfera (r = 100 mm) com 2 alvos que empurram a calota +Z (como uma mama) ao longo da normal. */
  function esferaComMorphs(embaralhar = false): THREE.Mesh {
    const g = new THREE.SphereGeometry(100, 48, 32);
    if (embaralhar) {
      // ordem de triângulos ruim para o cache (determinística)
      const idx = [...g.getIndex()!.array];
      const tris: number[][] = [];
      for (let t = 0; t < idx.length; t += 3) tris.push(idx.slice(t, t + 3));
      let s = 7;
      for (let i = tris.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) % 2 ** 31;
        const j = s % (i + 1);
        [tris[i], tris[j]] = [tris[j]!, tris[i]!];
      }
      g.setIndex(tris.flat());
    }
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const alvos = [30, 45].map((amp) => {
      const d = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = Math.max(0, (pos.getZ(i) - 40) / 60) * amp;
        d[3 * i] = nor.getX(i) * k;
        d[3 * i + 1] = nor.getY(i) * k - 0.2 * k;
        d[3 * i + 2] = nor.getZ(i) * k;
      }
      return new THREE.BufferAttribute(d, 3);
    });
    g.morphAttributes.position = alvos;
    g.morphAttributes.normal = alvos.map(() => new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    g.morphTargetsRelative = true;
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    m.updateMorphTargets();
    m.morphTargetDictionary = Object.fromEntries(NOMES.map((n, i) => [n, i]));
    return m;
  }

  /** Assinatura de cada triângulo pelos VALORES dos seus vértices (independe da numeração). */
  function assinaturas(g: THREE.BufferGeometry): string[] {
    const idx = g.getIndex()!.array;
    const attrs = [...Object.values(g.attributes), ...Object.values(g.morphAttributes).flat()] as THREE.BufferAttribute[];
    const v = (i: number) => attrs.map((a) => Array.from({ length: a.itemSize }, (_, c) => a.getComponent(i, c).toFixed(4)).join(",")).join("|");
    const out: string[] = [];
    for (let t = 0; t < idx.length; t += 3) out.push([v(idx[t]!), v(idx[t + 1]!), v(idx[t + 2]!)].join(" / "));
    return out.sort();
  }

  /** Falhas de cache por triângulo num cache FIFO de 16 vértices (ACMR). */
  function acmr(idx: ArrayLike<number>): number {
    const cache: number[] = [];
    let falhas = 0;
    for (let i = 0; i < idx.length; i++) {
      if (cache.includes(idx[i]!)) continue;
      falhas++;
      cache.push(idx[i]!);
      if (cache.length > 16) cache.shift();
    }
    return falhas / (idx.length / 3);
  }

  it("ordem de cache: mesmos triângulos (mesmo giro), menos falhas de cache", () => {
    const g = esferaComMorphs(true).geometry;
    const idx = g.getIndex()!.array;
    const novo = ordenarTriangulosCache(idx, g.getAttribute("position").count);
    const tris = (a: ArrayLike<number>) => Array.from({ length: a.length / 3 }, (_, t) => `${a[3 * t]},${a[3 * t + 1]},${a[3 * t + 2]}`).sort();
    expect(tris(novo)).toEqual(tris(idx));
    expect(acmr(novo)).toBeLessThan(0.8);
    expect(acmr(novo)).toBeLessThan(acmr(idx) / 2);
  });

  it("geometria otimizada: mesmos valores por triângulo (posição, normal, uv, deltas); memoizada", () => {
    const m = esferaComMorphs(true);
    const o = geometriaOtimizada(m.geometry);
    expect(assinaturas(o)).toEqual(assinaturas(m.geometry));
    expect(o.morphTargetsRelative).toBe(true);
    expect(geometriaOtimizada(m.geometry)).toBe(o);
  });

  it("descarte de costas é conservador: nunca tira triângulo de frente em peso nenhum", () => {
    const g = esferaComMorphs().geometry;
    const pos = g.getAttribute("position").array as Float32Array;
    const idx = g.getIndex()!.array;
    const saida = new Uint32Array(idx.length);
    for (const [olho, alvo] of [
      [new THREE.Vector3(0, -150, 900), 0],
      [new THREE.Vector3(700, 100, 500), 1],
      [new THREE.Vector3(0, -600, 200), 1],
    ] as const) {
      const delta = g.morphAttributes.position![alvo]!.array as Float32Array;
      const k = indicesDeFrente(idx, pos, delta, true, olho, saida);
      const mantidos = new Set<string>();
      for (let i = 0; i < k; i += 3) mantidos.add(`${saida[i]},${saida[i + 1]},${saida[i + 2]}`);
      expect(k / 3).toBeLessThan(0.7 * (idx.length / 3)); // descarta de fato (~metade da esfera)
      const p = (i: number, w: number) => new THREE.Vector3(pos[3 * i]! + w * delta[3 * i]!, pos[3 * i + 1]! + w * delta[3 * i + 1]!, pos[3 * i + 2]! + w * delta[3 * i + 2]!);
      for (let t = 0; t < idx.length; t += 3) {
        if (mantidos.has(`${idx[t]},${idx[t + 1]},${idx[t + 2]}`)) continue;
        for (let w = 0; w <= 1.0001; w += 0.05) {
          const a = p(idx[t]!, w), b = p(idx[t + 1]!, w), c = p(idx[t + 2]!, w);
          const n = b.clone().sub(a).cross(c.clone().sub(a));
          // de costas (ou de perfil) para o olho: a GPU o descartaria (FrontSide)
          expect(n.dot(olho.clone().sub(a))).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("cena: atualizarVista reduz o índice da pele, null volta ao completo; casca não muda", () => {
    const c = criarCenaSimulada(esferaComMorphs(), 4.5, () => true);
    c.definir(NOMES[0]!, 1);
    const g = c.pele.geometry;
    const total = g.getIndex()!.count;
    const casca = c.cascas[0].geometry.getIndex()!.count;
    c.atualizarVista(new THREE.Vector3(0, -150, 900));
    expect(g.drawRange.count).toBeLessThan(0.7 * total);
    expect(g.drawRange.count % 3).toBe(0);
    expect(c.cascas[0].geometry.getIndex()!.count).toBe(casca);
    const frente = g.drawRange.count;
    // de trás: outro conjunto (a calota deformada fica de costas)
    c.atualizarVista(new THREE.Vector3(0, 0, -900));
    expect(g.drawRange.count).not.toBe(frente);
    // troca de alvo refaz o descarte (o alvo B empurra mais)
    c.atualizarVista(new THREE.Vector3(0, -150, 900));
    c.definir(NOMES[1]!, 0.5);
    expect(g.drawRange.count).toBeGreaterThanOrEqual(frente);
    c.atualizarVista(null);
    expect(g.getIndex()!.count).toBe(total);
    expect(g.drawRange.count).toBe(Infinity);
    expect(c.estado()).toMatchObject({ envelope_visivel: true, pele_visivel: true });
  });
});
