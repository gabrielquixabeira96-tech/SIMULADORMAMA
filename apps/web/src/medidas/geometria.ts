import {
  DISTANCIAS,
  type DistanciaId,
  type Landmarks,
  type QuadroAnatomico,
  type Vetor3,
} from "@simulador/contratos";

/** Arredondamento serializado do contrato: 0,01 mm (§1). */
export function arred2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function sub(a: Vetor3, b: Vetor3): Vetor3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function norma(v: Vetor3): number {
  return Math.hypot(v[0], v[1], v[2]);
}
export function normalizar(v: Vetor3): Vetor3 {
  const n = norma(v);
  if (n === 0) throw new Error("vetor nulo");
  return [v[0] / n, v[1] / n, v[2] / n];
}
export function cruz(a: Vetor3, b: Vetor3): Vetor3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a: Vetor3, b: Vetor3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Distância euclidiana em mm entre duas posições (sem arredondar). */
export function distanciaEuclidiana(a: Vetor3, b: Vetor3): number {
  return norma(sub(a, b));
}

/**
 * Euclidianas das 7 distâncias canônicas (§3.1), em mm com 2 casas; `null` quando falta
 * algum dos dois landmarks. Chamada SÓ quando `medicao_automatica_3d` está ativo.
 */
export function distanciasEuclidianas(landmarks: Landmarks): Record<DistanciaId, number | null> {
  const out = {} as Record<DistanciaId, number | null>;
  for (const [id, [de, para]] of Object.entries(DISTANCIAS) as Array<[DistanciaId, readonly [keyof Landmarks, keyof Landmarks]]>) {
    const a = landmarks[de];
    const b = landmarks[para];
    out[id] = a && b ? arred2(distanciaEuclidiana(a.posicao, b.posicao)) : null;
  }
  return out;
}

/**
 * Quadro anatômico (contratos §1.1), fórmula idêntica à do services/mesh.
 * Retorna null se faltar furcula, mamilos ou linha_media_inferior.
 */
export function quadroAnatomico(landmarks: Landmarks): QuadroAnatomico | null {
  const f = landmarks.furcula?.posicao;
  const md = landmarks.mamilo_dir?.posicao;
  const me = landmarks.mamilo_esq?.posicao;
  const lmi = landmarks.linha_media_inferior?.posicao;
  if (!f || !md || !me || !lmi) return null;
  const y0 = normalizar(sub(f, lmi));
  const x0 = normalizar(sub(me, md));
  const z = normalizar(cruz(x0, y0));
  const x = cruz(y0, z);
  const y = y0;
  // p_anat = R^T (p - origem); R = [x y z] colunas. Matriz 4x4 coluna-major.
  const t: Vetor3 = [-dot(x, f), -dot(y, f), -dot(z, f)];
  // Linhas de R^T são x, y, z. Coluna-major: elements[col*4 + row].
  const matriz = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, t[0], t[1], t[2], 1];
  return { origem: [...f] as Vetor3, x, y, z, matriz };
}

/** Aplica uma matriz 4x4 coluna-major a um ponto. */
export function aplicarMatriz(m: readonly number[], p: Vetor3): Vetor3 {
  const g = (i: number) => m[i] ?? 0;
  return [
    g(0) * p[0] + g(4) * p[1] + g(8) * p[2] + g(12),
    g(1) * p[0] + g(5) * p[1] + g(9) * p[2] + g(13),
    g(2) * p[0] + g(6) * p[1] + g(10) * p[2] + g(14),
  ];
}

export class EscalaInvalidaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "EscalaInvalidaError";
  }
}

/**
 * Fator de calibração pela régua (ADR 0003 item 4): regua_mm / |p2 − p1|.
 * Recusa pontos coincidentes, comprimento não positivo e fatores absurdos (fora de 0,001–10 000).
 */
export function fatorRegua(p1: Vetor3, p2: Vetor3, reguaMm: number): number {
  if (!Number.isFinite(reguaMm) || reguaMm <= 0) throw new EscalaInvalidaError("comprimento da régua deve ser > 0 mm");
  if (![...p1, ...p2].every(Number.isFinite)) throw new EscalaInvalidaError("pontos inválidos");
  const d = distanciaEuclidiana(p1, p2);
  if (d < 1e-6) throw new EscalaInvalidaError("os dois pontos da régua coincidem");
  const f = reguaMm / d;
  if (f < 1e-3 || f > 1e4) throw new EscalaInvalidaError(`fator de escala fora da faixa plausível: ${f}`);
  return f;
}
