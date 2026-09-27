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
  /** Estado para asserções (e2e/unit): envelope presente e visível sempre que peso > 0. */
  estado(): { alvo: string | null; peso: number; envelope_mm: number; envelope_visivel: boolean; pele_visivel: boolean };
  descartar(): void;
}

/** Limiar (mm) a partir do qual o vértice conta como "deformado" para a máscara do envelope. */
const MASCARA_MIN_MM = 1.0;
const MASCARA_CHEIA_MM = 3.0;

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
  const base = malhaBase.geometry as THREE.BufferGeometry;
  if (!dicBase || !base.morphAttributes.position?.length) throw new Error("malha sem morph targets");
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

  function calcularMascara(indice: number) {
    const d = morphPos![indice]!;
    const arr = mascara.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      const m = Math.hypot(d.getX(i), d.getY(i), d.getZ(i));
      arr[i] = m <= MASCARA_MIN_MM ? 0 : Math.min(1, (m - MASCARA_MIN_MM) / (MASCARA_CHEIA_MM - MASCARA_MIN_MM));
    }
    mascara.needsUpdate = true;
    // cascas só sobre os triângulos com algum vértice deformado (desenho mais barato, mesmo resultado)
    const idx = g.getIndex();
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
