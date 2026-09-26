/**
 * Fixtures sintéticas geradas em tempo de execução (nenhum dado real; nada é commitado):
 * um tetraedro de 100 mm em GLB com asset.extras.unidade = "mm" (aceito) e outro com "m"
 * (recusado), no layout de DATA_DIR/sinteticos/<nome>/torso.glb (contratos §4.2).
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function glbTetraedro(unidade: string, ladoMm = 100): Buffer {
  const pos = new Float32Array([0, 0, 0, ladoMm, 0, 0, 0, ladoMm, 0, 0, 0, ladoMm]);
  const idx = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const gltf = {
    asset: { version: "2.0", generator: "simulador-mamario/e2e", extras: { unidade, quadro: "anatomico" } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [0, 0, 0], max: [ladoMm, ladoMm, ladoMm] },
      { bufferView: 1, componentType: 5125, count: 12, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const binPad = bin.length % 4 ? Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]) : bin;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
  const cab = (tam: number, tipo: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(tam, 0);
    b.writeUInt32LE(tipo, 4);
    return b;
  };
  return Buffer.concat([header, cab(json.length, 0x4e4f534a), json, cab(binPad.length, 0x004e4942), binPad]);
}

export const OBJ_TETRAEDRO = "mtllib torso.mtl\nusemtl pele\nv 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n";
export const MTL = "newmtl pele\nKd 0.85 0.72 0.64\n";

export function prepararDataDirE2E(dir: string): void {
  const mm = join(dir, "sinteticos", "e2e_tetra_mm");
  const m = join(dir, "sinteticos", "e2e_tetra_metros");
  mkdirSync(mm, { recursive: true });
  mkdirSync(m, { recursive: true });
  writeFileSync(join(mm, "torso.glb"), glbTetraedro("mm"));
  writeFileSync(join(m, "torso.glb"), glbTetraedro("m", 0.1));
}

export const TORSOS = ["t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose"] as const;
const ARQUIVOS_TORSO = ["torso.obj", "torso.mtl", "textura.png", "torso.glb", "gabarito.json", "parametros.json"];

/**
 * Coloca os 3 torsos sintéticos do Marco 0 em <dir>/sinteticos: copia de data/sinteticos se já
 * gerados (`bash scripts/mesh.sh torsos`); senão gera direto no DATA_DIR do e2e.
 */
export function copiarTorsosSinteticos(origem: string, dir: string, raizRepo: string): void {
  const faltam = TORSOS.filter((t) => !ARQUIVOS_TORSO.every((a) => existsSync(join(origem, t, a))));
  if (faltam.length === 0) {
    for (const t of TORSOS) {
      mkdirSync(join(dir, "sinteticos", t), { recursive: true });
      for (const a of ARQUIVOS_TORSO) copyFileSync(join(origem, t, a), join(dir, "sinteticos", t, a));
    }
    return;
  }
  execSync("bash scripts/mesh.sh torsos", { cwd: raizRepo, stdio: "ignore", env: { ...process.env, DATA_DIR: dir } });
}
