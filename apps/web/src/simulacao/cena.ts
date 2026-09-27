import * as THREE from "three";

/**
 * Cena de uma superfície simulada (contratos §10.3; restrição 3 da PROMPT):
 * a pele deformada por morph targets NUNCA existe sem o envelope de incerteza. O único jeito de
 * obter a malha simulada é `criarCenaSimulada`, que devolve a pele JÁ com o envelope ±envelope_rms_mm
 * sobre a região que o implante altera: casca translúcida azul a +envelope ao longo da normal da
 * superfície deformada (limite externo) e faixa laranja pintada na própria pele (a superfície
 * −envelope fica sob a pele; vê-la "através" da pele equivale a essa faixa, a um custo menor).
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
  /** casca externa (+envelope) */
  readonly cascas: readonly [THREE.Mesh];
  readonly envelopeMm: number;
  readonly nomesTargets: readonly string[];
  /** Ativa um target (por nome) com peso ∈ [0, 1]; null = "antes". */
  definir(nomeTarget: string | null, peso: number): void;
  /** Mostra/esconde a cena inteira (pele + envelope juntos: nunca a pele sozinha). */
  mostrar(visivel: boolean): void;
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
 * triângulo só sai do índice se estiver de costas além de ~5,7° em peso 0, 0,5 e 1 do alvo ativo.
 */
const MARGEM_COSTAS = 0.1;
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
 * objeto) em algum peso do alvo: testa peso 0, 0,5 e 1 (posições base + peso·delta) e só descarta
 * se o triângulo estiver de costas nos três, além da margem. Devolve o número de índices copiados.
 * Mantém a ordem e o sentido de giro: os triângulos que ficam são desenhados exatamente como antes.
 */
export function indicesDeFrente(
  indices: ArrayLike<number>,
  pos: Float32Array,
  delta: Float32Array | null,
  deltaRelativo: boolean,
  olho: { x: number; y: number; z: number },
  saida: Uint32Array,
): number {
  const m2 = MARGEM_COSTAS * MARGEM_COSTAS;
  const nPesos = delta ? 3 : 1;
  let k = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = 3 * indices[t]!, b = 3 * indices[t + 1]!, c = 3 * indices[t + 2]!;
    let frente = false;
    for (let j = 0; j < nPesos && !frente; j++) {
      const w = j * 0.5;
      const wb = delta && !deltaRelativo ? 1 - w : 1; // morph absoluto: base·(1−w) + alvo·w
      let ax = pos[a]! * wb, ay = pos[a + 1]! * wb, az = pos[a + 2]! * wb;
      let bx = pos[b]! * wb, by = pos[b + 1]! * wb, bz = pos[b + 2]! * wb;
      let cx = pos[c]! * wb, cy = pos[c + 1]! * wb, cz = pos[c + 2]! * wb;
      if (delta && w > 0) {
        ax += delta[a]! * w; ay += delta[a + 1]! * w; az += delta[a + 2]! * w;
        bx += delta[b]! * w; by += delta[b + 1]! * w; bz += delta[b + 2]! * w;
        cx += delta[c]! * w; cy += delta[c + 1]! * w; cz += delta[c + 2]! * w;
      }
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ex = olho.x - ax, ey = olho.y - ay, ez = olho.z - az;
      const d = nx * ex + ny * ey + nz * ez;
      // de frente, ou de costas por menos que a margem (|cos| ≤ MARGEM_COSTAS); degenerado fica
      frente = d >= 0 || d * d <= m2 * (nx * nx + ny * ny + nz * nz) * (ex * ex + ey * ey + ez * ez);
    }
    if (frente) {
      saida[k++] = indices[t]!;
      saida[k++] = indices[t + 1]!;
      saida[k++] = indices[t + 2]!;
    }
  }
  return k;
}

function geometriaCompartilhada(base: THREE.BufferGeometry, indices: readonly number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(base.getIndex());
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

/** Geometria das cascas: mesmos atributos, índice restrito aos triângulos da região deformada. */
function geometriaCasca(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry();
  for (const [nome, attr] of Object.entries(g.attributes)) c.setAttribute(nome, attr);
  c.morphAttributes = g.morphAttributes;
  c.morphTargetsRelative = g.morphTargetsRelative;
  c.boundingBox = g.boundingBox;
  c.boundingSphere = g.boundingSphere;
  c.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
  return c;
}

function materialCasca(deslocMm: number, cor: string): THREE.MeshBasicMaterial {
  // Sem iluminação (casca é marcação, não pele): mais barato em GPU fraca.
  const m = new THREE.MeshBasicMaterial({
    color: cor,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  m.userData.deslocMm = deslocMm;
  m.userData.uniforms = { uDesloc: { value: deslocMm }, uAtivo: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float mascaraEnvelope;\nvarying float vMascara;\nvarying vec3 vNormalV;\nvarying vec3 vVista;\nuniform float uDesloc;")
      // o shader básico só calcula a normal com envmap/skinning: calcula aqui a normal DEFORMADA
      .replace("#include <begin_vertex>", "#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <begin_vertex>")
      .replace("#include <morphtarget_vertex>", "#include <morphtarget_vertex>\ntransformed += normalize(objectNormal) * uDesloc;\nvMascara = mascaraEnvelope;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvVista = -mvPosition.xyz;\nvNormalV = normalize(normalMatrix * objectNormal);");
    // casca mais visível no contorno (onde o afastamento de +envelope se lê) e tênue de frente,
    // para não esconder a faixa pintada na pele
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vMascara;\nvarying vec3 vNormalV;\nvarying vec3 vVista;\nuniform float uAtivo;")
      .replace(
        "#include <opaque_fragment>",
        "float borda = 1.0 - abs(dot(normalize(vNormalV), normalize(vVista)));\ndiffuseColor.a *= vMascara * uAtivo * (0.2 + 0.8 * borda * borda);\nif (diffuseColor.a < 0.004) discard;\n#include <opaque_fragment>",
      );
  };
  m.customProgramCacheKey = () => "casca-envelope";
  return m;
}

/**
 * @param malhaBase malha do .glb de morphs (com `morphTargetDictionary` vindo de `mesh.extras.targetNames`)
 * @param envelopeMm ±envelope_rms_mm de config/simulacao.json (obrigatório, > 0)
 */
export function criarCenaSimulada(malhaBase: THREE.Mesh, envelopeMm: number, usarTarget: (nome: string) => boolean = (n) => !/__(dir|esq)$/.test(n)): CenaSimulada {
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
  // Pele em Lambert (mesma textura/cor do .glb): sombreamento difuso basta para a ilustração e
  // custa muito menos que PBR em GPUs fracas (e no SwiftShader da CI).
  const orig = (Array.isArray(malhaBase.material) ? malhaBase.material[0]! : malhaBase.material) as THREE.MeshStandardMaterial;
  const matPele = new THREE.MeshLambertMaterial({ map: orig.map ?? null, color: orig.color ?? new THREE.Color(0xd9b8a3), vertexColors: !!orig.vertexColors });
  const uniformsPele = { uAtivo: { value: 0 } };
  matPele.userData.uniforms = uniformsPele;
  matPele.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformsPele);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float mascaraEnvelope;\nvarying float vMascara;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMascara = mascaraEnvelope;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vMascara;\nuniform float uAtivo;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.54, 0.05), 0.55 * vMascara * uAtivo);");
  };
  matPele.customProgramCacheKey = () => "pele-com-faixa-envelope";
  const pele = new THREE.Mesh(g, matPele);
  const gCasca = geometriaCasca(g);
  const externa = new THREE.Mesh(gCasca, materialCasca(+envelopeMm, "#2f81f7"));
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
  const indiceCompleto = g.getIndex()!;
  const posicoes = comoFloat32(g.getAttribute("position") as THREE.BufferAttribute);
  let idxFrente: THREE.BufferAttribute | null = null;
  const olho = new THREE.Vector3();
  let olhoValido = false;
  let alvoDescarte: number | undefined | null = null; // null = nunca calculado

  function refazerDescarte(indice: number | undefined) {
    if (!olhoValido) return;
    const I = indiceCompleto.array;
    idxFrente ??= new THREE.BufferAttribute(new Uint32Array(I.length), 1);
    if (g.getIndex() !== idxFrente) g.setIndex(idxFrente);
    const saida = idxFrente.array as Uint32Array;
    const D = indice === undefined ? null : comoFloat32(morphPos[indice] as THREE.BufferAttribute);
    const k = indicesDeFrente(I, posicoes, D, g.morphTargetsRelative, olho, saida);
    idxFrente.clearUpdateRanges();
    idxFrente.addUpdateRange(0, k);
    idxFrente.needsUpdate = true;
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
    const idx = indiceCompleto;
    const tri: number[] = [];
    if (idx) {
      const a = idx.array;
      for (let t = 0; t < a.length; t += 3) if (arr[a[t]!]! > 0 || arr[a[t + 1]!]! > 0 || arr[a[t + 2]!]! > 0) tri.push(a[t]!, a[t + 1]!, a[t + 2]!);
    } else {
      for (let v = 0; v + 2 < arr.length; v += 3) if (arr[v]! > 0 || arr[v + 1]! > 0 || arr[v + 2]! > 0) tri.push(v, v + 1, v + 2);
    }
    gCasca.setIndex(new THREE.BufferAttribute(Uint32Array.from(tri), 1));
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
        if (g.getIndex() !== indiceCompleto) g.setIndex(indiceCompleto);
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
    estado() {
      const simulada = alvo !== null && peso > 0;
      const esperado = simulada ? 1 : 0;
      const envelopeVisivel =
        uniformsPele.uAtivo.value === esperado &&
        cascas.every((c) => c.visible && c.parent === grupo && ((c.material as THREE.Material).userData.uniforms as { uAtivo: { value: number } }).uAtivo.value === esperado);
      return { alvo, peso, envelope_mm: envelopeMm, envelope_visivel: simulada ? envelopeVisivel : false, pele_visivel: pele.visible };
    },
    descartar() {
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
