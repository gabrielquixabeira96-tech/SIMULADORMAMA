/**
 * Material da vista "Foto real" (plano "foto → 3D", P3-lite): textura projetiva da foto pela
 * posição ORIGINAL (antes do morph), alfa 0 no "antes" e fora da região que a simulação move
 * (a foto fica intacta pixel a pixel), halo = max(envelope; incerteza em z), hachura do "não
 * observado" nas vistas clínicas; e os trechos de shader do three r186 que ele usa.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { criarMaterialPeleFoto, shPadrao } from "@/simulacao/materialFoto";
import { matrizTexturaFoto } from "@/simulacao/cameraDaFoto";
import {
  COR_NAO_OBSERVADO,
  LIMIAR_OBSERVADO,
  alfaFotoReal,
  aplicarFotoReal,
  aplicarHachuraNaoObservado,
  envelopeFotoReal,
} from "@/simulacao/materialFotoReal";

const compilar = (m: THREE.Material, lib: { vertexShader: string; fragmentShader: string } = THREE.ShaderLib.basic) => {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
  return shader;
};

const FRENTE = { K: [2734.5, 0, 0, 0, 2734.5, 0, 480, 360, 1], R: [1, 0, 0, 0, -1, 0, 0, 0, -1], t: [0, -165, 1350], largura_px: 960, altura_px: 720 };

function materialReal() {
  const m = criarMaterialPeleFoto(new THREE.Texture(), { sh9: shPadrao(null) });
  const foto = new THREE.Texture();
  const u = aplicarFotoReal(m, { foto, matriz: matrizTexturaFoto(FRENTE), centro: new THREE.Vector3(0, -165, 1350) });
  return { m, foto, u };
}

describe("materialFotoReal", () => {
  it("alfa: 0 no antes (peso 0) em toda a pele; no depois segue a máscara do deslocamento e a linha da borda", () => {
    for (const mascara of [0, 0.05, 0.2, 0.5, 1]) expect(alfaFotoReal(mascara, false, true)).toBe(0);
    expect(alfaFotoReal(0, true)).toBe(0); // vértice que o implante não move: a foto aparece intacta
    expect(alfaFotoReal(0.5, true)).toBe(0.5);
    expect(alfaFotoReal(1, true)).toBe(1);
    expect(alfaFotoReal(0.2, true, true)).toBe(1); // ponto da linha pontilhada (incerteza) sempre opaco
    expect(alfaFotoReal(0.2, true, false)).toBe(0.2);
  });

  it("halo de malha reconstruída = max(envelope do modelo; incerteza em z)", () => {
    expect(envelopeFotoReal(4.5, 12)).toBe(12);
    expect(envelopeFotoReal(4.5, 2.5)).toBe(4.5);
    expect(envelopeFotoReal(4.5, null)).toBe(4.5);
    expect(envelopeFotoReal(4.5, Number.NaN)).toBe(4.5);
  });

  it("transparente com escrita de profundidade (o halo continua atrás da pele); foto sRGB sem flipY", () => {
    const { m, foto, u } = materialReal();
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(true);
    expect(m.blending).toBe(THREE.NormalBlending);
    expect(m.premultipliedAlpha).toBe(false);
    expect(foto.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(foto.flipY).toBe(false);
    expect(u.uMatrizFoto.value.equals(matrizTexturaFoto(FRENTE))).toBe(true);
    expect(m.customProgramCacheKey()).toBe("pele-foto-sh9|foto-real");
  });

  it("shader: uv projetivo da posição ORIGINAL (antes do morph), mistura com o atlas por visibilidade, alfa × uAtivo", () => {
    const { m } = materialReal();
    const sh = compilar(m);
    const v = sh.vertexShader;
    const iFoto = v.indexOf("vFotoQ = uMatrizFoto * vec4(position, 1.0);");
    expect(iFoto).toBeGreaterThan(0);
    expect(iFoto).toBeLessThan(v.indexOf("#include <morphtarget_vertex>"));
    expect(iFoto).toBeLessThan(v.indexOf("#include <morphnormal_vertex>\nvND = objectNormal;"));
    expect(v).toContain("vVisFoto = dot(normalize(objectNormal), normalize(uCentroFoto - position));");
    const f = sh.fragmentShader;
    expect(f).toContain("vec2 uvFoto = vFotoQ.xy / vFotoQ.w;");
    expect(f).toContain("diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uFoto, uvFoto).rgb, pesoFoto);");
    // a foto entra antes da razão SH9 (o "depois" é a foto com o sombreamento novo)
    expect(f.indexOf("texture2D(uFoto, uvFoto)")).toBeLessThan(f.indexOf("irradianciaSH(normalize(vND))"));
    expect(f).toContain("diffuseColor.a = clamp(max(vMascara, bordaR * pontoR), 0.0, 1.0) * uAtivo;");
    expect(f.indexOf("diffuseColor.a =")).toBeLessThan(f.indexOf("#include <opaque_fragment>"));
    // uniforms da pele-foto preservados (incerteza) + os da foto
    expect(Object.keys(sh.uniforms).sort()).toEqual(["uAmbar", "uAtivo", "uCentroFoto", "uEscalaPx", "uFaixaR", "uFoto", "uMargemCompleta", "uMatrizFoto", "uSH"]);
  });

  it("hachura do não observado: listras onde observado < 0,15, depois do bloco de cor e antes da saída", () => {
    const m = criarMaterialPeleFoto(new THREE.Texture());
    const obs = new THREE.Texture();
    const u = aplicarHachuraNaoObservado(m, obs);
    expect(obs.colorSpace).toBe(THREE.NoColorSpace);
    expect(u.uLimiarObservado.value).toBe(LIMIAR_OBSERVADO);
    expect(`#${u.uCorNaoObservado.value.getHexString()}`).toBe(COR_NAO_OBSERVADO);
    const f = compilar(m).fragmentShader;
    const i = f.indexOf("texture2D(uObservado, vMapUv)");
    expect(i).toBeGreaterThan(f.indexOf("irradianciaSH(normalize(vND))"));
    expect(i).toBeLessThan(f.indexOf("vec3 outgoingLight"));
    expect(m.customProgramCacheKey()).toBe("pele-foto-sh9|nao-observado");
    // combinável com a foto real (mesmo material) sem perder nenhum trecho
    const { m: real } = materialReal();
    aplicarHachuraNaoObservado(real, new THREE.Texture());
    const g = compilar(real).fragmentShader;
    expect(g).toContain("texture2D(uObservado, vMapUv)");
    expect(g).toContain("diffuseColor.a =");
  });
});
