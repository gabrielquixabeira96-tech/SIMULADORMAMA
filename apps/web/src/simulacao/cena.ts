import * as THREE from "three";
import { criarMaterialHalo, criarMaterialPeleFoto, type SH9, type UniformsHalo, type UniformsPeleFoto } from "./materialFoto";

/**
 * Cena de uma superfície simulada (contratos §10.3; restrição 3 da PROMPT; ADR 0019):
 * a pele deformada por morph targets NUNCA existe sem o envelope de incerteza. O único jeito de
 * obter a malha simulada é `criarCenaSimulada`, que devolve a pele JÁ com o envelope ±envelope_rms_mm
 * sobre a região que o implante altera: halo âmbar (casca invertida a +envelope ao longo da
 * normal da superfície deformada, visível como faixa hachurada na silhueta) e linha pontilhada
 * na borda da região simulada, pintada na própria pele. A pele é a textura do scan SEM luz somada
 * ("modo foto", `materialFoto.ts`): o "depois" é a mesma foto com a razão de sombreamento SH9.
 * O web não calcula deformação: só interpola os targets pré-computados pelo services/mesh.
 */

export class EnvelopeAusenteError extends Error {
  constructor(msg = "simulação sem envelope de incerteza") {
    super(msg);
    this.name = "EnvelopeAusenteError";
  }
}

export interface CenaSimulada {
  readonly grupo: THREE.Group;
  readonly pele: THREE.Mesh;
  /** halo da incerteza: casca invertida a +envelope (faixa âmbar na silhueta) */
  readonly cascas: readonly [THREE.Mesh];
  readonly envelopeMm: number;
  readonly nomesTargets: readonly string[];
  /** Ativa um target (por nome) com peso ∈ [0, 1]; null = "antes". */
  definir(nomeTarget: string | null, peso: number): void;
  /** Mostra/esconde a cena inteira (pele + envelope juntos: nunca a pele sozinha). */
  mostrar(visivel: boolean): void;
  /** Coeficientes SH9 (contrato C1) usados na razão de sombreamento do "depois". */
  definirIluminacao(sh9: SH9): void;
  /** "Mostrar margem completa": a faixa pintada antiga por cima da pele. Só acrescenta; não muda `estado()`. */
  definirMargemCompleta(ligada: boolean): void;
  /** Pixels do dispositivo por pixel de referência (a hachura e o pontilhado mantêm a largura aparente). */
  definirEscalaTracejado(pxPorReferencia: number): void;
  /**
   * Posição do olho da câmera (mundo) para o descarte antecipado das faces de costas da pele;
   * null desliga (desenha o índice completo). Só retira triângulos que a GPU descartaria de
   * qualquer forma (face de costas em todo o intervalo de peso do alvo ativo, com margem): a
   * imagem é a mesma, com menos trabalho de vértice/primitiva.
   */
  atualizarVista(olhoMundo: THREE.Vector3 | null): void;
  /** Estado para asserções (e2e/unit): envelope presente e visível sempre que peso > 0. */
  estado(): { alvo: string | null; peso: number; envelope_mm: number; envelope_visivel: boolean; pele_visivel: boolean };
  descartar(): void;
}

/**
 * Margem do descarte de costas (cosseno entre a normal do triângulo e a direção ao olho): um
 * triângulo só sai do índice se estiver de costas além de ~5,7° em TODO peso w ∈ [0, 1] do alvo
 * ativo (ver `indicesDeFrente`).
 */
const MARGEM_COSTAS = 0.1;
/** Subintervalos de peso usados só nos triângulos limítrofes do descarte (cotas mais justas). */
const SUBDIV = 4;
/** Deslocamento mínimo do olho (mm, espaço do objeto) que refaz o descarte. */
const EPS_OLHO_MM = 1e-3;

/** Limiar (mm) a partir do qual o vértice conta como "deformado" para a máscara do envelope. */
const MASCARA_MIN_MM = 1.0;
const MASCARA_CHEIA_MM = 3.0;

/**
 * Ordem de triângulos amigável ao cache de vértices (Tipsify; Sander, Nehab & Barczak, 2007).
 * Só reordena os triângulos (cada um mantém seus 3 índices e o sentido de giro): a malha
 * desenhada é a mesma. Em GPU por software (SwiftShader) e em GPUs móveis, reduz as execuções
 * do vertex shader (morph + normal) por triângulo.
 */
export function ordenarTriangulosCache(indices: ArrayLike<number>, nVertices: number, tamanhoCache = 16): Uint32Array {
  const nTri = (indices.length / 3) | 0;
  const cont = new Uint32Array(nVertices);
  for (let i = 0; i < nTri * 3; i++) cont[indices[i]!]!++;
  const inicio = new Uint32Array(nVertices + 1);
  for (let v = 0; v < nVertices; v++) inicio[v + 1] = inicio[v]! + cont[v]!;
  const cursor = inicio.slice(0, nVertices);
  const adj = new Uint32Array(nTri * 3);
  for (let i = 0; i < nTri * 3; i++) adj[cursor[indices[i]!]!++] = (i / 3) | 0;
  const vivos = cont.slice();
  const tempoCache = new Int32Array(nVertices);
  const emitido = new Uint8Array(nTri);
  const pilha: number[] = [];
  const saida = new Uint32Array(nTri * 3);
  let o = 0;
  let tempo = tamanhoCache + 1;
  let proximo = 0;
  let leque = nTri > 0 ? indices[0]! : -1;
  const candidatos: number[] = [];
  while (leque >= 0) {
    candidatos.length = 0;
    for (let a = inicio[leque]!; a < inicio[leque + 1]!; a++) {
      const t = adj[a]!;
      if (emitido[t]) continue;
      emitido[t] = 1;
      for (let c = 0; c < 3; c++) {
        const v = indices[3 * t + c]!;
        saida[o++] = v;
        pilha.push(v);
        candidatos.push(v);
        vivos[v]!--;
        if (tempo - tempoCache[v]! > tamanhoCache) tempoCache[v] = tempo++;
      }
    }
    // próximo leque: vértice ainda vivo que continua no cache, o mais antigo possível
    let escolhido = -1;
    let melhor = -1;
    for (const v of candidatos) {
      if (vivos[v]! <= 0) continue;
      const idade = tempo - tempoCache[v]!;
      const prio = idade + 2 * vivos[v]! <= tamanhoCache ? idade : 0;
      if (prio > melhor) {
        melhor = prio;
        escolhido = v;
      }
    }
    if (escolhido < 0) {
      while (pilha.length) {
        const d = pilha.pop()!;
        if (vivos[d]! > 0) {
          escolhido = d;
          break;
        }
      }
    }
    if (escolhido < 0) {
      while (proximo < nVertices && vivos[proximo] === 0) proximo++;
      escolhido = proximo < nVertices ? proximo : -1;
    }
    leque = escolhido;
  }
  return saida;
}

const otimizadas = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Cópia da geometria com triângulos em ordem de cache e vértices renumerados pela ordem de
 * primeiro uso (atributos e morph targets permutados juntos). Posições, normais, deltas e
 * triângulos são os MESMOS, só em outra ordem na memória: o resultado geométrico não muda.
 * Memoizada por geometria base (os painéis e as trocas de cena reusam a mesma cópia).
 */
export function geometriaOtimizada(base: THREE.BufferGeometry): THREE.BufferGeometry {
  const pronta = otimizadas.get(base);
  if (pronta) return pronta;
  const n = base.getAttribute("position").count;
  const idxBase = base.getIndex();
  const indices = idxBase ? idxBase.array : Uint32Array.from({ length: n - (n % 3) }, (_, i) => i);
  const ordem = ordenarTriangulosCache(indices, n);
  const novoDe = new Int32Array(n).fill(-1);
  let k = 0;
  for (let i = 0; i < ordem.length; i++) if (novoDe[ordem[i]!]! < 0) novoDe[ordem[i]!] = k++;
  for (let v = 0; v < n; v++) if (novoDe[v]! < 0) novoDe[v] = k++;
  // cópia crua (sem desnormalizar): mesmo tipo, mesmos valores, outra ordem
  const permutar = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute => {
    const is = a.itemSize;
    const inter = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute) : null;
    const src = (inter ? inter.data.array : a.array) as Float32Array;
    const passo = inter ? inter.data.stride : is;
    const desloc = inter ? inter.offset : 0;
    const dst = new (src.constructor as new (n: number) => Float32Array)(n * is);
    for (let v = 0; v < n; v++) {
      const d = novoDe[v]! * is;
      const o = v * passo + desloc;
      for (let c = 0; c < is; c++) dst[d + c] = src[o + c]!;
    }
    return new THREE.BufferAttribute(dst, is, a.normalized);
  };
  const g = new THREE.BufferGeometry();
  for (const [nome, attr] of Object.entries(base.attributes)) g.setAttribute(nome, permutar(attr));
  g.morphAttributes = Object.fromEntries(Object.entries(base.morphAttributes).map(([nome, lista]) => [nome, lista.map(permutar)]));
  g.morphTargetsRelative = base.morphTargetsRelative;
  const novoIdx = new Uint32Array(ordem.length);
  for (let i = 0; i < ordem.length; i++) novoIdx[i] = novoDe[ordem[i]!]!;
  g.setIndex(new THREE.BufferAttribute(novoIdx, 1));
  g.boundingBox = base.boundingBox;
  g.boundingSphere = base.boundingSphere;
  otimizadas.set(base, g);
  return g;
}

const float32Cache = new WeakMap<THREE.BufferAttribute, Float32Array>();
/** Valores (desnormalizados) de um atributo vec3 como Float32Array compacto; memoizado. */
function comoFloat32(a: THREE.BufferAttribute): Float32Array {
  const pronto = float32Cache.get(a);
  if (pronto) return pronto;
  let r: Float32Array;
  if (a.array instanceof Float32Array && a.itemSize === 3 && !a.normalized) r = a.array;
  else {
    r = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      r[3 * i] = a.getX(i);
      r[3 * i + 1] = a.getY(i);
      r[3 * i + 2] = a.getZ(i);
    }
  }
  float32Cache.set(a, r);
  return r;
}

/**
 * Copia para `saida` os triângulos de `indices` que podem estar de FRENTE para o olho (espaço do
 * objeto) em algum peso w ∈ [0, 1] do alvo ativo. Devolve o número de índices copiados. Mantém a
 * ordem e o sentido de giro: os triângulos que ficam são desenhados exatamente como antes.
 *
 * O morph é linear no peso: cada vértice é p(w) = P + w·Q (relativo: Q = delta; absoluto:
 * Q = alvo − base). Assim, para o triângulo (a, b, c), com u = b − a e v = c − a,
 *   n(w) = u(w) × v(w) = n0 + n1·w + n2·w²,   f(w) = olho − a(w) = f0 + f1·w,
 *   d(w) = n(w)·f(w) = c0 + c1·w + c2·w² + c3·w³ (cúbico),
 * e d(w) ≥ 0 ⇔ o triângulo está de frente em w (é o sinal que decide o giro na projeção).
 * O máximo exato de d em [0, 1] é tomado entre os extremos e as raízes de d′ dentro do intervalo.
 *
 * Garantia (em aritmética real; o arredondamento em float64 é desprezível frente à margem): um
 * triângulo só é descartado se, para TODO w ∈ [0, 1],
 *   d(w) < −MARGEM_COSTAS · |n(w)| · |f(w)|,
 * isto é, se estiver de costas além de ~5,7° em todos os pesos. Para isso exige-se, num
 * intervalo de pesos I, máx_I d < −MARGEM_COSTAS · N · F, com N ≥ |n(w)| e F ≥ |f(w)| em I
 * (cotas pela expansão exata de n e f em torno do centro de I): primeiro com I = [0, 1]; nos casos
 * limítrofes, em cada um de SUBDIV subintervalos (todos precisam passar). Cotas folgadas só fazem
 * MANTER triângulos a mais, nunca descartar um de frente. Sem alvo (ou vértices que o alvo não
 * move), N e F são exatos e o teste é o de peso 0. Degenerados (n ≡ 0) ficam.
 */
export function indicesDeFrente(
  indices: ArrayLike<number>,
  pos: Float32Array,
  delta: Float32Array | null,
  deltaRelativo: boolean,
  olho: { x: number; y: number; z: number },
  saida: Uint32Array,
): number {
  const m = MARGEM_COSTAS;
  const absoluto = delta !== null && !deltaRelativo;
  let k = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = 3 * indices[t]!, b = 3 * indices[t + 1]!, c = 3 * indices[t + 2]!;
    const pax = pos[a]!, pay = pos[a + 1]!, paz = pos[a + 2]!;
    const u0x = pos[b]! - pax, u0y = pos[b + 1]! - pay, u0z = pos[b + 2]! - paz;
    const v0x = pos[c]! - pax, v0y = pos[c + 1]! - pay, v0z = pos[c + 2]! - paz;
    const n0x = u0y * v0z - u0z * v0y, n0y = u0z * v0x - u0x * v0z, n0z = u0x * v0y - u0y * v0x;
    const f0x = olho.x - pax, f0y = olho.y - pay, f0z = olho.z - paz;
    const c0 = n0x * f0x + n0y * f0y + n0z * f0z;
    const nn0 = Math.hypot(n0x, n0y, n0z), nf0 = Math.hypot(f0x, f0y, f0z);
    let frente: boolean;
    if (delta === null) {
      frente = c0 >= -m * nn0 * nf0;
    } else {
      // velocidades Q = dp/dw dos três vértices
      let qax = delta[a]!, qay = delta[a + 1]!, qaz = delta[a + 2]!;
      let qbx = delta[b]!, qby = delta[b + 1]!, qbz = delta[b + 2]!;
      let qcx = delta[c]!, qcy = delta[c + 1]!, qcz = delta[c + 2]!;
      if (absoluto) {
        qax -= pax; qay -= pay; qaz -= paz;
        qbx -= pos[b]!; qby -= pos[b + 1]!; qbz -= pos[b + 2]!;
        qcx -= pos[c]!; qcy -= pos[c + 1]!; qcz -= pos[c + 2]!;
      }
      const u1x = qbx - qax, u1y = qby - qay, u1z = qbz - qaz;
      const v1x = qcx - qax, v1y = qcy - qay, v1z = qcz - qaz;
      // n1 = u0×v1 + u1×v0; n2 = u1×v1; f1 = −Qa
      const n1x = u0y * v1z - u0z * v1y + (u1y * v0z - u1z * v0y);
      const n1y = u0z * v1x - u0x * v1z + (u1z * v0x - u1x * v0z);
      const n1z = u0x * v1y - u0y * v1x + (u1x * v0y - u1y * v0x);
      const n2x = u1y * v1z - u1z * v1y, n2y = u1z * v1x - u1x * v1z, n2z = u1x * v1y - u1y * v1x;
      const f1x = -qax, f1y = -qay, f1z = -qaz;
      const c1 = n0x * f1x + n0y * f1y + n0z * f1z + (n1x * f0x + n1y * f0y + n1z * f0z);
      const c2 = n1x * f1x + n1y * f1y + n1z * f1z + (n2x * f0x + n2y * f0y + n2z * f0z);
      const c3 = n2x * f1x + n2y * f1y + n2z * f1z;
      const dMax = maximoCubico(c0, c1, c2, c3, 0, 1);
      if (dMax >= 0) frente = true; // de frente em algum peso
      else {
        const nn1 = Math.hypot(n1x, n1y, n1z), nn2 = Math.hypot(n2x, n2y, n2z), nf1 = Math.hypot(f1x, f1y, f1z);
        if (dMax < -m * (nn0 + nn1 + nn2) * (nf0 + nf1)) frente = false; // costas além da margem em todo w
        else {
          // caso limítrofe: cotas mais justas em SUBDIV subintervalos [lo, hi] com centro wm, meia-largura h:
          // |n(w)| ≤ |n(wm)| + |n′(wm)|·h + |n2|·h² e |f(w)| ≤ |f(wm)| + |f1|·h (expansão exata em torno de wm)
          frente = false;
          const h = 0.5 / SUBDIV;
          for (let s = 0; s < SUBDIV && !frente; s++) {
            const lo = s / SUBDIV, wm = lo + h;
            const nmx = n0x + wm * (n1x + wm * n2x), nmy = n0y + wm * (n1y + wm * n2y), nmz = n0z + wm * (n1z + wm * n2z);
            const dnx = n1x + 2 * wm * n2x, dny = n1y + 2 * wm * n2y, dnz = n1z + 2 * wm * n2z;
            const Ns = Math.hypot(nmx, nmy, nmz) + Math.hypot(dnx, dny, dnz) * h + nn2 * h * h;
            const Fs = Math.hypot(f0x + wm * f1x, f0y + wm * f1y, f0z + wm * f1z) + nf1 * h;
            frente = maximoCubico(c0, c1, c2, c3, lo, lo + 2 * h) >= -m * Ns * Fs;
          }
        }
      }
    }
    if (frente) {
      saida[k++] = indices[t]!;
      saida[k++] = indices[t + 1]!;
      saida[k++] = indices[t + 2]!;
    }
  }
  return k;
}

/** Máximo exato de c0 + c1·w + c2·w² + c3·w³ em w ∈ [lo, hi] (extremos e pontos críticos internos). */
export function maximoCubico(c0: number, c1: number, c2: number, c3: number, lo: number, hi: number): number {
  let max = Math.max(c0 + lo * (c1 + lo * (c2 + lo * c3)), c0 + hi * (c1 + hi * (c2 + hi * c3)));
  // d′(w) = A·w² + B·w + C
  const A = 3 * c3, B = 2 * c2, C = c1;
  let r1 = Number.NaN, r2 = Number.NaN;
  if (A === 0) {
    if (B !== 0) r1 = -C / B;
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      // fórmula estável (evita cancelamento); q = 0 só com raiz dupla em w = 0
      const q = -0.5 * (B + (B >= 0 ? 1 : -1) * Math.sqrt(disc));
      r1 = q / A;
      if (q !== 0) r2 = C / q;
    }
  }
  if (r1 > lo && r1 < hi) max = Math.max(max, c0 + r1 * (c1 + r1 * (c2 + r1 * c3)));
  if (r2 > lo && r2 < hi) max = Math.max(max, c0 + r2 * (c1 + r2 * (c2 + r2 * c3)));
  return max;
}

function geometriaCompartilhada(base: THREE.BufferGeometry, indices: readonly number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Índice PRÓPRIO desta cena (cópia do da base) e único durante toda a vida dela: o descarte de
  // costas reescreve este mesmo buffer, e o `dispose()` libera exatamente ele (nunca o da base).
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(base.getIndex()!.array), 1));
  for (const [nome, attr] of Object.entries(base.attributes)) g.setAttribute(nome, attr);
  // só os targets usados por esta cena: menos trabalho por vértice na GPU
  g.morphAttributes = Object.fromEntries(Object.entries(base.morphAttributes).map(([k, lista]) => [k, indices.map((i) => lista[i]!)]));
  g.morphTargetsRelative = base.morphTargetsRelative;
  g.boundingBox = base.boundingBox;
  g.boundingSphere = base.boundingSphere;
  const n = base.getAttribute("position").count;
  g.setAttribute("mascaraEnvelope", new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

/**
 * Geometria das cascas: mesmos atributos, índice restrito aos triângulos da região deformada.
 * O buffer de índice é alocado uma vez (tamanho do índice completo) e reescrito a cada troca de
 * alvo, com `drawRange` no trecho válido: nenhum buffer de índice é trocado (e perdido na GPU).
 */
function geometriaCasca(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry();
  for (const [nome, attr] of Object.entries(g.attributes)) c.setAttribute(nome, attr);
  c.morphAttributes = g.morphAttributes;
  c.morphTargetsRelative = g.morphTargetsRelative;
  c.boundingBox = g.boundingBox;
  c.boundingSphere = g.boundingSphere;
  c.setIndex(new THREE.BufferAttribute(new Uint32Array(g.getIndex()!.count), 1));
  c.setDrawRange(0, 0);
  return c;
}

export interface OpcoesCena {
  /**
   * Acrescenta ao material da pele-foto (já criado, com a razão SH9 e a linha da incerteza) um
   * efeito a mais — a textura projetiva da vista "Foto real" ou a hachura do não observado
   * (`materialFotoReal.ts`). Não troca o material nem mexe no halo: a invariante do envelope fica igual.
   */
  decorarPele?: (m: THREE.MeshBasicMaterial) => void;
}

/**
 * @param malhaBase malha do .glb de morphs (com `morphTargetDictionary` vindo de `mesh.extras.targetNames`)
 * @param envelopeMm ±envelope_rms_mm de config/simulacao.json (obrigatório, > 0)
 */
export function criarCenaSimulada(
  malhaBase: THREE.Mesh,
  envelopeMm: number,
  usarTarget: (nome: string) => boolean = (n) => !/__(dir|esq)$/.test(n),
  opcoes: OpcoesCena = {},
): CenaSimulada {
  if (!Number.isFinite(envelopeMm) || envelopeMm <= 0) throw new EnvelopeAusenteError(`envelope_rms_mm inválido: ${envelopeMm}`);
  const dicBase = malhaBase.morphTargetDictionary;
  const original = malhaBase.geometry as THREE.BufferGeometry;
  if (!dicBase || !original.morphAttributes.position?.length) throw new Error("malha sem morph targets");
  const base = geometriaOtimizada(original);
  const escolhidos = Object.entries(dicBase)
    .filter(([n]) => usarTarget(n))
    .sort((a, b) => a[1] - b[1]);
  if (escolhidos.length === 0) throw new Error("nenhum morph target utilizável");
  const nomes = escolhidos.map(([n]) => n);
  const dic: Record<string, number> = Object.fromEntries(nomes.map((n, i) => [n, i]));
  const g = geometriaCompartilhada(base, escolhidos.map(([, i]) => i));
  const morphPos = g.morphAttributes.position!;
  // Pele-foto: a textura do .glb sem luz somada; o "depois" leva só a razão de sombreamento SH9.
  const orig = (Array.isArray(malhaBase.material) ? malhaBase.material[0]! : malhaBase.material) as THREE.MeshStandardMaterial;
  const matPele = criarMaterialPeleFoto(orig.map ?? null, { cor: orig.color?.clone() ?? new THREE.Color(orig.map ? 0xffffff : 0xd9b8a3), vertexColors: !!orig.vertexColors });
  opcoes.decorarPele?.(matPele);
  const uniformsPele = matPele.userData.uniforms as UniformsPeleFoto;
  const pele = new THREE.Mesh(g, matPele);
  const gCasca = geometriaCasca(g);
  const matHalo = criarMaterialHalo(+envelopeMm);
  const uniformsHalo = matHalo.userData.uniforms as UniformsHalo;
  const externa = new THREE.Mesh(gCasca, matHalo);
  externa.renderOrder = 2;
  for (const m of [pele, externa]) {
    m.morphTargetDictionary = dic;
    m.morphTargetInfluences = new Array(morphPos.length).fill(0);
    m.frustumCulled = false;
  }
  pele.name = "pele-simulada";
  externa.name = "envelope-externo";
  const grupo = new THREE.Group();
  grupo.add(pele, externa);

  const mascara = g.getAttribute("mascaraEnvelope") as THREE.BufferAttribute;
  let alvo: string | null = null;
  let peso = 0;

  // ---- descarte antecipado das faces de costas da pele (dependente da vista) ----
  // Um único buffer de índice na pele: `idxPele` guarda o índice completo até haver vista; o
  // descarte grava nele só os triângulos de frente (drawRange = trecho válido) e `atualizarVista(null)`
  // restaura o completo a partir de `indiceCompleto` (cópia só em CPU). Assim `dispose()` libera tudo.
  const idxPele = g.getIndex()!;
  const indiceCompleto = Uint32Array.from(idxPele.array);
  let idxPeleCompleto = true;
  const posicoes = comoFloat32(g.getAttribute("position") as THREE.BufferAttribute);
  const olho = new THREE.Vector3();
  let olhoValido = false;
  let alvoDescarte: number | undefined | null = null; // null = nunca calculado

  function refazerDescarte(indice: number | undefined) {
    if (!olhoValido) return;
    const saida = idxPele.array as Uint32Array;
    const D = indice === undefined ? null : comoFloat32(morphPos[indice] as THREE.BufferAttribute);
    const k = indicesDeFrente(indiceCompleto, posicoes, D, g.morphTargetsRelative, olho, saida);
    idxPele.clearUpdateRanges();
    idxPele.addUpdateRange(0, k);
    idxPele.needsUpdate = true;
    idxPeleCompleto = false;
    g.setDrawRange(0, k);
    alvoDescarte = indice;
  }

  function calcularMascara(indice: number) {
    const d = morphPos![indice]!;
    const arr = mascara.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      const m = Math.hypot(d.getX(i), d.getY(i), d.getZ(i));
      arr[i] = m <= MASCARA_MIN_MM ? 0 : Math.min(1, (m - MASCARA_MIN_MM) / (MASCARA_CHEIA_MM - MASCARA_MIN_MM));
    }
    mascara.needsUpdate = true;
    // cascas só sobre os triângulos com algum vértice deformado (desenho mais barato, mesmo resultado)
    const a = indiceCompleto;
    const idxCasca = gCasca.getIndex()!;
    const tri = idxCasca.array as Uint32Array;
    let k = 0;
    for (let t = 0; t + 2 < a.length; t += 3) {
      if (arr[a[t]!]! > 0 || arr[a[t + 1]!]! > 0 || arr[a[t + 2]!]! > 0) {
        tri[k++] = a[t]!;
        tri[k++] = a[t + 1]!;
        tri[k++] = a[t + 2]!;
      }
    }
    idxCasca.clearUpdateRanges();
    idxCasca.addUpdateRange(0, k);
    idxCasca.needsUpdate = true;
    gCasca.setDrawRange(0, k);
  }

  const cascas = [externa] as const;
  const cena: CenaSimulada = {
    grupo,
    pele,
    cascas,
    envelopeMm,
    nomesTargets: nomes,
    definir(nome, p) {
      const w = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
      const indice = nome === null ? undefined : dic[nome];
      if (nome !== null && indice === undefined) throw new Error(`target inexistente: ${nome}`);
      if (nome !== alvo && indice !== undefined) calcularMascara(indice);
      alvo = nome;
      peso = w;
      for (const m of [pele, externa]) {
        const inf = m.morphTargetInfluences!;
        inf.fill(0);
        if (indice !== undefined) inf[indice] = w;
      }
      const ativo = indice !== undefined && w > 0 ? 1 : 0;
      for (const c of cascas) {
        ((c.material as THREE.Material).userData.uniforms as { uAtivo: { value: number } }).uAtivo.value = ativo;
        c.visible = true; // a casca nunca é escondida; a opacidade segue a máscara × ativo
      }
      uniformsPele.uAtivo.value = ativo;
      if (olhoValido && alvoDescarte !== indice) refazerDescarte(indice);
    },
    atualizarVista(olhoMundo) {
      if (!olhoMundo) {
        olhoValido = false;
        alvoDescarte = null;
        if (!idxPeleCompleto) {
          (idxPele.array as Uint32Array).set(indiceCompleto);
          idxPele.clearUpdateRanges();
          idxPele.needsUpdate = true;
          idxPeleCompleto = true;
        }
        g.setDrawRange(0, Infinity);
        return;
      }
      pele.updateWorldMatrix(true, false);
      // espelhamento inverte o giro das faces: nesse caso (nunca usado aqui) não descarta nada
      if (pele.matrixWorld.determinant() <= 0) return cena.atualizarVista(null);
      const local = pele.worldToLocal(olhoMundo.clone());
      const indice = alvo === null ? undefined : dic[alvo];
      if (olhoValido && local.distanceToSquared(olho) < EPS_OLHO_MM * EPS_OLHO_MM && alvoDescarte === indice) return;
      olho.copy(local);
      olhoValido = true;
      refazerDescarte(indice);
    },
    mostrar(visivel) {
      grupo.visible = visivel;
    },
    definirIluminacao(sh9) {
      if (sh9.length !== 9 || !sh9.every(Number.isFinite)) throw new Error("iluminação SH9 inválida");
      uniformsPele.uSH.value = [...sh9];
    },
    definirMargemCompleta(ligada) {
      uniformsPele.uMargemCompleta.value = ligada ? 1 : 0;
    },
    definirEscalaTracejado(px) {
      const e = Number.isFinite(px) && px > 0 ? px : 1;
      uniformsPele.uEscalaPx.value = e;
      uniformsHalo.uEscalaPx.value = e;
    },
    estado() {
      const simulada = alvo !== null && peso > 0;
      const esperado = simulada ? 1 : 0;
      const envelopeVisivel =
        uniformsPele.uAtivo.value === esperado &&
        cascas.every((c) => c.visible && c.parent === grupo && ((c.material as THREE.Material).userData.uniforms as { uAtivo: { value: number } }).uAtivo.value === esperado);
      return { alvo, peso, envelope_mm: envelopeMm, envelope_visivel: simulada ? envelopeVisivel : false, pele_visivel: pele.visible };
    },
    descartar() {
      // pele e casca têm cada uma um único buffer de índice (nunca trocado): o dispose libera ambos
      g.dispose();
      gCasca.dispose();
      matPele.dispose();
      for (const c of cascas) (c.material as THREE.Material).dispose();
    },
  };
  return cena;
}

/**
 * Invariante verificada a cada quadro pelo viewer: se a pele está simulada (peso > 0), a casca
 * externa e a faixa do envelope estão no grupo, visíveis e ativas. Se não estiverem, a pele é escondida
 * (nunca imagem simulada sem envelope) e o erro é lançado para o chamador exibir.
 */
export function garantirEnvelope(cena: CenaSimulada): void {
  const e = cena.estado();
  if (e.alvo !== null && e.peso > 0 && !e.envelope_visivel) {
    cena.pele.visible = false;
    throw new EnvelopeAusenteError();
  }
}
