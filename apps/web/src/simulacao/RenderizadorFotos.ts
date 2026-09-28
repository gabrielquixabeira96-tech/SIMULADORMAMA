import { nomeTarget, type Imf, type Landmarks, type Plano } from "@simulador/contratos";
import * as THREE from "three";
import { camerasClinicas, quadroClinico, type CameraClinica, type VistaClinica } from "./cameraClinica";
import { criarCenaSimulada, garantirEnvelope, type CenaSimulada } from "./cena";
import { desenharSelo, linhasDoSelo, type ConfigSelo } from "./marcaDagua";
import { criarMaterialHalo, shDaCena, type UniformsHalo } from "./materialFoto";
import type { ConjuntoMorph } from "./VisualizadorSimulacao";

/**
 * Renderizador das "fotos" do modo foto (ADR 0019): three.js puro (sem R3F), UM contexto WebGL
 * fora do DOM para todas as imagens, as mesmas `CenaSimulada` (pele-foto + halo) por (plano, IMF) e
 * a câmera clínica. Cada imagem sai como um <canvas> 2D com o selo gravado nos pixels e fica em
 * cache por (vista, estado, plano, IMF, tamanho, qualidade). O quadro interativo é desenhado em
 * dpr 1, sem MSAA; o "final" (refinamento, fora do caminho de latência) num render target com
 * MSAA 4× e dpr até 2, lido por `readRenderTargetPixels`. `preserveDrawingBuffer: false`; nada
 * aqui baixa, exporta ou envia imagem — as fotos em cache nunca saem do navegador.
 */

export const FUNDO_ESTUDIO = "#3b4450";
/** Limites do cache de imagens (LRU simples): entradas e pixels (~4 bytes cada; 24 Mpx ≈ 96 MB, cabe no iPad). */
const MAX_CACHE = 72;
const MAX_PIXELS_CACHE = 24e6;

export type QualidadeFoto = "interativa" | "final";

export interface PedidoFoto {
  vista: VistaClinica;
  plano: Plano;
  imf: Imf;
  /** null = "antes" (a foto do scan sem simulação) */
  implanteId: string | null;
  /** 1 = "depois"; entre 0 e 1 só em transição (não vai para o cache) */
  peso?: number;
  /** tamanho de referência (px CSS) */
  largura: number;
  altura: number;
  qualidade: QualidadeFoto;
  /** selo compacto (miniaturas) */
  compacto?: boolean;
}

export interface OpcoesRenderizador {
  conjuntos: readonly ConjuntoMorph[];
  envelopeMm: number;
  landmarks: Landmarks | null;
  selo: ConfigSelo;
  /** pixels do dispositivo por px CSS no quadro final (padrão: min(devicePixelRatio, 2)) */
  dprFinal?: number;
}

const chaveConjunto = (p: Plano, i: Imf) => `${p}__${i}`;

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
  movidos: Map<string, THREE.Mesh>;
}

export class RenderizadorFotos {
  readonly renderer: THREE.WebGLRenderer;
  readonly cameras: Record<VistaClinica, CameraClinica>;
  readonly envelopeMm: number;
  readonly iluminacao: Record<string, "glb" | "padrao">;
  selo: ConfigSelo;
  private readonly cena3 = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly cenas = new Map<string, CenaSimulada>();
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private readonly rascunho: HTMLCanvasElement;
  private readonly dprFinal: number;
  private margem = false;
  private rt: THREE.WebGLRenderTarget | null = null;
  private rtMascara: THREE.WebGLRenderTarget | null = null;
  private mascaras = new Map<string, MascaraCena>();
  private perdido = false;
  /** número de renders WebGL feitos (diagnóstico/testes) */
  renders = 0;

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
    this.cena3.background = new THREE.Color(FUNDO_ESTUDIO);
    const caixa = o.conjuntos[0]!.carregada.caixa;
    this.cameras = camerasClinicas(o.landmarks, caixa);
    const q = quadroClinico(o.landmarks, caixa);
    const quadro = q.fonte === "landmarks" ? { x: q.x, y: q.y, z: q.z } : null;
    const anis = this.renderer.capabilities.getMaxAnisotropy();
    this.iluminacao = {};
    for (const c of o.conjuntos) {
      const cena = criarCenaSimulada(c.carregada.malha, o.envelopeMm);
      const il = shDaCena(c.carregada.extras, quadro);
      cena.definirIluminacao(il.sh9);
      this.iluminacao[chaveConjunto(c.plano, c.imf)] = il.fonte;
      const map = (cena.pele.material as THREE.MeshBasicMaterial).map;
      if (map && map.anisotropy !== anis) {
        map.anisotropy = anis;
        map.needsUpdate = true;
      }
      cena.mostrar(false);
      this.cena3.add(cena.grupo);
      this.cenas.set(chaveConjunto(c.plano, c.imf), cena);
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

  /** Todas as cenas (uma por plano × IMF). */
  todasCenas(): CenaSimulada[] {
    return [...this.cenas.values()];
  }

  cena(plano: Plano, imf: Imf): CenaSimulada {
    const c = this.cenas.get(chaveConjunto(plano, imf)) ?? this.cenas.values().next().value;
    if (!c) throw new Error("renderizador sem cenas");
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

  chave(p: PedidoFoto): string {
    const depois = p.implanteId !== null;
    return [p.vista, depois ? p.implanteId : "antes", depois ? `${p.plano}__${p.imf}` : "-", `${p.largura}x${p.altura}`, p.qualidade, p.compacto ? "c" : "n", depois && this.margem ? "m" : "-"].join("|");
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
    this.desenhar({ ...p, qualidade: "interativa" }, peso, this.rascunho);
    return this.rascunho;
  }

  /** Estado da cena usada na última imagem (plano, IMF). */
  estadoCena(plano: Plano, imf: Imf) {
    return this.cena(plano, imf).estado();
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

  private ativar(plano: Plano, imf: Imf): CenaSimulada {
    const ativa = this.cena(plano, imf);
    for (const c of this.cenas.values()) c.mostrar(c === ativa);
    return ativa;
  }

  private desenhar(p: PedidoFoto, peso: number, destino: HTMLCanvasElement): void {
    if (this.perdido) throw new Error("contexto gráfico perdido — recarregue a página");
    const final = p.qualidade === "final";
    const escala = final ? this.dprFinal : 1;
    const w = Math.max(1, Math.round(p.largura * escala));
    const h = Math.max(1, Math.round(p.altura * escala));
    const cena = this.ativar(p.plano, p.imf);
    const alvo = p.implanteId === null ? null : nomeTarget(p.implanteId, p.plano, p.imf, "ambos");
    prepararCenaParaFoto(cena, alvo, peso);
    this.posicionarCamera(p.vista, w, h);
    cena.atualizarVista(this.camera.position);
    cena.definirEscalaTracejado(escala);
    destino.width = w;
    destino.height = h;
    const ctx = destino.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponível");
    const r = this.renderer;
    if (!final) {
      const gl = r.domElement;
      if (gl.width < w || gl.height < h) r.setSize(Math.max(gl.width, w), Math.max(gl.height, h), false);
      r.setRenderTarget(null);
      r.setViewport(0, 0, w, h);
      r.setScissor(0, 0, w, h);
      r.setScissorTest(true);
      r.render(this.cena3, this.camera);
      r.setScissorTest(false);
      this.renders++;
      // cópia imediata (mesma tarefa): o buffer não é preservado depois da composição
      ctx.drawImage(gl, 0, gl.height - h, w, h, 0, 0, w, h);
    } else {
      if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
        this.rt?.dispose();
        this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
      }
      r.setRenderTarget(this.rt);
      r.render(this.cena3, this.camera);
      this.renders++;
      const px = new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(this.rt, 0, 0, w, h, px);
      r.setRenderTarget(null);
      const img = ctx.createImageData(w, h);
      const linha = w * 4;
      for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * linha, (h - y) * linha), y * linha);
      ctx.putImageData(img, 0, 0);
    }
    desenharSelo(ctx, w, h, linhasDoSelo(this.selo, { compacto: p.compacto }));
  }

  /**
   * Máscara da região que a simulação pode alterar numa vista (testes de localidade): pegada, antes
   * e depois, dos triângulos que algum dos alvos move (posição ou normal) e do halo, desenhada com
   * teste de profundidade contra a pele. 1 = região; linhas de cima para baixo, como as imagens.
   */
  mascaraRegiao(vista: VistaClinica, plano: Plano, imf: Imf, implantes: readonly string[], largura: number, altura: number): Uint8Array {
    const cena = this.ativar(plano, imf);
    const w = Math.round(largura), h = Math.round(altura);
    const m = this.materiaisMascara(cena, plano, imf);
    if (!this.rtMascara || this.rtMascara.width !== w || this.rtMascara.height !== h) {
      this.rtMascara?.dispose();
      this.rtMascara = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    }
    const pele = cena.pele;
    const halo = cena.cascas[0];
    const matPele = pele.material, matHalo = halo.material;
    const fundo = this.cena3.background;
    const saida = new Uint8Array(w * h);
    const px = new Uint8Array(w * h * 4);
    const r = this.renderer;
    try {
      this.cena3.background = new THREE.Color(0x000000);
      pele.material = m.preto;
      halo.material = m.halo;
      for (const id of implantes) {
        const alvo = nomeTarget(id, plano, imf, "ambos");
        const movidos = this.trianguloMovidos(cena, m, alvo);
        cena.grupo.add(movidos);
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
        cena.grupo.remove(movidos);
      }
    } finally {
      r.setRenderTarget(null);
      this.cena3.background = fundo;
      pele.material = matPele;
      halo.material = matHalo;
    }
    return saida;
  }

  private materiaisMascara(cena: CenaSimulada, plano: Plano, imf: Imf): MascaraCena {
    const k = chaveConjunto(plano, imf);
    let m = this.mascaras.get(k);
    if (!m) {
      const halo = criarMaterialHalo(cena.envelopeMm, { solido: true });
      m = {
        preto: new THREE.MeshBasicMaterial({ color: 0x000000 }),
        branco: new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
        halo,
        movidos: new Map(),
      };
      this.mascaras.set(k, m);
    }
    return m;
  }

  private trianguloMovidos(cena: CenaSimulada, m: MascaraCena, alvo: string): THREE.Mesh {
    const pronto = m.movidos.get(alvo);
    if (pronto) return pronto;
    const g = cena.pele.geometry as THREE.BufferGeometry;
    const i = cena.pele.morphTargetDictionary![alvo];
    if (i === undefined) throw new Error(`target inexistente: ${alvo}`);
    const dp = g.morphAttributes.position![i]!;
    const dn = g.morphAttributes.normal?.[i];
    const n = dp.count;
    const move = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      if (dp.getX(v) !== 0 || dp.getY(v) !== 0 || dp.getZ(v) !== 0) move[v] = 1;
      else if (dn && (dn.getX(v) !== 0 || dn.getY(v) !== 0 || dn.getZ(v) !== 0)) move[v] = 1;
    }
    // índice completo (o da pele pode estar reduzido pelo descarte de costas)
    cena.atualizarVista(null);
    const idxOrig = Uint32Array.from(g.index!.array);
    const tri: number[] = [];
    for (let t = 0; t + 2 < idxOrig.length; t += 3) {
      const a = idxOrig[t]!, b = idxOrig[t + 1]!, c = idxOrig[t + 2]!;
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
    m.movidos.set(alvo, mesh);
    return mesh;
  }

  descartar(): void {
    for (const c of this.cenas.values()) c.descartar();
    for (const m of this.mascaras.values()) {
      m.preto.dispose();
      m.branco.dispose();
      m.halo.dispose();
      for (const x of m.movidos.values()) x.geometry.dispose();
    }
    this.rt?.dispose();
    this.rtMascara?.dispose();
    this.cache.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
