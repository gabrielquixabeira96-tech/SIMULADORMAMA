/**
 * Material "pele-foto" (ADR 0019): SH9 (contrato C1), razão de sombreamento com R ≡ 1 no "antes"
 * e onde a normal não muda, luz padrão no quadro anatômico, e os trechos de shader do three que o
 * material substitui (falha alto se uma versão nova do three os renomear).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  COR_AMBAR,
  ESQUEMA_ILUMINACAO,
  FAIXA_RAZAO,
  LUZ_PADRAO,
  baseSH9,
  criarMaterialHalo,
  criarMaterialPeleFoto,
  irradianciaSH9,
  lerIluminacao,
  razaoSombreamento,
  shDaCena,
  shDeLuz,
  shPadrao,
  substituirTrecho,
  type Vec3,
} from "@/simulacao/materialFoto";

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
let s = 20260928;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
/** Direção uniforme na esfera (z uniforme em [−1, 1], azimute uniforme). */
const direcao = (): Vec3 => {
  const z = rnd();
  const phi = Math.PI * rnd();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
};

describe("SH9 (C1: base real l ≤ 2, ordem m = −l..l, Ramamoorthi & Hanrahan 2001)", () => {
  it("base ortonormal na esfera (integração de Monte Carlo determinística)", () => {
    const N = 40000;
    const g = Array.from({ length: 9 }, () => new Array(9).fill(0) as number[]);
    for (let k = 0; k < N; k++) {
      const b = baseSH9(direcao());
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) g[i]![j]! += (b[i]! * b[j]! * 4 * Math.PI) / N;
    }
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) expect(Math.abs(g[i]![j]! - (i === j ? 1 : 0))).toBeLessThan(0.05);
  });

  it("ambiente puro: E(n) constante; luz direcional: aproxima a + b·max(0, n·L) (erro da ordem 2 ≤ 0,1·b)", () => {
    const amb = shDeLuz(0.6, 0, [0, 0, 1]);
    for (let k = 0; k < 50; k++) expect(irradianciaSH9(direcao(), amb)).toBeCloseTo(0.6, 9);
    const L = unit([0.2, 0.5, 0.8]);
    const sh = shDeLuz(0.45, 0.55, L);
    for (let k = 0; k < 500; k++) {
      const n = direcao();
      const exato = 0.45 + 0.55 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      expect(Math.abs(irradianciaSH9(n, sh) - exato)).toBeLessThanOrEqual(0.1 * 0.55 + 1e-9);
    }
    // máximo na direção da luz (1,0625·b + a na ordem 2)
    expect(irradianciaSH9(L, sh)).toBeCloseTo(0.45 + 0.55 * 1.0625, 4);
  });

  it("luz padrão no quadro anatômico, rotacionada ao espaço do objeto: E_obj(R·n) = E_anat(n)", () => {
    const anat = shPadrao(null);
    // quadro anatômico girado em relação ao objeto
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, -0.8, 0.25));
    const eixo = (x: number, y: number, z: number): Vec3 => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(R);
      return [v.x, v.y, v.z];
    };
    const q = { x: eixo(1, 0, 0), y: eixo(0, 1, 0), z: eixo(0, 0, 1) };
    const obj = shPadrao(q);
    for (let k = 0; k < 200; k++) {
      const n = direcao();
      expect(irradianciaSH9(eixo(...n), obj)).toBeCloseTo(irradianciaSH9(n, anat), 5); // constantes da base com 6 dígitos
    }
    // frontal-superior: mais luz no polo superior que no inferior; E > 0 em toda direção
    expect(irradianciaSH9([0, 0.5, 0.86], anat)).toBeGreaterThan(irradianciaSH9([0, -0.5, 0.86], anat));
    for (let k = 0; k < 500; k++) expect(irradianciaSH9(direcao(), anat)).toBeGreaterThan(0);
    expect(LUZ_PADRAO).toMatchObject({ ambiente: 0.45, direcional: 0.55 });
  });

  it("lê asset.extras.iluminacao (C1); ausente, inválida ou origem 'padrao' → luz padrão do web", () => {
    const sh9 = shDeLuz(0.4, 0.6, unit([0.1, 0.3, 0.9]));
    const ok = { iluminacao: { esquema: ESQUEMA_ILUMINACAO, sh9, r2: 0.93, origem: "ajuste" } };
    expect(lerIluminacao(ok)).toEqual({ sh9, origem: "ajuste", r2: 0.93 });
    expect(shDaCena(ok, null)).toEqual({ sh9, fonte: "glb" });
    for (const ruim of [
      undefined,
      {},
      { iluminacao: { ...ok.iluminacao, esquema: "outro/1.0" } },
      { iluminacao: { ...ok.iluminacao, sh9: sh9.slice(0, 8) } },
      { iluminacao: { ...ok.iluminacao, sh9: [...sh9.slice(0, 8), Number.NaN] } },
    ])
      expect(shDaCena(ruim as Record<string, unknown> | undefined, null)).toEqual({ sh9: shPadrao(null), fonte: "padrao" });
    expect(shDaCena({ iluminacao: { ...ok.iluminacao, origem: "padrao" } }, null).fonte).toBe("padrao");
    // ajuste degenerado (sem luz de frente) também recua para o padrão
    expect(shDaCena({ iluminacao: { ...ok.iluminacao, sh9: new Array(9).fill(0) } }, null).fonte).toBe("padrao");
  });
});

describe("razão de sombreamento (ratio image)", () => {
  const sh = shPadrao(null);
  it("peso 0 ⇒ R ≡ 1; normal inalterada ⇒ R = 1 (irradiâncias iguais ⇒ razão 1)", () => {
    for (let k = 0; k < 200; k++) {
      const a = direcao(), b = direcao();
      expect(razaoSombreamento(a, b, sh, false)).toBe(1);
      expect(razaoSombreamento(a, [...a] as Vec3, sh, true)).toBe(1);
      expect(irradianciaSH9(a, sh) / irradianciaSH9([...a] as Vec3, sh)).toBe(1);
    }
  });
  it("normal mudada: razão E(depois)/E(antes) limitada a [0,55; 1,35]", () => {
    const antes: Vec3 = [0, 0, 1];
    const paraCima = unit([0, 0.6, 0.8]);
    const paraBaixo = unit([0, -0.95, 0.3]);
    expect(razaoSombreamento(antes, paraCima, sh, true)).toBeCloseTo(irradianciaSH9(paraCima, sh) / irradianciaSH9(antes, sh), 12);
    expect(razaoSombreamento(antes, paraBaixo, sh, true)).toBeLessThan(1);
    for (let k = 0; k < 500; k++) {
      const r = razaoSombreamento(direcao(), direcao(), sh, true);
      expect(r).toBeGreaterThanOrEqual(FAIXA_RAZAO[0]);
      expect(r).toBeLessThanOrEqual(FAIXA_RAZAO[1]);
    }
  });
});

describe("shaders (trechos do three r186)", () => {
  const compilar = (m: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    return shader;
  };

  it("pele-foto: MeshBasicMaterial sem luz, textura sRGB, razão SH9 + linha pontilhada + margem completa opcional", () => {
    const tex = new THREE.Texture();
    const m = criarMaterialPeleFoto(tex, { sh9: shPadrao(null) });
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    const sh = compilar(m, THREE.ShaderLib.basic);
    expect(sh.vertexShader).toContain("vNA = objectNormal;\n#include <morphnormal_vertex>\nvND = objectNormal;");
    expect(sh.fragmentShader).toContain("irradianciaSH(normalize(vND)) / max(irradianciaSH(normalize(vNA)), 1e-3)");
    expect(sh.fragmentShader).toMatch(/step\(0\.12, vMascara\) \* step\(vMascara, 0\.30\)/);
    expect(sh.fragmentShader).toContain("uMargemCompleta");
    expect(Object.keys(sh.uniforms).sort()).toEqual(["uAmbar", "uAtivo", "uEscalaPx", "uFaixaR", "uMargemCompleta", "uSH"]);
    // o âmbar é o da legenda (#d97706)
    expect((sh.uniforms.uAmbar!.value as THREE.Color).getHexString()).toBe(COR_AMBAR.slice(1));
  });

  it("halo: casca invertida (BackSide) a +envelope pela normal deformada, âmbar, some com peso 0", () => {
    const m = criarMaterialHalo(4.5);
    expect(m.side).toBe(THREE.BackSide);
    expect(m.depthTest).toBe(true);
    expect(m.userData.deslocMm).toBe(4.5);
    expect(`#${m.color.getHexString()}`).toBe(COR_AMBAR);
    const sh = compilar(m, THREE.ShaderLib.basic);
    expect(sh.vertexShader).toContain("transformed += normalize(objectNormal) * uDesloc;");
    expect(sh.fragmentShader).toContain("if (uAtivo < 0.5 || vMascara < 0.5) discard;");
    expect(sh.uniforms.uDesloc!.value).toBe(4.5);
    // recuado 4,5 mm ao longo do raio da câmera: mesma posição na tela, perde para a pele onde a
    // casca atravessa a dobra do sulco por menos que o envelope
    expect(sh.vertexShader).toContain("mvPosition.xyz += normalize(mvPosition.xyz) * uRecuo;");
    expect(sh.uniforms.uRecuo!.value).toBe(4.5);
    // versão de máscara (pegada nos testes): sem recuo, sem hachura (superconjunto do halo visível)
    const mascara = criarMaterialHalo(4.5, { solido: true });
    const shm = compilar(mascara, THREE.ShaderLib.basic);
    expect(shm.uniforms.uRecuo!.value).toBe(0);
    expect(shm.fragmentShader).not.toContain("gl_FragCoord");
  });

  it("trecho ausente derruba a compilação (nunca um shader silenciosamente sem incerteza)", () => {
    expect(() => substituirTrecho("void main(){}", "#include <color_fragment>", "x")).toThrow(/ausente/);
    const m = criarMaterialPeleFoto(null);
    expect(() => compilar(m, { vertexShader: "void main(){}", fragmentShader: "void main(){}" })).toThrow(/ausente/);
  });
});
