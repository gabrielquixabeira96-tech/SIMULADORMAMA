import * as THREE from "three";

/**
 * Material "pele-foto" (ADR 0019): a textura do scan é desenhada SEM luz somada (MeshBasicMaterial,
 * sem tone mapping), de modo que o "antes" é a própria foto vista daquele ângulo. O "depois" são
 * os mesmos texels, deslocados pelo morph, multiplicados pela razão de sombreamento
 *
 *   R = clamp(E(N_depois) / E(N_antes), 0,55, 1,35),   E(n) = Σ sh9[i]·Y_i(n)
 *
 * (ratio/quotient image: Liu, Shan & Zhang 2001). `E` é a irradiância em harmônicos esféricos de
 * ordem 2 (SH9; Ramamoorthi & Hanrahan 2001) no espaço do objeto do .glb: vem de
 * `asset.extras.iluminacao` (contrato C1, gravado pelo services/mesh) ou do padrão abaixo. O web
 * NÃO ajusta luz nem calcula deformação: só avalia os 9 coeficientes e interpola os targets.
 *
 * Invariantes: peso 0 ⇒ uAtivo = 0 ⇒ R ≡ 1 (a foto intacta); vértice que o morph não move ⇒
 * N_depois = N_antes ⇒ R = 1 (a edição fica local). A incerteza aparece como linha pontilhada na
 * borda da região simulada (aqui) e como halo âmbar na silhueta (`criarMaterialHalo`).
 */

export type Vec3 = readonly [number, number, number];
export type SH9 = readonly number[];

export const ESQUEMA_ILUMINACAO = "iluminacao_sh9/1.0";
/** Faixa da razão de sombreamento (evita escurecer/clarear demais onde o ajuste é ruim). */
export const FAIXA_RAZAO: readonly [number, number] = [0.55, 1.35];
/** Âmbar da incerteza (linhas e halo). */
export const COR_AMBAR = "#d97706";
/** Luz padrão (C1): ambiente + direcional frontal-superior no quadro anatômico. */
export const LUZ_PADRAO = { ambiente: 0.45, direcional: 0.55, direcao: [0, 0.35, 0.94] as Vec3 };

// Constantes da base real dos harmônicos esféricos (l = 0..2, m = −l..l).
const K0 = 0.282095;
const K1 = 0.488603;
const K2 = 1.092548;
const K20 = 0.315392;
const K22 = 0.546274;
/** Convolução com o cosseno truncado (irradiância de uma luz): Â_l = π, 2π/3, π/4. */
const A_L = [Math.PI, (2 * Math.PI) / 3, Math.PI / 4] as const;
const BANDA = [0, 1, 1, 1, 2, 2, 2, 2, 2] as const;

function normalizar(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 0)) throw new Error("vetor nulo");
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Os 9 valores da base real Y_i(n) (n normalizado aqui), na ordem do contrato C1. */
export function baseSH9(nEntrada: Vec3): number[] {
  const [x, y, z] = normalizar(nEntrada);
  return [K0, K1 * y, K1 * z, K1 * x, K2 * x * y, K2 * y * z, K20 * (3 * z * z - 1), K2 * x * z, K22 * (x * x - y * y)];
}

/** E(n) = Σ sh9[i]·Y_i(n) — a mesma conta do shader. */
export function irradianciaSH9(n: Vec3, sh: SH9): number {
  if (sh.length !== 9) throw new Error("sh9 precisa de 9 coeficientes");
  const b = baseSH9(n);
  let e = 0;
  for (let i = 0; i < 9; i++) e += sh[i]! * b[i]!;
  return e;
}

/**
 * SH9 (coeficientes de irradiância) de ambiente uniforme + luz direcional em L:
 * E(n) ≈ ambiente + direcional·max(0, n·L), projetado analiticamente na ordem 2.
 */
export function shDeLuz(ambiente: number, direcional: number, L: Vec3): number[] {
  const y = baseSH9(L);
  const sh = y.map((yi, i) => direcional * A_L[BANDA[i]!]! * yi);
  sh[0] = sh[0]! + ambiente / K0;
  return sh;
}

export interface QuadroEixos {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/**
 * Luz padrão do contrato C1 no espaço do objeto: L = normalize(0; 0,35; 0,94) no quadro anatômico
 * (x = esquerda da paciente, y = cranial, z = anterior) rotacionada para o objeto. Sem quadro
 * (faltam landmarks), usa o quadro do próprio .glb.
 */
export function shPadrao(quadro?: QuadroEixos | null): number[] {
  const [a, b, c] = normalizar(LUZ_PADRAO.direcao);
  const q = quadro ?? { x: [1, 0, 0] as Vec3, y: [0, 1, 0] as Vec3, z: [0, 0, 1] as Vec3 };
  const L: Vec3 = [a * q.x[0] + b * q.y[0] + c * q.z[0], a * q.x[1] + b * q.y[1] + c * q.z[1], a * q.x[2] + b * q.y[2] + c * q.z[2]];
  return shDeLuz(LUZ_PADRAO.ambiente, LUZ_PADRAO.direcional, L);
}

export interface IluminacaoGlb {
  sh9: number[];
  origem: string;
  r2: number | null;
}

/** Lê e valida `asset.extras.iluminacao` (C1). Inválida ou ausente → null. */
export function lerIluminacao(extras: Record<string, unknown> | undefined | null): IluminacaoGlb | null {
  const il = extras?.iluminacao as { esquema?: unknown; sh9?: unknown; origem?: unknown; r2?: unknown } | undefined;
  if (!il || il.esquema !== ESQUEMA_ILUMINACAO || !Array.isArray(il.sh9) || il.sh9.length !== 9) return null;
  if (!il.sh9.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return { sh9: il.sh9 as number[], origem: typeof il.origem === "string" ? il.origem : "?", r2: typeof il.r2 === "number" ? il.r2 : null };
}

/**
 * Coeficientes a usar numa cena: os do .glb quando ajustados (origem ≠ "padrao") e com
 * irradiância positiva nas direções frontais; senão, o padrão do C1 no quadro anatômico.
 */
export function shDaCena(extras: Record<string, unknown> | undefined | null, quadro: QuadroEixos | null): { sh9: number[]; fonte: "glb" | "padrao" } {
  const il = lerIluminacao(extras);
  if (il && il.origem !== "padrao") {
    const frente = quadro?.z ?? ([0, 0, 1] as Vec3);
    if (irradianciaSH9(frente, il.sh9) > 1e-3) return { sh9: il.sh9, fonte: "glb" };
  }
  return { sh9: shPadrao(quadro), fonte: "padrao" };
}

/** Espelho em TS da razão do shader (para os testes): 1 com peso 0 ou normal inalterada. */
export function razaoSombreamento(nAntes: Vec3, nDepois: Vec3, sh: SH9, ativo: boolean, faixa: readonly [number, number] = FAIXA_RAZAO): number {
  if (!ativo) return 1;
  if (nAntes[0] === nDepois[0] && nAntes[1] === nDepois[1] && nAntes[2] === nDepois[2]) return 1;
  const r = irradianciaSH9(nDepois, sh) / Math.max(irradianciaSH9(nAntes, sh), 1e-3);
  return Math.min(faixa[1], Math.max(faixa[0], r));
}

/** Substitui um trecho do shader; falha alto se o trecho não existir (mudança de versão do three). */
export function substituirTrecho(fonte: string, trecho: string, novo: string): string {
  if (!fonte.includes(trecho)) throw new Error(`trecho de shader ausente: ${trecho}`);
  return fonte.replace(trecho, novo);
}

const GLSL_IRRADIANCIA = /* glsl */ `
uniform float uSH[9];
float irradianciaSH(vec3 n) {
  return uSH[0] * ${K0}
    + uSH[1] * ${K1} * n.y + uSH[2] * ${K1} * n.z + uSH[3] * ${K1} * n.x
    + uSH[4] * ${K2} * n.x * n.y + uSH[5] * ${K2} * n.y * n.z
    + uSH[6] * ${K20} * (3.0 * n.z * n.z - 1.0)
    + uSH[7] * ${K2} * n.x * n.z + uSH[8] * ${K22} * (n.x * n.x - n.y * n.y);
}`;

export interface UniformsPeleFoto {
  [k: string]: THREE.IUniform;
  uAtivo: { value: number };
  uSH: { value: number[] };
  uFaixaR: { value: THREE.Vector2 };
  uMargemCompleta: { value: number };
  uAmbar: { value: THREE.Color };
  uEscalaPx: { value: number };
}

export interface OpcoesPeleFoto {
  cor?: THREE.Color | null;
  vertexColors?: boolean;
  sh9?: SH9;
}

/**
 * Pele-foto: MeshBasicMaterial + onBeforeCompile. Mantém os chunks de morph do three (posição e
 * normal); guarda a normal antes (vNA) e depois (vND) do morph; aplica a razão SH9, a linha
 * pontilhada âmbar na borda da região (0,12 < máscara < 0,30) e, com a "margem completa" ligada,
 * a tinta antiga (0,55) por cima. Sem luz, sem tone mapping; textura em sRGB.
 */
export function criarMaterialPeleFoto(map: THREE.Texture | null, opts: OpcoesPeleFoto = {}): THREE.MeshBasicMaterial {
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map, color: opts.cor ?? new THREE.Color(0xffffff), vertexColors: !!opts.vertexColors });
  const uniforms: UniformsPeleFoto = {
    uAtivo: { value: 0 },
    uSH: { value: [...(opts.sh9 ?? shPadrao(null))] },
    uFaixaR: { value: new THREE.Vector2(FAIXA_RAZAO[0], FAIXA_RAZAO[1]) },
    uMargemCompleta: { value: 0 },
    uAmbar: { value: new THREE.Color(COR_AMBAR) },
    uEscalaPx: { value: 1 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader;
    v = substituirTrecho(v, "#include <common>", "#include <common>\nattribute float mascaraEnvelope;\nvarying float vMascara;\nvarying vec3 vNA;\nvarying vec3 vND;");
    // o shader básico só calcula a normal com envmap/skinning: aqui, antes e depois do morph
    v = substituirTrecho(
      v,
      "#include <begin_vertex>",
      "#include <beginnormal_vertex>\nvNA = objectNormal;\n#include <morphnormal_vertex>\nvND = objectNormal;\n#include <begin_vertex>\nvMascara = mascaraEnvelope;",
    );
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = substituirTrecho(
      f,
      "#include <common>",
      `#include <common>\nvarying float vMascara;\nvarying vec3 vNA;\nvarying vec3 vND;\nuniform float uAtivo;\nuniform vec2 uFaixaR;\nuniform float uMargemCompleta;\nuniform vec3 uAmbar;\nuniform float uEscalaPx;\n${GLSL_IRRADIANCIA}`,
    );
    f = substituirTrecho(
      f,
      "#include <color_fragment>",
      `#include <color_fragment>
{
  float razao = 1.0;
  if (uAtivo > 0.5 && any(notEqual(vNA, vND))) {
    razao = clamp(irradianciaSH(normalize(vND)) / max(irradianciaSH(normalize(vNA)), 1e-3), uFaixaR.x, uFaixaR.y);
  }
  diffuseColor.rgb *= razao;
  // linha pontilhada na borda da região simulada (sempre com o "depois")
  float borda = step(0.12, vMascara) * step(vMascara, 0.30);
  float ponto = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (4.0 * uEscalaPx)));
  diffuseColor.rgb = mix(diffuseColor.rgb, uAmbar, 0.35 * borda * ponto * uAtivo);
  // margem completa (opcional, só acrescenta): a faixa pintada antiga por cima da pele
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.54, 0.05), 0.55 * vMascara * uAtivo * uMargemCompleta);
}`,
    );
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => "pele-foto-sh9";
  return m;
}

export interface UniformsHalo {
  [k: string]: THREE.IUniform;
  uDesloc: { value: number };
  uAtivo: { value: number };
  uEscalaPx: { value: number };
  uRecuo: { value: number };
}

/**
 * Halo da incerteza: casca a +envelope ao longo da normal DEFORMADA, desenhada pelas faces de
 * trás (casca invertida) — só aparece onde ela sai da silhueta da pele, como uma faixa âmbar
 * hachurada de largura = envelope em volta do contorno simulado. Sem luz; teste de profundidade
 * ligado (a pele à frente a esconde). `solido` = versão de máscara (branca, sem hachura), usada
 * só para medir a pegada da região nos testes.
 */
export function criarMaterialHalo(envelopeMm: number, opts: { solido?: boolean } = {}): THREE.MeshBasicMaterial {
  const solido = !!opts.solido;
  const m = new THREE.MeshBasicMaterial({
    color: solido ? 0xffffff : COR_AMBAR,
    transparent: !solido,
    opacity: 1,
    depthWrite: false,
    side: THREE.BackSide,
  });
  m.userData.deslocMm = envelopeMm;
  m.userData.recuoMm = solido ? 0 : envelopeMm;
  const uniforms: UniformsHalo = { uDesloc: { value: envelopeMm }, uAtivo: { value: 0 }, uEscalaPx: { value: 1 }, uRecuo: { value: solido ? 0 : envelopeMm } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader;
    v = substituirTrecho(v, "#include <common>", "#include <common>\nattribute float mascaraEnvelope;\nvarying float vMascara;\nuniform float uDesloc;\nuniform float uRecuo;");
    v = substituirTrecho(v, "#include <begin_vertex>", "#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <begin_vertex>");
    v = substituirTrecho(v, "#include <morphtarget_vertex>", "#include <morphtarget_vertex>\ntransformed += normalize(objectNormal) * uDesloc;\nvMascara = mascaraEnvelope;");
    // recua o halo ao longo do raio da câmera (mesma posição na tela, mais fundo): onde a casca
    // atravessa a pele por menos que o envelope (dobra do sulco), a pele vence e não sobra rabisco
    v = substituirTrecho(v, "#include <project_vertex>", "#include <project_vertex>\nmvPosition.xyz += normalize(mvPosition.xyz) * uRecuo;\ngl_Position = projectionMatrix * mvPosition;");
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = substituirTrecho(f, "#include <common>", "#include <common>\nvarying float vMascara;\nuniform float uAtivo;\nuniform float uEscalaPx;");
    f = substituirTrecho(
      f,
      "#include <opaque_fragment>",
      solido
        ? "if (uAtivo < 0.5) discard;\n#include <opaque_fragment>"
        : // hachura diagonal: listras âmbar opacas de 3 px a cada 6 px (a densidade visual de ~50 %)
          "if (uAtivo < 0.5 || vMascara < 0.5) discard;\nif (fract((gl_FragCoord.x - gl_FragCoord.y) / (6.0 * uEscalaPx)) < 0.5) discard;\n#include <opaque_fragment>",
    );
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => (solido ? "halo-envelope-mascara" : "halo-envelope");
  return m;
}
