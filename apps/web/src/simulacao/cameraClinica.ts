import type { Landmarks } from "@simulador/contratos";
import { quadroAnatomico } from "@/medidas/geometria";

/**
 * Câmera de fotografia clínica (ADR 0019): a paciente "gira" diante de uma câmera fixa, como no
 * protocolo fotográfico de mamoplastia — frente (AP), oblíquas a 45° e perfis a 90°, sempre com a
 * mesma distância, a mesma lente e o mesmo enquadramento. Tudo no quadro anatômico derivado dos
 * landmarks (contratos §1.1: x = esquerda da paciente, y = cranial, z = anterior), para não depender
 * de o scan ter vindo alinhado com +Z. Função pura e determinística.
 *
 * - Lente: FOV vertical 15° (tele, ~90 mm equivalente), quadro 4:3.
 * - Enquadramento vertical: de 40 mm acima da fúrcula a 120 mm abaixo do sulco mais baixo, com a
 *   câmera apontada para o ponto médio dos mamilos; a distância é a menor que mantém esses dois
 *   limites dentro do quadro nas 5 vistas (a mesma para todas).
 * - Sem landmarks (só testes/benchmark): o quadro do próprio arquivo e a caixa envolvente.
 */

export const VISTAS_CLINICAS = ["frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq"] as const;
export type VistaClinica = (typeof VISTAS_CLINICAS)[number];

export const ROTULOS_VISTAS_CLINICAS: Record<VistaClinica, string> = {
  frente: "Frente",
  obliqua_dir: "Oblíqua D",
  obliqua_esq: "Oblíqua E",
  perfil_dir: "Perfil D",
  perfil_esq: "Perfil E",
};

/**
 * Giro da PACIENTE em torno do eixo y anatômico (graus, regra da mão direita), diante da câmera
 * fixa. +45° leva o lado direito da paciente (−x) para a câmera: é a oblíqua D.
 */
export const GIRO_PACIENTE_GRAUS: Record<VistaClinica, number> = { frente: 0, obliqua_dir: 45, obliqua_esq: -45, perfil_dir: 90, perfil_esq: -90 };

export const FOV_CLINICO_GRAUS = 15;
export const ASPECTO_CLINICO = 4 / 3;
export const MARGEM_ACIMA_FURCULA_MM = 40;
export const MARGEM_ABAIXO_SULCO_MM = 120;
/** Fração do meio-quadro vertical que os limites podem ocupar (folga de 4 %). */
const OCUPACAO = 0.96;

type V3 = [number, number, number];

export interface CameraClinica {
  posicao: V3;
  alvo: V3;
  up: V3;
  /** FOV vertical em graus */
  fov: number;
  near: number;
  far: number;
  aspecto: number;
}

export interface QuadroClinico {
  /** ponto para onde a câmera aponta (médio dos mamilos; sem landmarks, centro da caixa) */
  centro: V3;
  x: V3;
  y: V3;
  z: V3;
  fonte: "landmarks" | "caixa";
  /** pontos que precisam caber no quadro vertical */
  limites: V3[];
}

export interface CaixaSimples {
  min: { x: number; y: number; z: number } | readonly [number, number, number];
  max: { x: number; y: number; z: number } | readonly [number, number, number];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const comoV3 = (p: { x: number; y: number; z: number } | readonly [number, number, number]): V3 =>
  Array.isArray(p) ? [p[0], p[1], p[2]] : [(p as { x: number }).x, (p as { y: number }).y, (p as { z: number }).z];

/** Quadro da câmera clínica: anatômico (landmarks) ou, sem eles, o do arquivo com a caixa. */
export function quadroClinico(landmarks: Landmarks | null | undefined, caixa: CaixaSimples): QuadroClinico {
  const q = landmarks ? quadroAnatomico(landmarks) : null;
  const md = landmarks?.mamilo_dir?.posicao;
  const me = landmarks?.mamilo_esq?.posicao;
  const f = landmarks?.furcula?.posicao;
  const sd = landmarks?.sulco_dir?.posicao;
  const se = landmarks?.sulco_esq?.posicao;
  if (q && md && me && f && sd && se) {
    const x = q.x as V3, y = q.y as V3, z = q.z as V3;
    const centro = mul(add(md as V3, me as V3), 0.5);
    const sulco = dot(sub(sd as V3, centro), y) <= dot(sub(se as V3, centro), y) ? (sd as V3) : (se as V3);
    return { centro, x, y, z, fonte: "landmarks", limites: [add(f as V3, mul(y, MARGEM_ACIMA_FURCULA_MM)), sub(sulco, mul(y, MARGEM_ABAIXO_SULCO_MM))] };
  }
  const mn = comoV3(caixa.min), mx = comoV3(caixa.max);
  const centro = mul(add(mn, mx), 0.5);
  const limites: V3[] = [];
  for (const a of [mn[0], mx[0]]) for (const b of [mn[1], mx[1]]) for (const c of [mn[2], mx[2]]) limites.push([a, b, c]);
  return { centro, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], fonte: "caixa", limites };
}

/** Direção (unitária) da câmera a partir do centro, no espaço do objeto, para um giro da paciente. */
export function direcaoDaVista(q: Pick<QuadroClinico, "x" | "z">, vista: VistaClinica): V3 {
  const t = (GIRO_PACIENTE_GRAUS[vista] * Math.PI) / 180;
  // a paciente gira +t em torno de y ⇔ a câmera orbita −t: d = −sen t · x + cos t · z
  return add(mul(q.x, -Math.sin(t)), mul(q.z, Math.cos(t)));
}

/** As 5 câmeras clínicas (mesma distância e lente), determinísticas. */
export function camerasClinicas(landmarks: Landmarks | null | undefined, caixa: CaixaSimples): Record<VistaClinica, CameraClinica> {
  const q = quadroClinico(landmarks, caixa);
  const tanMeio = Math.tan(((FOV_CLINICO_GRAUS / 2) * Math.PI) / 180) * OCUPACAO;
  let dist = 300;
  for (const v of VISTAS_CLINICAS) {
    const d = direcaoDaVista(q, v);
    for (const p of q.limites) {
      const a = sub(p, q.centro);
      // |dy| ≤ tan(fov/2)·(dist − profundidade do ponto em direção à câmera)
      dist = Math.max(dist, Math.abs(dot(a, q.y)) / tanMeio + dot(a, d));
    }
  }
  const mn = comoV3(caixa.min), mx = comoV3(caixa.max);
  const raio = Math.max(50, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
  const afast = Math.hypot(...sub(mul(add(mn, mx), 0.5), q.centro));
  const near = Math.max(10, dist - 1.5 * raio - afast);
  const far = dist + 1.5 * raio + afast;
  const out = {} as Record<VistaClinica, CameraClinica>;
  for (const v of VISTAS_CLINICAS) {
    out[v] = { posicao: add(q.centro, mul(direcaoDaVista(q, v), dist)), alvo: [...q.centro], up: [...q.y], fov: FOV_CLINICO_GRAUS, near, far, aspecto: ASPECTO_CLINICO };
  }
  return out;
}
