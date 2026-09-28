import { nomeTarget, type Imf, type Landmarks, type Plano, type VistaFoto } from "@simulador/contratos";
import * as THREE from "three";
import { camerasClinicas, quadroClinico, type CameraClinica, type VistaClinica } from "./cameraClinica";
import { CameraDaFoto, centroDaCamera, encaixeDaFoto, matrizTexturaFoto, planosParaEsfera, type ParametrosCameraFoto, type PerturbacaoPx } from "./cameraDaFoto";
import { criarCenaSimulada, garantirEnvelope, type CenaSimulada } from "./cena";
import { desenharSelo, linhasDoSelo, textoMarcaDiagonal, type ConfigSelo } from "./marcaDagua";
import { criarMaterialHalo, shDaCena, type QuadroEixos, type UniformsHalo } from "./materialFoto";
import { aplicarFotoReal, aplicarHachuraNaoObservado, type UniformsFotoReal } from "./materialFotoReal";
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
 *
 * Vista "Foto real" (plano "foto → 3D", P3-lite; malha reconstruída de fotos): `foto:<vista>`, da
 * câmera da própria foto (K, R, t do C1). O "antes" é a foto (sem WebGL: os pixels dela, copiados);
 * o "depois" é a malha com a textura projetiva da foto, desenhada num alvo com alfa (a pele só
 * pinta onde a simulação a move; o halo por cima) e composta sobre a foto: onde o alfa é 0, o
 * pixel da foto fica intacto. Nas vistas clínicas de uma malha reconstruída, a hachura marca o que
 * nenhuma foto viu (`observado.png`, C3).
 */

export const FUNDO_ESTUDIO = "#3b4450";
/** Limites do cache de imagens (LRU simples): entradas e pixels (~4 bytes cada; 24 Mpx ≈ 96 MB, cabe no iPad). */
const MAX_CACHE = 72;
const MAX_PIXELS_CACHE = 24e6;
/** Largura máxima do quadro interativo (px): na GPU fraca o preenchimento cai ~2× numa foto de 960 px CSS. */
export const LARGURA_INTERATIVA_MAX = 480;
/**
 * Largura máxima do quadro interativo de CADA foto do lado a lado (px). Com as 3 fotos na largura
 * toda (~370–410 px cada), 480 px não reduziria nada e 2 fotos novas custariam ~2,3× o quadro de
 * antes (~270 px); 240 px mantém o custo da troca, e o quadro final (150 ms depois) sai na
 * resolução cheia.
 */
export const LARGURA_INTERATIVA_LADO_MAX = 240;
/** Anisotropia da textura nas fotos (limitada: o ganho acima de 4× é pequeno e o custo em GPU fraca, não). */
export const ANISOTROPIA_MAX = 4;

export type QualidadeFoto = "interativa" | "final";
/** "foto" = foto grande, cortina e lado a lado (a mesma vista); "tira" = miniaturas das 5 vistas */
export type PapelFoto = "foto" | "tira";

/** Vista da foto real de uma malha reconstruída: `foto:<vista da foto>` (C1). */
export type VistaFotoReal = `foto:${VistaFoto}`;
/** Vista de uma imagem do modo foto: uma das 5 clínicas ou a de uma foto real. */
export type VistaRender = VistaClinica | VistaFotoReal;
export const ehVistaFotoReal = (v: string): v is VistaFotoReal => v.startsWith("foto:");
export const vistaDaFotoReal = (v: VistaFotoReal): VistaFoto => v.slice(5) as VistaFoto;

/** Imagem decodificada da foto (ImageBitmap no navegador; canvas/imagem nos testes). */
export type ImagemFoto = ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas;

export interface FotoRealEntrada {
  vista: VistaFoto;
  camera: ParametrosCameraFoto;
  imagem: ImagemFoto;
}

/** Fotos reais da reconstrução (a câmera de cada uma) e o `observado.png` (C3), se houver. */
export interface OpcoesFotoRealRender {
  fotos: readonly FotoRealEntrada[];
  observado?: ImagemFoto | null;
}

interface FotoRealPronta {
  entrada: FotoRealEntrada;
  textura: THREE.Texture;
  camera: CameraDaFoto;
}

export interface PedidoFoto {
  vista: VistaRender;
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
  /** limite próprio do quadro interativo (lado a lado); ausente = `larguraInterativaMax` do renderizador */
  larguraInterativaMax?: number;
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
  /** malha reconstruída de fotos: as fotos (vista "Foto real") e o observado (hachura) */
  fotoReal?: OpcoesFotoRealRender | null;
}

/** sRGB (0–255) → linear (0–1). */
const LINEAR_DE_SRGB = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const srgbDeLinear = (l: number): number => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

/**
 * Compõe o desenho da malha sobre a foto, no lugar. `malha`: alvo sRGB com alfa (a GPU mistura em
 * linear com a cor PRÉ-multiplicada pelo alfa; linhas de baixo para cima); `foto`: RGBA de cima
 * para baixo. Pixel com alfa 0 não é tocado: a foto fica idêntica, byte a byte; alfa 255 = o pixel
 * da malha. Devolve o número de pixels alterados.
 */
export function comporSobreFoto(foto: Uint8ClampedArray, malha: Uint8Array, largura: number, altura: number): number {
  let n = 0;
  for (let y = 0; y < altura; y++) {
    const lin = (altura - 1 - y) * largura * 4;
    const dst = y * largura * 4;
    for (let x = 0; x < largura; x++) {
      const i = lin + x * 4;
      const a = malha[i + 3]!;
      if (a === 0) continue;
      const o = dst + x * 4;
      n++;
      if (a === 255) {
        foto[o] = malha[i]!;
        foto[o + 1] = malha[i + 1]!;
        foto[o + 2] = malha[i + 2]!;
        continue;
      }
      const k = 1 - a / 255;
      for (let c = 0; c < 3; c++) foto[o + c] = srgbDeLinear(LINEAR_DE_SRGB[malha[i + c]!]! + LINEAR_DE_SRGB[foto[o + c]!]! * k);
    }
  }
  return n;
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
  private readonly fotosReais = new Map<VistaFoto, FotoRealPronta>();
  private readonly observado: THREE.Texture | null = null;
  private readonly basesFoto = new Map<string, ImageData>();
  private readonly alvosReais = new Map<string, THREE.WebGLRenderTarget>();
  private readonly uniformsReais: Array<{ vista: VistaFoto; u: UniformsFotoReal }> = [];
  private perturbacao: PerturbacaoPx | null = null;

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
    if (o.fotoReal) {
      const centro = caixa.getCenter(new THREE.Vector3()).toArray();
      const raio = Math.max(50, caixa.getSize(new THREE.Vector3()).length() / 2);
      for (const f of o.fotoReal.fotos) {
        const textura = new THREE.Texture(f.imagem as TexImageSource);
        textura.flipY = false;
        textura.colorSpace = THREE.SRGBColorSpace;
        textura.anisotropy = this.anisotropia;
        textura.needsUpdate = true;
        const planos = planosParaEsfera(f.camera, centro, raio);
        this.fotosReais.set(f.vista, { entrada: f, textura, camera: new CameraDaFoto(f.camera, f.camera.largura_px, f.camera.altura_px, planos) });
      }
      if (o.fotoReal.observado) {
        const t = new THREE.Texture(o.fotoReal.observado as TexImageSource);
        t.flipY = false; // mesma convenção do atlas do .glb (GLTFLoader)
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        this.observado = t;
      }
    }
  }

  /** Vistas "Foto real" disponíveis (uma por foto da reconstrução). */
  vistasFotoReal(): VistaFotoReal[] {
    return [...this.fotosReais.keys()].map((v) => `foto:${v}` as VistaFotoReal);
  }

  /** Tamanho (px) da foto de uma vista real. */
  tamanhoFotoReal(v: VistaFoto): { largura: number; altura: number } | null {
    const f = this.fotosReais.get(v);
    return f ? { largura: f.entrada.camera.largura_px, altura: f.entrada.camera.altura_px } : null;
  }

  /**
   * Erro de registro simulado (px da foto) na câmera de TODAS as fotos reais — câmera de desenho e
   * textura projetiva juntas, como um K, R, t estimado errado. Só para os testes de localidade.
   */
  definirPerturbacao(p: PerturbacaoPx | null): void {
    this.perturbacao = p && (p.dx !== 0 || p.dy !== 0) ? { ...p } : null;
    for (const { vista, u } of this.uniformsReais) u.uMatrizFoto.value = matrizTexturaFoto(this.fotoReal(vista).entrada.camera, this.perturbacao);
  }

  get perturbacaoAtual(): PerturbacaoPx | null {
    return this.perturbacao;
  }

  private fotoReal(v: VistaFoto): FotoRealPronta {
    const f = this.fotosReais.get(v);
    if (!f) throw new Error(`sem foto real da vista ${v}`);
    return f;
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
  cena(plano: Plano, imf: Imf, implanteId: string | null, papel: PapelFoto | `real:${VistaFoto}` = "foto"): CenaSimulada {
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
      const real = papel.startsWith("real:") ? this.fotoReal(papel.slice(5) as VistaFoto) : null;
      const obs = this.observado;
      const decorarPele = real
        ? (m: THREE.MeshBasicMaterial) => {
            const cam = real.entrada.camera;
            const u = aplicarFotoReal(m, { foto: real.textura, matriz: matrizTexturaFoto(cam, this.perturbacao), centro: new THREE.Vector3(...centroDaCamera(cam)) });
            this.uniformsReais.push({ vista: real.entrada.vista, u });
          }
        : obs
          ? (m: THREE.MeshBasicMaterial) => void aplicarHachuraNaoObservado(m, obs)
          : undefined;
      c = criarCenaSimulada(conj.carregada.malha, this.envelopeMm, (n) => n === usar, { decorarPele });
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
    // a perturbação (testes) muda o "depois" da foto real
    const pert = depois && ehVistaFotoReal(p.vista) && this.perturbacao ? `p${this.perturbacao.dx},${this.perturbacao.dy}` : "-";
    // papel (foto/tira) e as linhas do selo entram na chave: selo diferente = imagem diferente
    return [p.vista, depois ? p.implanteId : "antes", depois ? `${p.plano}__${p.imf}` : "-", `${p.largura}x${p.altura}`, p.qualidade, p.compacto ? "c" : "n", depois && this.margem ? "m" : "-", p.papel ?? "foto", p.larguraInterativaMax ?? "-", pert, this.hashSelo()].join("|");
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

  /**
   * Estado da cena de uma combinação (a que aparece na tela), como ficou no último desenho dela. Na
   * vista "Foto real" é a cena da foto (o "antes" dela não usa cena: é a própria foto).
   */
  estadoDe(plano: Plano, imf: Imf, implanteId: string | null, vista?: VistaRender) {
    const real = vista && ehVistaFotoReal(vista) && implanteId !== null;
    return this.cena(plano, imf, implanteId, real ? `real:${vistaDaFotoReal(vista)}` : "foto").estado();
  }

  /** Tamanho em pixels de uma foto: quadro final em dpr ≤ 2; interativo limitado a `larguraInterativaMax`. */
  tamanhoPixels(p: Pick<PedidoFoto, "largura" | "altura" | "qualidade" | "larguraInterativaMax">): { largura: number; altura: number; escala: number } {
    const escala = p.qualidade === "final" ? this.dprFinal : Math.min(1, (p.larguraInterativaMax ?? this.larguraInterativaMax) / Math.max(1, p.largura));
    return { largura: Math.max(1, Math.round(p.largura * escala)), altura: Math.max(1, Math.round(p.altura * escala)), escala };
  }

  /** Câmera de uma vista para um quadro de largura × altura px: a clínica ou a da foto real. */
  private cameraDa(vista: VistaRender, largura: number, altura: number): THREE.PerspectiveCamera {
    if (ehVistaFotoReal(vista)) {
      const cam = this.fotoReal(vistaDaFotoReal(vista)).camera;
      cam.ajustar(largura, altura, this.perturbacao);
      return cam;
    }
    this.posicionarCamera(vista, largura, altura);
    return this.camera;
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
    if (ehVistaFotoReal(p.vista)) return this.desenharFotoReal(p, p.vista, peso, destino);
    const final = p.qualidade === "final";
    const { largura: w, altura: h, escala } = this.tamanhoPixels(p);
    const t0 = performance.now();
    const cena = this.cena(p.plano, p.imf, p.implanteId, p.papel ?? "foto");
    const alvo = p.implanteId === null ? null : nomeTarget(p.implanteId, p.plano, p.imf, "ambos");
    this.ativar(cena);
    prepararCenaParaFoto(cena, alvo, peso);
    const camera = this.cameraDa(p.vista, w, h);
    cena.atualizarVista(camera.position);
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
      r.render(this.cena3, camera);
      r.setScissorTest(false);
      const c = r.getContext();
      c.readPixels(0, 0, w, h, c.RGBA, c.UNSIGNED_BYTE, px);
    } else {
      const rt = this.alvoFinal(w, h);
      r.setRenderTarget(rt);
      r.render(this.cena3, camera);
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
    desenharSelo(ctx, w, h, linhasDoSelo(this.selo, { compacto: p.compacto }), escala, linhasDoSelo(this.selo, { compacto: true }), textoMarcaDiagonal(this.selo));
    this.ultimoTempo = { preparo: t1 - t0, gpu: t2 - t1, copia: t3 - t2, selo: performance.now() - t3, largura: w, altura: h };
  }

  /**
   * Pixels da foto real encaixada num quadro largura × altura (fundo de estúdio fora dela), SEM
   * selo: é a base do "antes" e do compósito do "depois". Em cache por (vista, tamanho).
   */
  baseFoto(v: VistaFoto, largura: number, altura: number): ImageData {
    const k = `${v}|${largura}x${altura}`;
    const pronta = this.basesFoto.get(k);
    if (pronta) return pronta;
    const f = this.fotoReal(v);
    const e = encaixeDaFoto(f.entrada.camera.largura_px, f.entrada.camera.altura_px, largura, altura);
    const c = document.createElement("canvas");
    c.width = largura;
    c.height = altura;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponível");
    ctx.fillStyle = FUNDO_ESTUDIO;
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(f.entrada.imagem as CanvasImageSource, e.x, e.y, e.largura, e.altura);
    const img = ctx.getImageData(0, 0, largura, altura);
    if (this.basesFoto.size >= 12) this.basesFoto.delete(this.basesFoto.keys().next().value!);
    this.basesFoto.set(k, img);
    return img;
  }

  private alvoReal(w: number, h: number, amostras: number): THREE.WebGLRenderTarget {
    const k = `${w}x${h}x${amostras}`;
    let rt = this.alvosReais.get(k);
    if (!rt) {
      if (this.alvosReais.size >= 4) {
        for (const x of this.alvosReais.values()) x.dispose();
        this.alvosReais.clear();
      }
      rt = new THREE.WebGLRenderTarget(w, h, { samples: amostras, colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
      this.alvosReais.set(k, rt);
    }
    return rt;
  }

  /**
   * "Antes" (peso 0 ou sem implante) = os pixels da foto; "depois" = malha com a textura projetiva
   * da foto e o halo, num alvo com alfa, composta sobre a foto (alfa 0 ⇒ pixel intacto). Selo por cima.
   */
  private desenharFotoReal(p: PedidoFoto, vista: VistaFotoReal, peso: number, destino: HTMLCanvasElement): void {
    const v = vistaDaFotoReal(vista);
    const final = p.qualidade === "final";
    const { largura: w, altura: h, escala } = this.tamanhoPixels(p);
    const t0 = performance.now();
    destino.width = w;
    destino.height = h;
    const ctx = destino.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponível");
    const base = this.baseFoto(v, w, h);
    let t1 = t0, t2 = t0, alterados = 0;
    if (p.implanteId === null || !(peso > 0)) {
      ctx.putImageData(base, 0, 0);
    } else {
      const cena = this.cena(p.plano, p.imf, p.implanteId, `real:${v}`);
      this.ativar(cena);
      prepararCenaParaFoto(cena, nomeTarget(p.implanteId, p.plano, p.imf, "ambos"), peso);
      const camera = this.cameraDa(vista, w, h);
      cena.atualizarVista(camera.position);
      cena.definirEscalaTracejado(escala);
      const n = w * h * 4;
      if (!this.pixels || this.pixels.length !== n) this.pixels = new Uint8Array(n);
      const px = this.pixels;
      const r = this.renderer;
      const rt = this.alvoReal(w, h, final ? 4 : 0);
      const fundo = this.cena3.background;
      const cor = r.getClearColor(new THREE.Color());
      const alfa = r.getClearAlpha();
      t1 = performance.now();
      try {
        // fundo transparente: só a pele que se move e o halo têm alfa > 0
        this.cena3.background = null;
        r.setClearColor(0x000000, 0);
        r.setRenderTarget(rt);
        r.render(this.cena3, camera);
        r.readRenderTargetPixels(rt, 0, 0, w, h, px);
      } finally {
        r.setRenderTarget(null);
        r.setClearColor(cor, alfa);
        this.cena3.background = fundo;
      }
      this.renders++;
      t2 = performance.now();
      const img = new ImageData(new Uint8ClampedArray(base.data), w, h);
      alterados = comporSobreFoto(img.data, px, w, h);
      ctx.putImageData(img, 0, 0);
    }
    const t3 = performance.now();
    desenharSelo(ctx, w, h, linhasDoSelo(this.selo, { compacto: p.compacto }), escala, linhasDoSelo(this.selo, { compacto: true }), textoMarcaDiagonal(this.selo));
    this.ultimoTempo = { preparo: t1 - t0, gpu: t2 - t1, copia: t3 - t2, selo: performance.now() - t3, largura: w, altura: h, alterados };
  }

  /**
   * Máscara da região que a simulação pode alterar numa vista (testes de localidade): pegada, antes
   * e depois, dos triângulos que algum dos alvos move (posição ou normal) e do halo, desenhada com
   * teste de profundidade contra a pele. `largura` × `altura` em pixels. 1 = região; linhas de cima
   * para baixo, como as imagens. Na vista "Foto real" (critério de 0 pixels alterados fora dela) a
   * máscara é desenhada com o mesmo MSAA 4× do quadro final e qualquer cobertura parcial conta:
   * lascas de halo mais finas que 1 px, que só as amostras do MSAA pegam, entram na região.
   */
  mascaraRegiao(vista: VistaRender, plano: Plano, imf: Imf, implantes: readonly string[], largura: number, altura: number): Uint8Array {
    const w = Math.round(largura), h = Math.round(altura);
    const amostras = ehVistaFotoReal(vista) ? 4 : 0;
    const limiar = amostras ? 0 : 127;
    if (!this.rtMascara || this.rtMascara.width !== w || this.rtMascara.height !== h || this.rtMascara.samples !== amostras) {
      this.rtMascara?.dispose();
      this.rtMascara = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, samples: amostras });
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
            const camera = this.cameraDa(vista, w, h);
            cena.atualizarVista(camera.position);
            r.setRenderTarget(this.rtMascara);
            r.render(this.cena3, camera);
            r.readRenderTargetPixels(this.rtMascara, 0, 0, w, h, px);
            for (let y = 0; y < h; y++) {
              const lin = (h - 1 - y) * w;
              for (let x = 0; x < w; x++) if (px[(lin + x) * 4]! > limiar) saida[y * w + x] = 1;
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
    for (const f of this.fotosReais.values()) f.textura.dispose();
    this.fotosReais.clear();
    this.observado?.dispose();
    for (const x of this.alvosReais.values()) x.dispose();
    this.alvosReais.clear();
    this.basesFoto.clear();
    this.rtMascara?.dispose();
    this.cache.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
