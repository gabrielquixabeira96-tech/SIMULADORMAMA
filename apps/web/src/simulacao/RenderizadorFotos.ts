import { nomeTarget, type Imf, type Landmarks, type Plano } from "@simulador/contratos";
import * as THREE from "three";
import { camerasClinicas, quadroClinico, type CameraClinica, type VistaClinica } from "./cameraClinica";
import { criarCenaSimulada, garantirEnvelope, type CenaSimulada } from "./cena";
import { desenharSelo, linhasDoSelo, type ConfigSelo } from "./marcaDagua";
import { criarMaterialHalo, shDaCena, type QuadroEixos, type UniformsHalo } from "./materialFoto";
import type { ConjuntoMorph } from "./VisualizadorSimulacao";

/**
 * Renderizador das "fotos" do modo foto (ADR 0019): three.js puro (sem R3F), UM contexto WebGL
 * fora do DOM para todas as imagens, `CenaSimulada` (pele-foto + halo) e a câmera clínica. Cada
 * imagem sai como um <canvas> 2D com o selo gravado nos pixels e fica em cache por (vista, estado,
 * plano, IMF, tamanho, qualidade). O quadro interativo é desenhado sem MSAA, com no máximo
 * `LARGURA_INTERATIVA_MAX` px de largura, e lido na hora (readPixels: a leitura força o fim do
 * trabalho da GPU); o "final" (refinamento, fora do caminho de latência) num render target com
 * MSAA 4× e dpr até 2. `preserveDrawingBuffer: false`; nada aqui baixa, exporta ou envia imagem —
 * as fotos em cache nunca saem do navegador.
 *
 * Cada (plano, IMF, implante) tem a sua cena, com um único target: o descarte das faces de costas
 * (feito na CPU pela cena, por vista e alvo) fica válido entre as trocas, e a troca de implante,
 * plano ou sulco não refaz o descarte. As miniaturas (5 vistas) usam cenas próprias, para não
 * desfazer o descarte da foto grande.
 */

export const FUNDO_ESTUDIO = "#3b4450";
/** Limites do cache de imagens (LRU simples): entradas e pixels (~4 bytes cada; 24 Mpx ≈ 96 MB, cabe no iPad). */
const MAX_CACHE = 72;
const MAX_PIXELS_CACHE = 24e6;
/** Largura máxima do quadro interativo (px): na GPU fraca o preenchimento cai ~2× numa foto de 960 px CSS. */
export const LARGURA_INTERATIVA_MAX = 480;
/** Anisotropia da textura nas fotos (limitada: o ganho acima de 4× é pequeno e o custo em GPU fraca, não). */
export const ANISOTROPIA_MAX = 4;

export type QualidadeFoto = "interativa" | "final";
/** "foto" = foto grande, cortina e lado a lado (a mesma vista); "tira" = miniaturas das 5 vistas */
export type PapelFoto = "foto" | "tira";

export interface PedidoFoto {
  vista: VistaClinica;
  plano: Plano;
  imf: Imf;
  /** null = "antes" (a foto do scan sem simulação) */
  implanteId: string | null;
  /** tamanho de referência (px CSS) */
  largura: number;
  altura: number;
  qualidade: QualidadeFoto;
  /** selo compacto (miniaturas e fotos estreitas) */
  compacto?: boolean;
  papel?: PapelFoto;
}

export interface OpcoesRenderizador {
  conjuntos: readonly ConjuntoMorph[];
  envelopeMm: number;
  landmarks: Landmarks | null;
  selo: ConfigSelo;
  /** pixels do dispositivo por px CSS no quadro final (padrão: min(devicePixelRatio, 2)) */
  dprFinal?: number;
  /** largura máxima (px) do quadro interativo; acima disso ele é desenhado menor e o refinamento repõe a nitidez */
  larguraInterativaMax?: number;
}

const chaveConjunto = (p: Plano, i: Imf) => `${p}__${i}`;
const ehAmbos = (n: string) => !/__(dir|esq)$/.test(n);

/**
 * Prepara a cena para UMA imagem e confere a invariante do envelope: com peso > 0, sem o halo e a
 * linha no grupo e ativos, lança `EnvelopeAusenteError` e esconde a pele — a foto "depois" não sai.
 */
export function prepararCenaParaFoto(cena: CenaSimulada, alvo: string | null, peso: number): void {
  cena.pele.visible = true;
  cena.definir(alvo, alvo === null ? 0 : peso);
  garantirEnvelope(cena);
}

interface MascaraCena {
  preto: THREE.MeshBasicMaterial;
  branco: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  movidos: THREE.Mesh | null;
}

export class RenderizadorFotos {
  readonly renderer: THREE.WebGLRenderer;
  readonly cameras: Record<VistaClinica, CameraClinica>;
  readonly envelopeMm: number;
  readonly iluminacao: Record<string, "glb" | "padrao"> = {};
  selo: ConfigSelo;
  /** número de renders WebGL feitos (diagnóstico/testes) */
  renders = 0;
  /** tempos (ms) da última imagem: preparo da cena, render + leitura (inclui a GPU), cópia, selo */
  ultimoTempo: Record<string, number> = {};
  private readonly cena3 = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly conjuntos = new Map<string, ConjuntoMorph>();
  private readonly quadro: QuadroEixos | null;
  private readonly anisotropia: number;
  private readonly cenas = new Map<string, CenaSimulada>();
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private readonly rascunho: HTMLCanvasElement;
  private readonly dprFinal: number;
  private readonly larguraInterativaMax: number;
  private readonly alvos = new Map<string, THREE.WebGLRenderTarget>();
  private readonly mascaras = new Map<string, MascaraCena>();
  private readonly mapas = new Map<THREE.Texture, THREE.Texture>();
  private rtMascara: THREE.WebGLRenderTarget | null = null;
  private pixels: Uint8Array | null = null;
  private margem = false;
  private perdido = false;

  constructor(o: OpcoesRenderizador) {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 3;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: false, stencil: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    canvas.addEventListener("webglcontextlost", () => (this.perdido = true));
    this.envelopeMm = o.envelopeMm;
    this.selo = o.selo;
    this.dprFinal = o.dprFinal ?? Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
    this.larguraInterativaMax = o.larguraInterativaMax ?? LARGURA_INTERATIVA_MAX;
    this.cena3.background = new THREE.Color(FUNDO_ESTUDIO);
    const caixa = o.conjuntos[0]!.carregada.caixa;
    this.cameras = camerasClinicas(o.landmarks, caixa);
    const q = quadroClinico(o.landmarks, caixa);
    this.quadro = q.fonte === "landmarks" ? { x: q.x, y: q.y, z: q.z } : null;
    // anisotropia moderada: nítida nas oblíquas e perfis sem o custo do máximo (16×) numa GPU fraca
    this.anisotropia = Math.min(ANISOTROPIA_MAX, this.renderer.capabilities.getMaxAnisotropy());
    for (const c of o.conjuntos) {
      this.conjuntos.set(chaveConjunto(c.plano, c.imf), c);
      this.iluminacao[chaveConjunto(c.plano, c.imf)] = shDaCena(c.carregada.extras, this.quadro).fonte;
    }
    this.rascunho = document.createElement("canvas");
  }

  get contextoPerdido(): boolean {
    return this.perdido;
  }

  /** Atributos do contexto WebGL (os testes conferem preserveDrawingBuffer === false). */
  atributosContexto(): WebGLContextAttributes | null {
    return this.renderer.getContext().getContextAttributes();
  }

  /** Número de luzes na cena (o modo foto não soma luz: tem de ser 0). */
  luzes(): number {
    let n = 0;
    this.cena3.traverse((o) => {
      if ((o as THREE.Light).isLight) n++;
    });
    return n;
  }

  /** Todas as cenas já criadas. */
  todasCenas(): CenaSimulada[] {
    return [...this.cenas.values()];
  }

  /**
   * Cena de (plano, IMF, implante, papel), criada na primeira vez: só o target "ambos" daquele
   * implante (o "antes" usa a malha base do primeiro conjunto, sem target ativo).
   */
  cena(plano: Plano, imf: Imf, implanteId: string | null, papel: PapelFoto = "foto"): CenaSimulada {
    const conj = implanteId === null ? this.conjuntos.values().next().value! : this.conjuntos.get(chaveConjunto(plano, imf));
    if (!conj) throw new Error(`sem morphs para ${plano} / ${imf}`);
    const alvo = implanteId === null ? null : nomeTarget(implanteId, plano, imf, "ambos");
    const k = `${implanteId === null ? "antes" : `${chaveConjunto(plano, imf)}|${implanteId}`}|${papel}`;
    let c = this.cenas.get(k);
    if (!c) {
      const dic = conj.carregada.malha.morphTargetDictionary ?? {};
      const primeiro = Object.keys(dic).filter(ehAmbos).sort((a, b) => dic[a]! - dic[b]!)[0];
      const usar = alvo ?? primeiro;
      if (!usar || !(usar in dic)) throw new Error(`target inexistente: ${alvo}`);
      c = criarCenaSimulada(conj.carregada.malha, this.envelopeMm, (n) => n === usar);
      c.definirIluminacao(shDaCena(conj.carregada.extras, this.quadro).sh9);
      c.definirMargemCompleta(this.margem);
      // cópia da textura (mesma imagem) com anisotropia só neste contexto: o viewer 3D segue com a sua
      const mat = c.pele.material as THREE.MeshBasicMaterial;
      if (mat.map) {
        let copia = this.mapas.get(mat.map);
        if (!copia) {
          copia = mat.map.clone();
          copia.anisotropy = this.anisotropia;
          copia.needsUpdate = true;
          this.mapas.set(mat.map, copia);
        }
        mat.map = copia;
      }
      c.mostrar(false);
      this.cena3.add(c.grupo);
      this.cenas.set(k, c);
    }
    return c;
  }

  /** "Mostrar margem completa": só acrescenta a tinta antiga; invalida as fotos "depois" do cache. */
  definirMargemCompleta(ligada: boolean): void {
    if (ligada === this.margem) return;
    this.margem = ligada;
    for (const c of this.cenas.values()) c.definirMargemCompleta(ligada);
    for (const k of [...this.cache.keys()]) if (!k.includes("|antes|")) this.cache.delete(k);
  }

  get margemCompleta(): boolean {
    return this.margem;
  }

  limparCache(opts: { manterAntes?: boolean } = {}): void {
    if (!opts.manterAntes) return this.cache.clear();
    for (const k of [...this.cache.keys()]) if (!k.includes("|antes|")) this.cache.delete(k);
  }

  /** Hash curto (FNV-1a) das linhas do selo em vigor (cheia e compacta). */
  private hashSelo(): string {
    const t = [...linhasDoSelo(this.selo), ...linhasDoSelo(this.selo, { compacto: true })].join("\n");
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
  }

  chave(p: PedidoFoto): string {
    const depois = p.implanteId !== null;
    // papel (foto/tira) e as linhas do selo entram na chave: selo diferente = imagem diferente
    return [p.vista, depois ? p.implanteId : "antes", depois ? `${p.plano}__${p.imf}` : "-", `${p.largura}x${p.altura}`, p.qualidade, p.compacto ? "c" : "n", depois && this.margem ? "m" : "-", p.papel ?? "foto", this.hashSelo()].join("|");
  }

  /** Foto em cache (ou null). */
  emCache(p: PedidoFoto): HTMLCanvasElement | null {
    return this.cache.get(this.chave(p)) ?? null;
  }

  /**
   * Foto pronta (estado final: antes = peso 0, depois = peso 1), do cache ou renderizada agora.
   * Lança `EnvelopeAusenteError` se a invariante do envelope falhar (nada é mostrado).
   */
  foto(p: PedidoFoto, opts: { forcar?: boolean } = {}): HTMLCanvasElement {
    const k = this.chave(p);
    const pronta = opts.forcar ? undefined : this.cache.get(k);
    if (pronta) {
      this.cache.delete(k);
      this.cache.set(k, pronta);
      return pronta;
    }
    const c = document.createElement("canvas");
    this.desenhar(p, p.implanteId === null ? 0 : 1, c);
    this.cache.delete(k);
    this.cache.set(k, c);
    this.aparar(k);
    return c;
  }

  /** Tira as entradas mais antigas até caber nos limites (nunca a recém-criada). */
  private aparar(manter: string): void {
    let pixels = 0;
    for (const c of this.cache.values()) pixels += c.width * c.height;
    for (const [k, c] of this.cache) {
      if (this.cache.size <= MAX_CACHE && pixels <= MAX_PIXELS_CACHE) break;
      if (k === manter) continue;
      this.cache.delete(k);
      pixels -= c.width * c.height;
    }
  }

  /** Quadro intermediário de transição (peso entre 0 e 1), fora do cache; reusa um canvas de rascunho. */
  quadroTransicao(p: PedidoFoto, peso: number): HTMLCanvasElement {
    this.desenhar(p, peso, this.rascunho);
    return this.rascunho;
  }

  /** Estado da cena de uma combinação (a que aparece na tela), como ficou no último desenho dela. */
  estadoDe(plano: Plano, imf: Imf, implanteId: string | null) {
    return this.cena(plano, imf, implanteId).estado();
  }

  /** Tamanho em pixels de uma foto: quadro final em dpr ≤ 2; interativo limitado a `larguraInterativaMax`. */
  tamanhoPixels(p: Pick<PedidoFoto, "largura" | "altura" | "qualidade">): { largura: number; altura: number; escala: number } {
    const escala = p.qualidade === "final" ? this.dprFinal : Math.min(1, this.larguraInterativaMax / Math.max(1, p.largura));
    return { largura: Math.max(1, Math.round(p.largura * escala)), altura: Math.max(1, Math.round(p.altura * escala)), escala };
  }

  private posicionarCamera(vista: VistaClinica, largura: number, altura: number): void {
    const c = this.cameras[vista];
    const cam = this.camera;
    cam.fov = c.fov;
    cam.aspect = largura / altura;
    cam.near = c.near;
    cam.far = c.far;
    cam.position.set(...c.posicao);
    cam.up.set(...c.up);
    cam.lookAt(...c.alvo);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  private ativar(cena: CenaSimulada): void {
    for (const c of this.cenas.values()) c.mostrar(c === cena);
  }

  private alvoFinal(w: number, h: number): THREE.WebGLRenderTarget {
    const k = `${w}x${h}`;
    let rt = this.alvos.get(k);
    if (!rt) {
      if (this.alvos.size >= 4) {
        for (const x of this.alvos.values()) x.dispose();
        this.alvos.clear();
      }
      rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
      this.alvos.set(k, rt);
    }
    return rt;
  }

  private desenhar(p: PedidoFoto, peso: number, destino: HTMLCanvasElement): void {
    if (this.perdido) throw new Error("contexto gráfico perdido — recarregue a página");
    const final = p.qualidade === "final";
    const { largura: w, altura: h, escala } = this.tamanhoPixels(p);
    const t0 = performance.now();
    const cena = this.cena(p.plano, p.imf, p.implanteId, p.papel ?? "foto");
    const alvo = p.implanteId === null ? null : nomeTarget(p.implanteId, p.plano, p.imf, "ambos");
    this.ativar(cena);
    prepararCenaParaFoto(cena, alvo, peso);
    this.posicionarCamera(p.vista, w, h);
    cena.atualizarVista(this.camera.position);
    cena.definirEscalaTracejado(escala);
    destino.width = w;
    destino.height = h;
    const ctx = destino.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponível");
    const r = this.renderer;
    const n = w * h * 4;
    if (!this.pixels || this.pixels.length !== n) this.pixels = new Uint8Array(n);
    const px = this.pixels;
    const t1 = performance.now();
    if (!final) {
      // framebuffer padrão (RGBA8, sRGB codificado no shader), só a região w × h; leitura na mesma tarefa
      const gl = r.domElement;
      if (gl.width < w || gl.height < h) r.setSize(Math.max(gl.width, w), Math.max(gl.height, h), false);
      r.setRenderTarget(null);
      r.setViewport(0, 0, w, h);
      r.setScissor(0, 0, w, h);
      r.setScissorTest(true);
      r.render(this.cena3, this.camera);
      r.setScissorTest(false);
      const c = r.getContext();
      c.readPixels(0, 0, w, h, c.RGBA, c.UNSIGNED_BYTE, px);
    } else {
      const rt = this.alvoFinal(w, h);
      r.setRenderTarget(rt);
      r.render(this.cena3, this.camera);
      r.readRenderTargetPixels(rt, 0, 0, w, h, px);
      r.setRenderTarget(null);
    }
    this.renders++;
    const t2 = performance.now();
    const img = ctx.createImageData(w, h);
    const linha = w * 4;
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * linha, (h - y) * linha), y * linha);
    ctx.putImageData(img, 0, 0);
    const t3 = performance.now();
    desenharSelo(ctx, w, h, linhasDoSelo(this.selo, { compacto: p.compacto }), escala, linhasDoSelo(this.selo, { compacto: true }));
    this.ultimoTempo = { preparo: t1 - t0, gpu: t2 - t1, copia: t3 - t2, selo: performance.now() - t3, largura: w, altura: h };
  }

  /**
   * Máscara da região que a simulação pode alterar numa vista (testes de localidade): pegada, antes
   * e depois, dos triângulos que algum dos alvos move (posição ou normal) e do halo, desenhada com
   * teste de profundidade contra a pele. `largura` × `altura` em pixels. 1 = região; linhas de cima
   * para baixo, como as imagens.
   */
  mascaraRegiao(vista: VistaClinica, plano: Plano, imf: Imf, implantes: readonly string[], largura: number, altura: number): Uint8Array {
    const w = Math.round(largura), h = Math.round(altura);
    if (!this.rtMascara || this.rtMascara.width !== w || this.rtMascara.height !== h) {
      this.rtMascara?.dispose();
      this.rtMascara = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    }
    const saida = new Uint8Array(w * h);
    const px = new Uint8Array(w * h * 4);
    const r = this.renderer;
    const fundo = this.cena3.background;
    this.cena3.background = new THREE.Color(0x000000);
    try {
      for (const id of implantes) {
        const cena = this.cena(plano, imf, id);
        const alvo = nomeTarget(id, plano, imf, "ambos");
        const m = this.materiaisMascara(cena, `${chaveConjunto(plano, imf)}|${id}`);
        const pele = cena.pele;
        const halo = cena.cascas[0];
        const matPele = pele.material, matHalo = halo.material;
        this.ativar(cena);
        const movidos = this.triangulosMovidos(cena, m, alvo);
        cena.grupo.add(movidos);
        pele.material = m.preto;
        halo.material = m.halo;
        try {
          for (const peso of [0, 1]) {
            cena.definir(alvo, peso);
            (m.halo.userData.uniforms as UniformsHalo).uAtivo.value = peso > 0 ? 1 : 0;
            movidos.morphTargetInfluences = pele.morphTargetInfluences!.slice();
            this.posicionarCamera(vista, w, h);
            cena.atualizarVista(this.camera.position);
            r.setRenderTarget(this.rtMascara);
            r.render(this.cena3, this.camera);
            r.readRenderTargetPixels(this.rtMascara, 0, 0, w, h, px);
            for (let y = 0; y < h; y++) {
              const lin = (h - 1 - y) * w;
              for (let x = 0; x < w; x++) if (px[(lin + x) * 4]! > 127) saida[y * w + x] = 1;
            }
          }
        } finally {
          cena.grupo.remove(movidos);
          pele.material = matPele;
          halo.material = matHalo;
        }
      }
    } finally {
      r.setRenderTarget(null);
      this.cena3.background = fundo;
    }
    return saida;
  }

  private materiaisMascara(cena: CenaSimulada, k: string): MascaraCena {
    let m = this.mascaras.get(k);
    if (!m) {
      m = {
        preto: new THREE.MeshBasicMaterial({ color: 0x000000 }),
        branco: new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
        halo: criarMaterialHalo(cena.envelopeMm, { solido: true }),
        movidos: null,
      };
      this.mascaras.set(k, m);
    }
    return m;
  }

  private triangulosMovidos(cena: CenaSimulada, m: MascaraCena, alvo: string): THREE.Mesh {
    if (m.movidos) return m.movidos;
    const g = cena.pele.geometry as THREE.BufferGeometry;
    const i = cena.pele.morphTargetDictionary![alvo];
    if (i === undefined) throw new Error(`target inexistente: ${alvo}`);
    const dp = g.morphAttributes.position![i]!;
    const dn = g.morphAttributes.normal?.[i];
    const move = new Uint8Array(dp.count);
    for (let v = 0; v < dp.count; v++) {
      if (dp.getX(v) !== 0 || dp.getY(v) !== 0 || dp.getZ(v) !== 0) move[v] = 1;
      else if (dn && (dn.getX(v) !== 0 || dn.getY(v) !== 0 || dn.getZ(v) !== 0)) move[v] = 1;
    }
    // índice completo (o da pele pode estar reduzido pelo descarte de costas)
    cena.atualizarVista(null);
    const idx = Uint32Array.from(g.index!.array);
    const tri: number[] = [];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      if (move[a] || move[b] || move[c]) tri.push(a, b, c);
    }
    const geo = new THREE.BufferGeometry();
    for (const [nome, attr] of Object.entries(g.attributes)) geo.setAttribute(nome, attr);
    geo.morphAttributes = g.morphAttributes;
    geo.morphTargetsRelative = g.morphTargetsRelative;
    geo.setIndex(tri);
    const mesh = new THREE.Mesh(geo, m.branco);
    mesh.morphTargetDictionary = cena.pele.morphTargetDictionary;
    mesh.morphTargetInfluences = cena.pele.morphTargetInfluences!.slice();
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    m.movidos = mesh;
    return mesh;
  }

  descartar(): void {
    for (const c of this.cenas.values()) c.descartar();
    for (const m of this.mascaras.values()) {
      m.preto.dispose();
      m.branco.dispose();
      m.halo.dispose();
      m.movidos?.geometry.dispose();
    }
    for (const x of this.alvos.values()) x.dispose();
    this.alvos.clear();
    for (const t of this.mapas.values()) t.dispose();
    this.mapas.clear();
    this.rtMascara?.dispose();
    this.cache.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
