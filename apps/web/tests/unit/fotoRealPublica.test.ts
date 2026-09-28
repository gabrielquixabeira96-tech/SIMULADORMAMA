/**
 * Reconstrução por fotos no web (plano "foto → 3D", P3-lite/P4-lite): leitura do C1
 * (`reconstrucao.json` ou `asset.extras` do `processada.glb`), resumo enviado ao navegador
 * redigido por desenho (A sem números), halo = max(envelope; z), profundidade "só ilustração" sem
 * perfil, e os textos dos cartões de incerteza e de erro contra o gabarito.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reconstrucaoSchema } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { fotoRealPublica, linhasErroGabarito, linhasIncerteza, textoEscala } from "@/foto/publica";
import { jsonDoGlb, lerReconstrucao } from "@/foto/servidor";

const C1 = JSON.parse(readFileSync(join(__dirname, "../fixtures/foto3d/reconstrucao_t01_frente.json"), "utf8"));
const rec = reconstrucaoSchema.parse(C1);
const AV = { esquema: "avaliacao_reconstrucao/1.0", rms_mm: { x: 1.2, y: 1.4, z: 9.8 }, volume_erro_pct: { dir: -12, esq: -9 }, landmarks_erro_mm: { medio: 1.9, max: 3.1 }, reprojecao_rms_px: 0.4 } as const;

/** GLB mínimo (1 triângulo) com asset.extras dado. */
function glbComExtras(extras: Record<string, unknown>): Buffer {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = Buffer.from(pos.buffer);
  const gltf = {
    asset: { version: "2.0", extras: { unidade: "mm", quadro: "anatomico", ...extras } },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const cab = Buffer.alloc(12);
  cab.writeUInt32LE(0x46546c67, 0);
  cab.writeUInt32LE(2, 4);
  cab.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (n: number, t: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(n, 0);
    b.writeUInt32LE(t, 4);
    return b;
  };
  return Buffer.concat([cab, chunk(json.length, 0x4e4f534a), json, chunk(bin.length, 0x004e4942), bin]);
}

describe("resumo da reconstrução para o navegador", () => {
  it("B: câmeras, halo = max(4,5; z), números e erro contra o gabarito; sem perfil a profundidade é só ilustração", () => {
    const f = fotoRealPublica(rec, { envelopeMm: 4.5, numerosPermitidos: true, observado: true, avaliacao: AV });
    expect(f.n_fotos).toBe(1);
    expect(f.fotos[0]).toMatchObject({ vista: "frente", arquivo: "original/foto_frente.png", largura_px: 960, altura_px: 720, t: [0, -165, 1350] });
    expect(f.halo_mm).toBe(12.4);
    expect(f.profundidade_so_ilustracao).toBe(true);
    expect(f.numeros?.incerteza_por_eixo_mm).toEqual({ x: 1.8, y: 2.1, z: 12.4 });
    expect(f.numeros?.reprojecao_rms_px).toBeCloseTo(0.4, 9); // do rms das fotos
    expect(f.erro_gabarito?.rms_mm.z).toBe(9.8);
    // a escala sai só como método (texto sem números): a fita SSN–N é distância em linha reta
    expect(f.escala_metodo).toBe("ssn_n_fita");
    expect(textoEscala(f.escala_metodo)).toMatch(/linha reta/);
    expect(textoEscala(f.escala_metodo)).not.toMatch(/\d/);
    expect(textoEscala(null)).toBeNull();
    expect(linhasIncerteza(f).join(" · ")).toBe("Largura ±1,8 mm · altura ±2,1 mm · Profundidade ±12,4 mm — só ilustração (sem foto de perfil) · Volume ±30 %");
    expect(linhasErroGabarito(f.erro_gabarito!)).toEqual([
      "RMS na região das mamas: x 1,2 mm · y 1,4 mm · z 9,8 mm",
      "Volume: −12 % D / −9 % E",
      "Pontos anatômicos: médio 1,9 mm · máximo 3,1 mm",
      "Reprojeção: 0,4 px",
    ]);
  });

  it("A: nenhum número calculado (nem incerteza em mm, nem erro contra o gabarito); o halo continua (incerteza sempre visível)", () => {
    const f = fotoRealPublica(rec, { envelopeMm: 4.5, numerosPermitidos: false, observado: true, avaliacao: AV });
    expect(f.numeros).toBeNull();
    expect(f.erro_gabarito).toBeNull();
    expect(f.halo_mm).toBe(12.4);
    const l = linhasIncerteza(f).join(" ");
    expect(l).not.toMatch(/\d/);
    expect(l).toMatch(/só ilustração/);
  });

  it("com perfil a profundidade deixa de ser só ilustração; z pequeno ⇒ halo = envelope; forma fora do modelo pelo aviso ou pelo booleano", () => {
    const perfil = { ...C1.fotos[0], vista: "perfil_dir", arquivo: "original/foto_perfil_dir.jpg" };
    const r3 = reconstrucaoSchema.parse({ ...C1, fotos: [C1.fotos[0], perfil], incerteza_por_eixo_mm: { x: 1.5, y: 1.5, z: 3.2 }, avisos: ["forma_fora_do_modelo"] });
    const f = fotoRealPublica(r3, { envelopeMm: 4.5, numerosPermitidos: true, observado: false });
    expect(f.profundidade_so_ilustracao).toBe(false);
    expect(f.halo_mm).toBe(4.5);
    expect(f.forma_fora_do_modelo).toBe(true);
    expect(f.erro_gabarito).toBeNull();
    expect(linhasIncerteza(f)[1]).toBe("Profundidade ±3,2 mm");
    expect(fotoRealPublica(reconstrucaoSchema.parse({ ...C1, forma_fora_do_modelo: true }), { envelopeMm: 4.5, numerosPermitidos: true, observado: false }).forma_fora_do_modelo).toBe(true);
  });
});

describe("leitura no servidor (pasta da malha em DATA_DIR)", () => {
  const malhaDir = (n: string) => {
    const rel = `pacientes/P-TESTE1/malhas/${n}`;
    mkdirSync(join(process.env.DATA_DIR!, rel), { recursive: true });
    return rel;
  };

  it("reconstrucao.json + avaliacao.json + observado.png", async () => {
    const rel = malhaDir("a");
    const abs = join(process.env.DATA_DIR!, rel);
    writeFileSync(join(abs, "reconstrucao.json"), JSON.stringify(C1));
    writeFileSync(join(abs, "avaliacao.json"), JSON.stringify(AV));
    writeFileSync(join(abs, "observado.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const l = await lerReconstrucao(rel);
    expect(l?.fonte).toBe("reconstrucao.json");
    expect(l?.observado).toBe(true);
    expect(l?.avaliacao?.rms_mm.x).toBe(1.2);
    expect(l?.reconstrucao.fotos).toHaveLength(1);
  });

  it("sem reconstrucao.json: asset.extras do processada.glb com origem 'foto' (só o bloco JSON é lido)", async () => {
    const rel = malhaDir("b");
    const abs = join(process.env.DATA_DIR!, rel);
    const { _nota, ...c1 } = C1;
    void _nota;
    writeFileSync(join(abs, "processada.glb"), glbComExtras({ origem: "foto", reconstrucao: c1, avaliacao: AV }));
    expect((await jsonDoGlb(join(abs, "processada.glb")))?.asset).toBeTruthy();
    const l = await lerReconstrucao(rel);
    expect(l?.fonte).toBe("glb");
    expect(l?.reconstrucao.incerteza_por_eixo_mm.z).toBe(12.4);
    expect(l?.avaliacao?.volume_erro_pct).toEqual({ dir: -12, esq: -9 });
    expect(l?.observado).toBe(false);
  });

  it("malha de scan (sem C1 e sem origem 'foto') → null; arquivo que não é GLB → null", async () => {
    const rel = malhaDir("c");
    const abs = join(process.env.DATA_DIR!, rel);
    writeFileSync(join(abs, "processada.glb"), glbComExtras({ esquema: "malha_meta/1.0" }));
    expect(await lerReconstrucao(rel)).toBeNull();
    writeFileSync(join(abs, "processada.glb"), "não é glb");
    expect(await lerReconstrucao(rel)).toBeNull();
    expect(await lerReconstrucao(malhaDir("d"))).toBeNull();
  });
});
