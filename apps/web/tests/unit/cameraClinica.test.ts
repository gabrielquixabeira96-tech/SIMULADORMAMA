/**
 * Câmera de fotografia clínica (ADR 0019): AP ao longo de −z anatômico para o centro dos mamilos,
 * oblíquas = paciente girada ±45° em torno de y, perfis a 90°, limites do enquadramento dentro do
 * frustum, determinística; com os landmarks do t01 (quadro anatômico ≈ quadro do arquivo) a AP
 * coincide com a vista "frente" do viewer a menos do FOV.
 */
import type { Landmarks } from "@simulador/contratos";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ASPECTO_CLINICO,
  FOV_CLINICO_GRAUS,
  MARGEM_ABAIXO_SULCO_MM,
  MARGEM_ACIMA_FURCULA_MM,
  VISTAS_CLINICAS,
  camerasClinicas,
  quadroClinico,
  type CameraClinica,
} from "@/simulacao/cameraClinica";
import { VISTAS } from "@/viewer/vistas";

type V3 = [number, number, number];
const lm = (p: V3, vertice = 0) => ({ posicao: p, vertice, origem: "gabarito" as const });

/** Landmarks do torso sintético t01_simetrico_300 (gabarito.json gerado pelo services/mesh). */
const T01: Landmarks = {
  furcula: lm([0, 0, 0]),
  mamilo_dir: lm([-94.9171, -165.0, 54.6808]),
  mamilo_esq: lm([94.9171, -165.0, 54.6807]),
  sulco_dir: lm([-82.335, -235.0, -0.8479]),
  sulco_esq: lm([82.335, -235.0, -0.8479]),
  linha_media_inferior: lm([0, -235.0, 5.0]),
};
const CAIXA_T01 = { min: [-165, -330, -120] as V3, max: [165, 120, 90] as V3 };

/** Rotação (Rodrigues) de p em torno do eixo unitário k por t radianos. */
function girar(p: V3, k: V3, t: number): V3 {
  const v = new THREE.Vector3(...p).applyAxisAngle(new THREE.Vector3(...k).normalize(), t);
  return [v.x, v.y, v.z];
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const grausEntre = (a: V3, b: V3) => (Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b))))) * 180) / Math.PI;

function camera3(c: CameraClinica): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(c.fov, c.aspecto, c.near, c.far);
  cam.position.set(...c.posicao);
  cam.up.set(...c.up);
  cam.lookAt(...c.alvo);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** NDC do ponto (|x|,|y| ≤ 1 e z em [−1, 1] = dentro do frustum). */
function ndc(c: CameraClinica, p: V3): THREE.Vector3 {
  return new THREE.Vector3(...p).project(camera3(c));
}

/** Torso girado (quadro anatômico ≠ quadro do arquivo): rotação arbitrária + translação. */
function transformar(l: Landmarks, eixo: V3, t: number, trans: V3): Landmarks {
  const out: Landmarks = {};
  for (const [k, v] of Object.entries(l)) {
    const p = girar(v!.posicao as V3, eixo, t);
    out[k as keyof Landmarks] = lm([p[0] + trans[0], p[1] + trans[1], p[2] + trans[2]]);
  }
  return out;
}

describe("câmera clínica", () => {
  it("AP olha ao longo de −z anatômico para o ponto médio dos mamilos, com up = y anatômico", () => {
    for (const l of [T01, transformar(T01, [0.3, 1, -0.2], 0.7, [120, -40, 300])]) {
      const q = quadroClinico(l, CAIXA_T01);
      expect(q.fonte).toBe("landmarks");
      const c = camerasClinicas(l, CAIXA_T01).frente;
      const md = l.mamilo_dir!.posicao as V3, me = l.mamilo_esq!.posicao as V3;
      const centro: V3 = [(md[0] + me[0]) / 2, (md[1] + me[1]) / 2, (md[2] + me[2]) / 2];
      for (let i = 0; i < 3; i++) expect(c.alvo[i]).toBeCloseTo(centro[i]!, 6);
      // direção de visada (câmera → alvo) = −z anatômico
      expect(grausEntre(sub(c.alvo, c.posicao), [-q.z[0], -q.z[1], -q.z[2]])).toBeLessThan(1e-6);
      expect(grausEntre(c.up, q.y)).toBeLessThan(1e-6);
      expect(c.fov).toBe(FOV_CLINICO_GRAUS);
      expect(c.aspecto).toBeCloseTo(ASPECTO_CLINICO, 12);
    }
  });

  it("oblíqua D = paciente girada +45° em torno de y (a câmera orbita −45°); oblíqua E = −45°; perfis a ±90°", () => {
    const l = transformar(T01, [1, 0.2, 0.1], -0.4, [10, 20, 30]);
    const q = quadroClinico(l, CAIXA_T01);
    const cs = camerasClinicas(l, CAIXA_T01);
    const rel = (c: CameraClinica) => sub(c.posicao, c.alvo);
    // girar a paciente +θ em torno de y leva o ponto p a R_y(θ)p; a câmera fixa vê o mesmo que uma
    // câmera girada de −θ vendo a paciente parada
    const casos: Array<[keyof typeof cs, number]> = [
      ["obliqua_dir", 45],
      ["obliqua_esq", -45],
      ["perfil_dir", 90],
      ["perfil_esq", -90],
    ];
    for (const [v, graus] of casos) {
      const esperado = girar(rel(cs.frente), q.y, (-graus * Math.PI) / 180);
      for (let i = 0; i < 3; i++) expect(rel(cs[v])[i]).toBeCloseTo(esperado[i]!, 6);
      expect(grausEntre(rel(cs[v]), rel(cs.frente))).toBeCloseTo(Math.abs(graus), 6);
      // mesma distância e mesmo alvo em todas as vistas (câmera fixa)
      expect(Math.hypot(...rel(cs[v]))).toBeCloseTo(Math.hypot(...rel(cs.frente)), 6);
    }
    // oblíqua D mostra o lado DIREITO da paciente (−x anatômico) à câmera
    expect(dot(unit(rel(cs.obliqua_dir)), q.x)).toBeLessThan(-0.7);
    expect(dot(unit(rel(cs.perfil_dir)), q.x)).toBeCloseTo(-1, 6);
  });

  it("fúrcula + 40 mm e sulco − 120 mm ficam dentro do frustum nas 5 vistas", () => {
    for (const l of [T01, transformar(T01, [0, 1, 0], 1.1, [0, 0, 0])]) {
      const q = quadroClinico(l, CAIXA_T01);
      const cs = camerasClinicas(l, CAIXA_T01);
      const f = l.furcula!.posicao as V3;
      const sulcoBaixo = [l.sulco_dir!.posicao, l.sulco_esq!.posicao].map((p) => p as V3).sort((a, b) => dot(a, q.y) - dot(b, q.y))[0]!;
      const topo: V3 = [f[0] + q.y[0] * MARGEM_ACIMA_FURCULA_MM, f[1] + q.y[1] * MARGEM_ACIMA_FURCULA_MM, f[2] + q.y[2] * MARGEM_ACIMA_FURCULA_MM];
      const base: V3 = [sulcoBaixo[0] - q.y[0] * MARGEM_ABAIXO_SULCO_MM, sulcoBaixo[1] - q.y[1] * MARGEM_ABAIXO_SULCO_MM, sulcoBaixo[2] - q.y[2] * MARGEM_ABAIXO_SULCO_MM];
      let maisJusto = 0;
      for (const v of VISTAS_CLINICAS) {
        for (const p of [topo, base, ...Object.values(l).map((x) => x!.posicao as V3)]) {
          const n = ndc(cs[v], p);
          expect(Math.abs(n.y), `${v}`).toBeLessThanOrEqual(1);
          expect(Math.abs(n.x), `${v}`).toBeLessThanOrEqual(1);
          expect(n.z).toBeGreaterThan(-1);
          expect(n.z).toBeLessThan(1);
        }
        maisJusto = Math.max(maisJusto, Math.abs(ndc(cs[v], topo).y), Math.abs(ndc(cs[v], base).y));
      }
      // enquadramento justo: o limite mais apertado ocupa ≥ 90 % do meio-quadro (sem sobra à toa)
      expect(maisJusto).toBeGreaterThan(0.9);
    }
  });

  it("determinística: mesmas entradas → exatamente as mesmas câmeras", () => {
    expect(JSON.stringify(camerasClinicas(T01, CAIXA_T01))).toBe(JSON.stringify(camerasClinicas(structuredClone(T01), structuredClone(CAIXA_T01))));
  });

  it("t01 (quadro anatômico ≈ quadro do arquivo): a AP coincide com a vista 'frente' do viewer a menos do FOV", () => {
    const c = camerasClinicas(T01, CAIXA_T01).frente;
    const frente = VISTAS.frente.direcao as unknown as V3;
    // direção da câmera (a partir do alvo) = a da vista "frente" (+z), a menos da inclinação de
    // ~1,2° da linha fúrcula → linha média inferior do t01
    expect(grausEntre(sub(c.posicao, c.alvo), frente)).toBeLessThan(1.5);
    expect(grausEntre(c.up, [0, 1, 0])).toBeLessThan(1.5);
  });

  it("sem landmarks: recua para o quadro do arquivo e a caixa inteira no quadro (só testes/benchmark)", () => {
    const cs = camerasClinicas(null, CAIXA_T01);
    expect(quadroClinico({ furcula: T01.furcula }, CAIXA_T01).fonte).toBe("caixa");
    expect(grausEntre(sub(cs.frente.posicao, cs.frente.alvo), [0, 0, 1])).toBeLessThan(1e-9);
    for (const v of VISTAS_CLINICAS)
      for (const x of [CAIXA_T01.min[0], CAIXA_T01.max[0]])
        for (const y of [CAIXA_T01.min[1], CAIXA_T01.max[1]])
          for (const z of [CAIXA_T01.min[2], CAIXA_T01.max[2]]) expect(Math.abs(ndc(cs[v], [x, y, z]).y)).toBeLessThanOrEqual(1);
  });
});
