/**
 * "Fotos de exemplo" SINTÉTICAS para o e2e (plano "foto → 3D", P3-lite/P4-lite), geradas em tempo
 * de execução no DATA_DIR temporário do e2e (nada é commitado; nenhuma imagem real). Enquanto o
 * pipeline do services/mesh (P1/P2) não prepara `sinteticos/<torso>/foto/`, este módulo faz o papel
 * dele com o caso mais simples: a "reconstrução" é o próprio torso sintético (template exato) e a
 * foto é esse torso renderizado (z-buffer em CPU, textura do gerador) por uma câmera frontal
 * conhecida (K, R, t). Assim a foto e a malha coincidem por construção, como numa reconstrução
 * perfeita, e o e2e confere o que é do web: câmera, compósito, localidade, selo e incerteza.
 *
 * Layout gerado (o mesmo que a rota `importar-foto` lê do pipeline real):
 *   sinteticos/<torso>/foto/reconstrucao.json   (C1, reconstrucao/1.0)
 *   sinteticos/<torso>/foto/original/foto_frente.png
 *   sinteticos/<torso>/foto/torso.obj|.mtl, textura.png   (a malha "reconstruída")
 *   sinteticos/<torso>/foto/observado.png       (C3: 255 onde a foto viu a superfície)
 *   sinteticos/<torso>/foto/avaliacao.json      (avaliacao_reconstrucao/1.0; aqui zero: malha = gabarito)
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

type V3 = [number, number, number];

// ------------------------------------------------------------------ PNG (RGB/L 8 bits, sem entrelaçamento)
interface Imagem {
  largura: number;
  altura: number;
  canais: number;
  dados: Uint8Array;
}

function lerPng(buf: Buffer): Imagem {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("não é PNG");
  let p = 8;
  let largura = 0, altura = 0, canais = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p);
    const tipo = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + n);
    if (tipo === "IHDR") {
      largura = d.readUInt32BE(0);
      altura = d.readUInt32BE(4);
      if (d[8] !== 8 || d[12] !== 0) throw new Error("PNG não suportado (só 8 bits, sem entrelaçamento)");
      canais = ({ 0: 1, 2: 3, 6: 4 } as Record<number, number>)[d[9]!] ?? 0;
      if (!canais) throw new Error(`tipo de cor PNG não suportado: ${d[9]}`);
    } else if (tipo === "IDAT") idat.push(d);
    else if (tipo === "IEND") break;
    p += 12 + n;
  }
  const bruto = inflateSync(Buffer.concat(idat));
  const passo = largura * canais;
  const dados = new Uint8Array(altura * passo);
  for (let y = 0; y < altura; y++) {
    const f = bruto[y * (passo + 1)]!;
    const lin = bruto.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1));
    const o = y * passo;
    for (let x = 0; x < passo; x++) {
      const a = x >= canais ? dados[o + x - canais]! : 0;
      const b = y > 0 ? dados[o - passo + x]! : 0;
      const c = x >= canais && y > 0 ? dados[o - passo + x - canais]! : 0;
      let v = lin[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      dados[o + x] = v & 0xff;
    }
  }
  return { largura, altura, canais, dados };
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function escreverPng(im: Imagem): Buffer {
  const tipoCor = ({ 1: 0, 3: 2, 4: 6 } as Record<number, number>)[im.canais]!;
  const passo = im.largura * im.canais;
  const bruto = Buffer.alloc(im.altura * (passo + 1));
  for (let y = 0; y < im.altura; y++) Buffer.from(im.dados.buffer, im.dados.byteOffset + y * passo, passo).copy(bruto, y * (passo + 1) + 1);
  const bloco = (tipo: string, d: Buffer) => {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(tipo, "ascii"), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(td));
    return Buffer.concat([n, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(im.largura, 0);
  ihdr.writeUInt32BE(im.altura, 4);
  ihdr[8] = 8;
  ihdr[9] = tipoCor;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(bruto, { level: 6 })), bloco("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ OBJ (v, vt, f a/b[/c])
interface Obj {
  v: Float64Array;
  vt: Float64Array;
  /** por face: 3 índices de vértice e 3 de vt */
  fv: Uint32Array;
  ft: Uint32Array;
}

function lerObj(texto: string): Obj {
  const v: number[] = [], vt: number[] = [], fv: number[] = [], ft: number[] = [];
  for (const l of texto.split("\n")) {
    if (l.startsWith("v ")) {
      const p = l.split(/\s+/);
      v.push(+p[1]!, +p[2]!, +p[3]!);
    } else if (l.startsWith("vt ")) {
      const p = l.split(/\s+/);
      vt.push(+p[1]!, +p[2]!);
    } else if (l.startsWith("f ")) {
      const c = l.trim().split(/\s+/).slice(1).map((x) => x.split("/"));
      for (let k = 1; k + 1 < c.length; k++)
        for (const q of [c[0]!, c[k]!, c[k + 1]!]) {
          fv.push(+q[0]! - 1);
          ft.push(+(q[1] || q[0]!) - 1);
        }
    }
  }
  return { v: Float64Array.from(v), vt: Float64Array.from(vt), fv: Uint32Array.from(fv), ft: Uint32Array.from(ft) };
}

// ------------------------------------------------------------------ câmera (C1: coluna-major, centro do pixel)
export interface CameraSintetica {
  K: number[];
  R: number[];
  t: V3;
  largura_px: number;
  altura_px: number;
}

/** Câmera frontal clínica: olha para −z anatômico, FOV vertical 15°, centrada no meio dos mamilos. */
export function cameraFrontal(centro: V3, distancia = 1700, largura = 960, altura = 720): CameraSintetica {
  const f = altura / 2 / Math.tan((7.5 * Math.PI) / 180);
  // R = diag(1, −1, −1): x da imagem = +x anatômico (esquerda da paciente à direita da foto), y para baixo = −y
  const C: V3 = [centro[0], centro[1], centro[2] + distancia];
  return { K: [f, 0, 0, 0, f, 0, (largura - 1) / 2, (altura - 1) / 2, 1], R: [1, 0, 0, 0, -1, 0, 0, 0, -1], t: [-C[0], C[1], C[2]], largura_px: largura, altura_px: altura };
}

const el = (m: number[], i: number, j: number) => m[j * 3 + i]!;
function projetar(c: CameraSintetica, x: number, y: number, z: number): [number, number, number] {
  const xc = el(c.R, 0, 0) * x + el(c.R, 0, 1) * y + el(c.R, 0, 2) * z + c.t[0];
  const yc = el(c.R, 1, 0) * x + el(c.R, 1, 1) * y + el(c.R, 1, 2) * z + c.t[1];
  const zc = el(c.R, 2, 0) * x + el(c.R, 2, 1) * y + el(c.R, 2, 2) * z + c.t[2];
  return [el(c.K, 0, 0) * (xc / zc) + el(c.K, 0, 1) * (yc / zc) + el(c.K, 0, 2), el(c.K, 1, 1) * (yc / zc) + el(c.K, 1, 2), zc];
}

// ------------------------------------------------------------------ render (z-buffer, textura bilinear)
const FUNDO_FOTO: V3 = [0x8a, 0x8f, 0x96];

function amostrar(t: Imagem, u: number, v: number, saida: number[]): void {
  const x = u * t.largura - 0.5, y = (1 - v) * t.altura - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx: number, yy: number, c: number) => t.dados[(Math.min(t.altura - 1, Math.max(0, yy)) * t.largura + (((xx % t.largura) + t.largura) % t.largura)) * t.canais + c]!;
  for (let c = 0; c < 3; c++)
    saida[c] = (px(x0, y0, c) * (1 - fx) + px(x0 + 1, y0, c) * fx) * (1 - fy) + (px(x0, y0 + 1, c) * (1 - fx) + px(x0 + 1, y0 + 1, c) * fx) * fy;
}

/** Foto da malha pela câmera; devolve a imagem e os triângulos vistos (algum pixel ganhou o z-buffer). */
export function renderizarFoto(obj: Obj, tex: Imagem, cam: CameraSintetica): { foto: Imagem; vistos: Uint8Array } {
  const W = cam.largura_px, H = cam.altura_px;
  const nv = obj.v.length / 3;
  const P = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) P.set(projetar(cam, obj.v[3 * i]!, obj.v[3 * i + 1]!, obj.v[3 * i + 2]!), 3 * i);
  const z = new Float64Array(W * H).fill(Infinity);
  const dono = new Int32Array(W * H).fill(-1);
  const uvp = new Float64Array(W * H * 2);
  const nf = obj.fv.length / 3;
  for (let f = 0; f < nf; f++) {
    const a = obj.fv[3 * f]!, b = obj.fv[3 * f + 1]!, c = obj.fv[3 * f + 2]!;
    const ax = P[3 * a]!, ay = P[3 * a + 1]!, az = P[3 * a + 2]!;
    const bx = P[3 * b]!, by = P[3 * b + 1]!, bz = P[3 * b + 2]!;
    const cx = P[3 * c]!, cy = P[3 * c + 1]!, cz = P[3 * c + 2]!;
    if (az <= 0 || bz <= 0 || cz <= 0) continue;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.floor(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy)));
    const ta = obj.ft[3 * f]!, tb = obj.ft[3 * f + 1]!, tc = obj.ft[3 * f + 2]!;
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // interpolação perspectivamente correta (1/z)
        const i0 = w0 / az, i1 = w1 / bz, i2 = w2 / cz, s = i0 + i1 + i2;
        const zp = 1 / s;
        const k = py * W + px;
        if (zp >= z[k]!) continue;
        z[k] = zp;
        dono[k] = f;
        uvp[2 * k] = (i0 * obj.vt[2 * ta]! + i1 * obj.vt[2 * tb]! + i2 * obj.vt[2 * tc]!) / s;
        uvp[2 * k + 1] = (i0 * obj.vt[2 * ta + 1]! + i1 * obj.vt[2 * tb + 1]! + i2 * obj.vt[2 * tc + 1]!) / s;
      }
  }
  const foto: Imagem = { largura: W, altura: H, canais: 3, dados: new Uint8Array(W * H * 3) };
  const vistos = new Uint8Array(nf);
  const cor = [0, 0, 0];
  for (let k = 0; k < W * H; k++) {
    if (dono[k]! < 0) {
      foto.dados.set(FUNDO_FOTO, 3 * k);
      continue;
    }
    vistos[dono[k]!] = 1;
    amostrar(tex, uvp[2 * k]!, uvp[2 * k + 1]!, cor);
    for (let c = 0; c < 3; c++) foto.dados[3 * k + c] = Math.round(cor[c]!);
  }
  return { foto, vistos };
}

/** observado.png no atlas UV (mesma orientação da textura): 255 nos triângulos vistos, 0 no resto. */
export function mapaObservado(obj: Obj, vistos: Uint8Array, largura = 848, altura = 475): { img: Imagem; coberturaPct: number } {
  const img: Imagem = { largura, altura, canais: 1, dados: new Uint8Array(largura * altura) };
  const coberto = new Uint8Array(largura * altura);
  const nf = obj.fv.length / 3;
  for (let f = 0; f < nf; f++) {
    const q = [0, 1, 2].map((k) => {
      const t = obj.ft[3 * f + k]!;
      return [obj.vt[2 * t]! * largura - 0.5, (1 - obj.vt[2 * t + 1]!) * altura - 0.5] as const;
    });
    const [[ax, ay], [bx, by], [cx, cy]] = q as unknown as [[number, number], [number, number], [number, number]];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(largura - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(altura - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        // margem de meio texel: sem frestas entre triângulos vizinhos
        if (w0 < -0.02 || w1 < -0.02 || 1 - w0 - w1 < -0.02) continue;
        const k = py * largura + px;
        coberto[k] = 1;
        if (vistos[f]) img.dados[k] = 255;
      }
  }
  let n = 0, obs = 0;
  for (let k = 0; k < coberto.length; k++) {
    if (!coberto[k]) continue;
    n++;
    if (img.dados[k]) obs++;
  }
  return { img, coberturaPct: n ? (100 * obs) / n : 0 };
}

// ------------------------------------------------------------------ preparação da pasta foto/
const PONTOS = ["furcula", "mamilo_dir", "mamilo_esq", "sulco_dir", "sulco_esq", "linha_media_inferior", "base_medial_dir", "base_lateral_dir", "base_medial_esq", "base_lateral_esq"];

export function gerarFotoExemplo(pastaTorso: string): void {
  const saida = join(pastaTorso, "foto");
  mkdirSync(join(saida, "original"), { recursive: true });
  const gabarito = JSON.parse(readFileSync(join(pastaTorso, "gabarito.json"), "utf8")) as { landmarks: Record<string, { posicao: V3 }>; nome?: string };
  const lm = gabarito.landmarks;
  const md = lm.mamilo_dir!.posicao, me = lm.mamilo_esq!.posicao;
  const cam = cameraFrontal([(md[0] + me[0]) / 2, (md[1] + me[1]) / 2, Math.max(md[2], me[2])]);
  const obj = lerObj(readFileSync(join(pastaTorso, "torso.obj"), "utf8"));
  const tex = lerPng(readFileSync(join(pastaTorso, "textura.png")));
  const { foto, vistos } = renderizarFoto(obj, tex, cam);
  writeFileSync(join(saida, "original", "foto_frente.png"), escreverPng(foto));
  const obs = mapaObservado(obj, vistos);
  writeFileSync(join(saida, "observado.png"), escreverPng(obs.img));
  for (const a of ["torso.obj", "torso.mtl", "textura.png"]) copyFileSync(join(pastaTorso, a), join(saida, a));
  const landmarks_2d: Record<string, [number, number]> = {};
  for (const id of PONTOS) {
    const p = lm[id]?.posicao;
    if (!p) continue;
    const [u, v] = projetar(cam, p[0], p[1], p[2]);
    landmarks_2d[id] = [Math.round(u * 100) / 100, Math.round(v * 100) / 100];
  }
  const reconstrucao = {
    esquema: "reconstrucao/1.0",
    _fixture: "e2e: malha = torso sintético (reconstrução perfeita), foto renderizada por câmera conhecida — não é saída do services/mesh",
    fotos: [{ vista: "frente", arquivo: "original/foto_frente.png", largura_px: cam.largura_px, altura_px: cam.altura_px, K: cam.K, R: cam.R, t: cam.t, k1: 0, f_origem: "estimado", landmarks_2d, residuos_px: Object.fromEntries(Object.keys(landmarks_2d).map((k) => [k, 0])), rms_px: 0 }],
    escala: { metodo: "ssn_n_fita", valor_mm: null, fator: 1 },
    residuo_silhueta_mm: 0,
    // só a frontal: a profundidade é o prior do template (plano §2)
    incerteza_por_eixo_mm: { x: 1.8, y: 2.1, z: 12.4 },
    incerteza_volume_pct: 30,
    qualidade: "boa",
    avisos: ["so_frontal_profundidade_ilustrativa"],
    cobertura_observada_pct: Math.round(obs.coberturaPct * 10) / 10,
    forma_fora_do_modelo: false,
    reprojecao_rms_px: 0,
    versao_software: "0.2.0",
    gerado_em: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  writeFileSync(join(saida, "reconstrucao.json"), JSON.stringify(reconstrucao, null, 2));
  const avaliacao = {
    esquema: "avaliacao_reconstrucao/1.0",
    _fixture: "e2e: a malha é o próprio gabarito — erro zero por construção",
    torso: gabarito.nome ?? null,
    n_fotos: 1,
    rms_mm: { x: 0, y: 0, z: 0 },
    volume_erro_pct: { dir: 0, esq: 0 },
    landmarks_erro_mm: { medio: 0, max: 0 },
    reprojecao_rms_px: 0,
  };
  writeFileSync(join(saida, "avaliacao.json"), JSON.stringify(avaliacao, null, 2));
}

/**
 * Coloca as "fotos de exemplo" em <dir>/sinteticos/<torso>/foto: copia as do pipeline real se o
 * repositório já as tiver (data/sinteticos/<torso>/foto/reconstrucao.json, P1/P2/P4); senão gera
 * a fixture acima.
 */
export function prepararFotosExemplo(origem: string, dir: string, torsos: readonly string[]): void {
  for (const t of torsos) {
    const destino = join(dir, "sinteticos", t);
    if (!existsSync(join(destino, "torso.obj"))) continue;
    const real = join(origem, t, "foto");
    if (existsSync(join(real, "reconstrucao.json"))) cpSync(real, join(destino, "foto"), { recursive: true });
    else gerarFotoExemplo(destino);
  }
}
