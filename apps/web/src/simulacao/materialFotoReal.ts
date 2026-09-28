import * as THREE from "three";
import { substituirTrecho } from "./materialFoto";

/**
 * Material da vista "Foto real" (plano "foto → 3D", P3-lite): o modo foto do ADR 0019 desenhado
 * da câmera da própria foto (`cameraDaFoto.ts`), sobre a foto.
 *
 * - Textura PROJETIVA da foto: cada vértice amostra a foto na projeção da sua posição ORIGINAL
 *   (antes do morph), `uv = (M·[X, 1]).xy / w` (`matrizTexturaFoto`). No "depois" os mesmos
 *   pixels da foto acompanham a geometria simulada; onde a superfície não era visível na foto
 *   (de costas para a câmera), fica a textura do atlas (`textura.png`, C3).
 * - Alfa pelo deslocamento: a malha só pinta onde o implante a move (`mascaraEnvelope`, 1–3 mm →
 *   0–1; e a linha pontilhada da borda da região), e nada com peso 0 (`uAtivo = 0`). Fora disso a
 *   pele tem alfa 0: continua escrevendo profundidade (o halo continua escondido atrás dela), mas
 *   não muda nenhum pixel — o compósito sobre a foto (RenderizadorFotos) deixa a foto intacta.
 *   Por isso "antes" = a foto, pixel a pixel, e fora da região simulada 0 pixels mudam, mesmo com
 *   erro de registro.
 * - Halo, linha pontilhada, razão SH9 e margem completa: os do `criarMaterialPeleFoto` (inalterados).
 *
 * `aplicarHachuraNaoObservado` (vistas clínicas de uma malha reconstruída): listras cinza-azuladas
 * onde `observado.png` (C3, confiança 0–255 no atlas UV) < 0,15 — região que nenhuma foto viu.
 */

/** Cor das listras de "não observado" (distinta do âmbar da incerteza). */
export const COR_NAO_OBSERVADO = "#4b5d78";
/** Limiar de `observado` (0–1) abaixo do qual a região é hachurada (C3/plano §2). */
export const LIMIAR_OBSERVADO = 0.15;

export interface OpcoesFotoReal {
  /** a foto (ImageBitmap/Canvas; flipY = false, sRGB) */
  foto: THREE.Texture;
  /** `matrizTexturaFoto(K, R, t)` */
  matriz: THREE.Matrix4;
  /** centro óptico da câmera da foto, espaço do objeto */
  centro: THREE.Vector3;
}

export interface UniformsFotoReal {
  [k: string]: THREE.IUniform;
  uFoto: { value: THREE.Texture };
  uMatrizFoto: { value: THREE.Matrix4 };
  uCentroFoto: { value: THREE.Vector3 };
}

export interface UniformsNaoObservado {
  [k: string]: THREE.IUniform;
  uObservado: { value: THREE.Texture };
  uCorNaoObservado: { value: THREE.Color };
  uLimiarObservado: { value: number };
}

/** Encadeia um `onBeforeCompile` depois do que o material já tem (a pele-foto do ADR 0019). */
function encadear(m: THREE.Material, extra: (shader: THREE.WebGLProgramParametersWithUniforms) => void, chave: string): void {
  const antes = m.onBeforeCompile.bind(m);
  const chaveAntes = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, r) => {
    antes(shader, r);
    extra(shader);
  };
  m.customProgramCacheKey = () => `${chaveAntes()}|${chave}`;
}

/** Alfa da pele na vista "Foto real" (espelho do shader, para os testes). */
export function alfaFotoReal(mascara: number, ativo: boolean, pontoDaLinha = false): number {
  if (!ativo) return 0;
  const borda = mascara >= 0.12 && mascara <= 0.3 && pontoDaLinha ? 1 : 0;
  return Math.min(1, Math.max(0, Math.max(mascara, borda)));
}

/** Largura do halo de uma malha reconstruída de fotos: max(envelope do modelo, incerteza em z). */
export function envelopeFotoReal(envelopeMm: number, incertezaZMm: number | null | undefined): number {
  const z = Number.isFinite(incertezaZMm) ? Number(incertezaZMm) : 0;
  return Math.max(envelopeMm, z);
}

/**
 * Transforma a pele-foto (de `criarMaterialPeleFoto`) no material da vista "Foto real". Muda o
 * material no lugar: transparente (a pele só pinta onde a simulação move a superfície).
 */
export function aplicarFotoReal(m: THREE.MeshBasicMaterial, o: OpcoesFotoReal): UniformsFotoReal {
  o.foto.colorSpace = THREE.SRGBColorSpace;
  o.foto.flipY = false;
  const u: UniformsFotoReal = { uFoto: { value: o.foto }, uMatrizFoto: { value: o.matriz }, uCentroFoto: { value: o.centro } };
  m.userData.uniformsFotoReal = u;
  m.transparent = true;
  m.depthWrite = true;
  m.blending = THREE.NormalBlending;
  m.premultipliedAlpha = false;
  encadear(
    m,
    (shader) => {
      Object.assign(shader.uniforms, u);
      let v = shader.vertexShader;
      v = substituirTrecho(v, "#include <common>", "#include <common>\nuniform mat4 uMatrizFoto;\nuniform vec3 uCentroFoto;\nvarying vec4 vFotoQ;\nvarying float vVisFoto;");
      // posição e normal ORIGINAIS (antes do morph): a foto fica "grudada" na pele que se move
      v = substituirTrecho(v, "vNA = objectNormal;", "vNA = objectNormal;\nvFotoQ = uMatrizFoto * vec4(position, 1.0);\nvVisFoto = dot(normalize(objectNormal), normalize(uCentroFoto - position));");
      shader.vertexShader = v;
      let f = shader.fragmentShader;
      f = substituirTrecho(f, "#include <common>", "#include <common>\nuniform sampler2D uFoto;\nvarying vec4 vFotoQ;\nvarying float vVisFoto;");
      f = substituirTrecho(
        f,
        "#include <map_fragment>",
        `#include <map_fragment>
{
  vec2 uvFoto = vFotoQ.xy / vFotoQ.w;
  float naFoto = step(0.0, vFotoQ.w) * step(0.0, uvFoto.x) * step(uvFoto.x, 1.0) * step(0.0, uvFoto.y) * step(uvFoto.y, 1.0);
  float pesoFoto = naFoto * smoothstep(0.02, 0.15, vVisFoto);
  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uFoto, uvFoto).rgb, pesoFoto);
}`,
      );
      // alfa: só onde a simulação move a pele (e a linha pontilhada da borda); 0 com peso 0
      f = substituirTrecho(
        f,
        "#include <opaque_fragment>",
        `{
  float bordaR = step(0.12, vMascara) * step(vMascara, 0.30);
  float pontoR = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (4.0 * uEscalaPx)));
  diffuseColor.a = clamp(max(vMascara, bordaR * pontoR), 0.0, 1.0) * uAtivo;
}
#include <opaque_fragment>`,
      );
      shader.fragmentShader = f;
    },
    "foto-real",
  );
  m.needsUpdate = true;
  return u;
}

/** Hachura do "não observado" na pele-foto (vistas clínicas de uma malha reconstruída de fotos). */
export function aplicarHachuraNaoObservado(m: THREE.MeshBasicMaterial, observado: THREE.Texture): UniformsNaoObservado {
  observado.colorSpace = THREE.NoColorSpace;
  const u: UniformsNaoObservado = { uObservado: { value: observado }, uCorNaoObservado: { value: new THREE.Color(COR_NAO_OBSERVADO) }, uLimiarObservado: { value: LIMIAR_OBSERVADO } };
  m.userData.uniformsNaoObservado = u;
  encadear(
    m,
    (shader) => {
      Object.assign(shader.uniforms, u);
      let f = shader.fragmentShader;
      f = substituirTrecho(f, "#include <common>", "#include <common>\nuniform sampler2D uObservado;\nuniform vec3 uCorNaoObservado;\nuniform float uLimiarObservado;");
      // listras diagonais de 2 px a cada 8 px (a 55 %), só onde nenhuma foto viu a superfície
      // depois do bloco de cor da pele-foto (razão SH9, linha, margem) e antes de a cor virar a saída
      f = substituirTrecho(
        f,
        "#include <alphamap_fragment>",
        `#ifdef USE_MAP
{
  float obs = texture2D(uObservado, vMapUv).r;
  float naoObs = 1.0 - smoothstep(uLimiarObservado - 0.05, uLimiarObservado + 0.05, obs);
  float listra = step(fract((gl_FragCoord.x + gl_FragCoord.y) / (8.0 * uEscalaPx)), 0.25);
  diffuseColor.rgb = mix(diffuseColor.rgb, uCorNaoObservado, 0.55 * naoObs * listra);
}
#endif
#include <alphamap_fragment>`,
      );
      shader.fragmentShader = f;
    },
    "nao-observado",
  );
  m.needsUpdate = true;
  return u;
}
