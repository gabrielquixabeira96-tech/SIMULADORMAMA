import { el3, kColunaMajorValido, rotacaoValida } from "@simulador/contratos";
import * as THREE from "three";

/**
 * Câmera da foto real (plano "foto → 3D", P3-lite; contrato C1): a câmera pinhole estimada pelo
 * services/mesh para cada foto (K, R, t) vira uma `THREE.PerspectiveCamera` com a MESMA projeção,
 * para que a malha reconstruída caia, pixel a pixel, sobre a foto.
 *
 * Convenções (C1, contratos §19 — as mesmas do `camera.py`/`projetar.py` do services/mesh):
 * `x_cam = R·X + t` (mm, quadro da malha), `[u, v, 1]ᵀ ∝ K·x_cam`, câmera olhando para +z com v
 * para baixo (OpenCV); (u, v) CONTÍNUOS com origem no CANTO superior esquerdo da imagem (o centro
 * do pixel da coluna i fica em u = i + 0,5; ponto principal no centro = W/2, H/2); K e R em 9
 * números coluna-major. É a mesma coordenada de borda do NDC do WebGL: nada de meio pixel. O three.js olha para −z com y para cima:
 * `matrixWorldInverse = diag(1, −1, −1)·[R | t]` e a projeção sai direto de K (inclusive
 * `fx ≠ fy`, ponto principal fora do centro e cisalhamento), sem aproximar por fov.
 *
 * A foto é mostrada "contida" no quadro (largura × altura px): escala `s = min(w/W, h/H)`,
 * centrada. Funções puras; o teste confere que pontos 3D caem no pixel previsto por K, R, t.
 */

export interface ParametrosCameraFoto {
  K: readonly number[];
  R: readonly number[];
  t: readonly [number, number, number] | readonly number[];
  largura_px: number;
  altura_px: number;
}

/** Retângulo da foto dentro do quadro (px do quadro). */
export interface EncaixeFoto {
  escala: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Erro de registro simulado (px da foto): desloca o ponto principal (testes de localidade). */
export interface PerturbacaoPx {
  dx: number;
  dy: number;
}

type V3 = [number, number, number];

/**
 * Deslocamento entre a coordenada de pixel do C1 e a de borda (NDC do WebGL): zero, porque o C1 já
 * usa coordenadas contínuas com origem no canto (paridade com o Python conferida em
 * tests/unit/cameraParidade.test.ts contra a fixture gerada pelo services/mesh).
 */
export const MEIO_PIXEL = 0;

/** Foto "contida" num quadro w × h: escala única e centralizada. */
export function encaixeDaFoto(W: number, H: number, w: number, h: number): EncaixeFoto {
  if (!(W > 0 && H > 0 && w > 0 && h > 0)) throw new Error("tamanhos inválidos para a foto");
  const escala = Math.min(w / W, h / H);
  const largura = W * escala, altura = H * escala;
  return { escala, x: (w - largura) / 2, y: (h - altura) / 2, largura, altura };
}

export function validarParametros(p: ParametrosCameraFoto): void {
  if (!kColunaMajorValido(p.K)) throw new Error("K fora do contrato C1 (coluna-major [fx,0,0, s,fy,0, cx,cy,1])");
  if (!rotacaoValida(p.R)) throw new Error("R fora do contrato C1 (rotação, coluna-major)");
  if (p.t.length !== 3 || !p.t.every(Number.isFinite)) throw new Error("t inválido");
  if (!(p.largura_px > 0 && p.altura_px > 0)) throw new Error("tamanho da foto inválido");
}

/** Intrínsecos em px de um quadro (foto encaixada e, opcionalmente, perturbada). */
export function intrinsecosNoQuadro(p: ParametrosCameraFoto, largura: number, altura: number, perturbacao?: PerturbacaoPx | null) {
  const e = encaixeDaFoto(p.largura_px, p.altura_px, largura, altura);
  const s = e.escala;
  return {
    fx: el3(p.K, 0, 0) * s,
    fy: el3(p.K, 1, 1) * s,
    cis: el3(p.K, 0, 1) * s,
    cx: (el3(p.K, 0, 2) + MEIO_PIXEL + (perturbacao?.dx ?? 0)) * s + e.x,
    cy: (el3(p.K, 1, 2) + MEIO_PIXEL + (perturbacao?.dy ?? 0)) * s + e.y,
    encaixe: e,
  };
}

/** Pixel (contínuo, px da foto) de um ponto 3D pela câmera C1 — a referência dos testes. Null atrás da câmera. */
export function pixelDaFoto(p: ParametrosCameraFoto, X: readonly number[]): [number, number] | null {
  const xc: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) xc[i] = el3(p.R, i, 0) * X[0]! + el3(p.R, i, 1) * X[1]! + el3(p.R, i, 2) * X[2]! + p.t[i]!;
  if (!(xc[2] > 0)) return null;
  const u = el3(p.K, 0, 0) * (xc[0] / xc[2]) + el3(p.K, 0, 1) * (xc[1] / xc[2]) + el3(p.K, 0, 2);
  const v = el3(p.K, 1, 1) * (xc[1] / xc[2]) + el3(p.K, 1, 2);
  return [u, v];
}

/** Centro óptico da câmera (mm, quadro da malha): C = −Rᵀ·t. */
export function centroDaCamera(p: ParametrosCameraFoto): V3 {
  const c: V3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) c[j] = -(el3(p.R, 0, j) * p.t[0]! + el3(p.R, 1, j) * p.t[1]! + el3(p.R, 2, j) * p.t[2]!);
  return c;
}

/**
 * Matriz (4×4) que leva a posição ORIGINAL de um vértice à coordenada normalizada da foto
 * (u/W, v/H, com v para baixo e (0, 0) no canto superior esquerdo da foto): `q = M·[X, 1]`,
 * `uv = q.xy / q.w`. É a textura projetiva do `materialFotoReal` (textura com flipY = false).
 */
export function matrizTexturaFoto(p: ParametrosCameraFoto, perturbacao?: PerturbacaoPx | null): THREE.Matrix4 {
  const W = p.largura_px, H = p.altura_px;
  const fx = el3(p.K, 0, 0), fy = el3(p.K, 1, 1), s = el3(p.K, 0, 1);
  const cx = el3(p.K, 0, 2) + MEIO_PIXEL + (perturbacao?.dx ?? 0);
  const cy = el3(p.K, 1, 2) + MEIO_PIXEL + (perturbacao?.dy ?? 0);
  // linhas de K·[R | t]
  const r = (i: number, j: number) => el3(p.R, i, j);
  const lin = (i: number): [number, number, number, number] => [r(i, 0), r(i, 1), r(i, 2), p.t[i]!];
  const l0 = lin(0), l1 = lin(1), l2 = lin(2);
  const a = l0.map((v, k) => (fx * v + s * l1[k]! + cx * l2[k]!) / W);
  const b = l1.map((v, k) => (fy * v + cy * l2[k]!) / H);
  const m = new THREE.Matrix4();
  m.set(a[0]!, a[1]!, a[2]!, a[3]!, b[0]!, b[1]!, b[2]!, b[3]!, 0, 0, 0, 0, l2[0], l2[1], l2[2], l2[3]);
  return m;
}

/** Espelho em TS da textura projetiva do shader (testes): (u/W, v/H) da posição original. */
export function uvDaFoto(m: THREE.Matrix4, X: readonly number[]): [number, number] {
  const q = new THREE.Vector4(X[0]!, X[1]!, X[2]!, 1).applyMatrix4(m);
  return [q.x / q.w, q.y / q.w];
}

/**
 * `PerspectiveCamera` com a projeção exata da foto. `updateProjectionMatrix()` refaz a matriz a
 * partir de K (não do fov), para que mudar near/far não desfaça a projeção.
 */
export class CameraDaFoto extends THREE.PerspectiveCamera {
  readonly parametros: ParametrosCameraFoto;
  largura: number;
  altura: number;
  perturbacao: PerturbacaoPx | null;

  constructor(p: ParametrosCameraFoto, largura: number, altura: number, opts: { near?: number; far?: number; perturbacao?: PerturbacaoPx | null } = {}) {
    validarParametros(p);
    super(50, largura / altura, opts.near ?? 10, opts.far ?? 10000);
    this.parametros = p;
    this.largura = largura;
    this.altura = altura;
    this.perturbacao = opts.perturbacao ?? null;
    // pose: mundo → câmera GL = D·[R | t], D = diag(1, −1, −1)  ⇒  câmera → mundo = [Rᵀ·D | −Rᵀ·t]
    const R = p.R;
    const m = new THREE.Matrix4().set(
      el3(R, 0, 0), -el3(R, 1, 0), -el3(R, 2, 0), 0,
      el3(R, 0, 1), -el3(R, 1, 1), -el3(R, 2, 1), 0,
      el3(R, 0, 2), -el3(R, 1, 2), -el3(R, 2, 2), 0,
      0, 0, 0, 1,
    );
    const c = centroDaCamera(p);
    m.setPosition(c[0], c[1], c[2]);
    m.decompose(this.position, this.quaternion, this.scale);
    this.updateMatrixWorld(true);
    this.updateProjectionMatrix();
  }

  /** Muda o tamanho do quadro (px) e/ou a perturbação e refaz a projeção. */
  ajustar(largura: number, altura: number, perturbacao: PerturbacaoPx | null = this.perturbacao): void {
    this.largura = largura;
    this.altura = altura;
    this.perturbacao = perturbacao;
    this.aspect = largura / altura;
    this.updateProjectionMatrix();
  }

  override updateProjectionMatrix(): void {
    // durante o super() os parâmetros ainda não existem: projeção provisória do three
    if (!this.parametros) return super.updateProjectionMatrix();
    const w = this.largura, h = this.altura, n = this.near, f = this.far;
    const k = intrinsecosNoQuadro(this.parametros, w, h, this.perturbacao);
    this.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / (2 * k.fy)));
    this.projectionMatrix.set(
      (2 * k.fx) / w, (-2 * k.cis) / w, 1 - (2 * k.cx) / w, 0,
      0, (2 * k.fy) / h, (2 * k.cy) / h - 1, 0,
      0, 0, -(f + n) / (f - n), (-2 * f * n) / (f - n),
      0, 0, -1, 0,
    );
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

/** Near/far que envolvem uma esfera (centro, raio) vista da câmera da foto. */
export function planosParaEsfera(p: ParametrosCameraFoto, centro: readonly number[], raio: number): { near: number; far: number } {
  const c = centroDaCamera(p);
  const d = Math.hypot(centro[0]! - c[0], centro[1]! - c[1], centro[2]! - c[2]);
  return { near: Math.max(1, d - 1.5 * raio), far: d + 1.5 * raio };
}

/** Câmera da foto para um quadro (px), com near/far pela esfera envolvente da malha. */
export function cameraDaFoto(p: ParametrosCameraFoto, largura: number, altura: number, esfera?: { centro: readonly number[]; raio: number } | null, perturbacao?: PerturbacaoPx | null): CameraDaFoto {
  const planos = esfera ? planosParaEsfera(p, esfera.centro, esfera.raio) : { near: 10, far: 10000 };
  return new CameraDaFoto(p, largura, altura, { ...planos, perturbacao });
}

/** Pixel (contínuo, px do QUADRO) em que a câmera three projeta um ponto — para os testes. */
export function pixelNoQuadro(cam: THREE.Camera, X: readonly number[], largura: number, altura: number): [number, number] {
  const v = new THREE.Vector3(X[0]!, X[1]!, X[2]!).project(cam);
  return [((v.x + 1) / 2) * largura - MEIO_PIXEL, ((1 - v.y) / 2) * altura - MEIO_PIXEL];
}
