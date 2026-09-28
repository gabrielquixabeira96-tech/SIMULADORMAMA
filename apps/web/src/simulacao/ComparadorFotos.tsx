"use client";

import { IMFS, PLANOS, type Imf, type Landmarks, type Plano } from "@simulador/contratos";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KE, type PointerEvent as PE } from "react";
import { ROTULOS_VISTAS_CLINICAS, VISTAS_CLINICAS, type VistaClinica } from "./cameraClinica";
import css from "./foto.module.css";
import { linhasDoSelo, type ConfigSelo } from "./marcaDagua";
import { FUNDO_ESTUDIO, LARGURA_INTERATIVA_LADO_MAX, RenderizadorFotos, type PedidoFoto, type QualidadeFoto } from "./RenderizadorFotos";
import type { ConjuntoMorph } from "./VisualizadorSimulacao";

/**
 * Comparador do modo foto (ADR 0019): a foto clínica do scan "Antes" e a mesma foto editada por
 * cada implante ("A" e "B"), com o mesmo enquadramento. Troca Antes → A anima o peso 0 → 1 em
 * 700 ms (a foto sendo editada); A ↔ B esvanece em 300 ms; `prefers-reduced-motion` troca direto.
 * Cortina arrastável (teclado, toque, alvo de 44 px), "segurar para ver o antes", lado a lado,
 * tira das 5 vistas e modo apresentação. A incerteza está sempre na imagem (halo + linha + selo);
 * "margem completa" só acrescenta. Nada é baixado, exportado ou compartilhado.
 */

export type EstadoFoto = "antes" | "a" | "b";
export type ModoFoto = "foto" | "cortina" | "lado";

export interface ImplanteFoto {
  id: string;
  rotulo: string;
}

interface Props {
  conjuntos: readonly ConjuntoMorph[];
  /** implante A e, opcionalmente, B */
  implantes: readonly ImplanteFoto[];
  plano: Plano;
  imf: Imf;
  rotuloPlano: string;
  rotuloImf: string;
  envelopeMm: number;
  /** fração do volume para a legenda (±15 %) */
  volumeFator: number;
  landmarks: Landmarks | null;
  selo: ConfigSelo;
  /** ganchos de medição fora do build de teste (página /benchmark) */
  instrumentar?: boolean;
  /** implantes mostrados com peso > 0 no plano/IMF dados (registro em `simulacoes`) */
  onMostradas?: (ids: string[], plano: Plano, imf: Imf) => void;
  /** estado escolhido e modo (para o "previsto" do estado único) */
  onSelecao?: (s: { estado: EstadoFoto; modo: ModoFoto }) => void;
}

const DURACAO_MORPH_MS = 700;
const DURACAO_ESVANECER_MS = 300;
const ESPERA_REFINO_MS = 150;
const MINIATURA = { largura: 320, altura: 240 } as const;
const GANCHOS_TESTE = process.env.NEXT_PUBLIC_GANCHOS_TESTE === "1";
const ROTULO_ESTADO: Record<EstadoFoto, string> = { antes: "Antes", a: "A", b: "B" };
const LETRA: Record<"a" | "b", number> = { a: 0, b: 1 };

const suavizar = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // easeInOutCubic
const virgula = (v: number) => String(v).replace(".", ",");

interface Quadro {
  estado: EstadoFoto;
  modo: ModoFoto;
  vista: VistaClinica;
  esquerda: EstadoFoto;
  segurando: boolean;
  plano: Plano;
  imf: Imf;
  largura: number;
  altura: number;
  larguraLado: number;
  alturaLado: number;
  margem: boolean;
  ids: readonly string[];
  reduzir: boolean;
}

interface Transicao {
  tipo: "morph" | "esvanecer";
  /** esvanecer: cópia da foto que estava na tela (não precisa ser redesenhada) */
  origem?: HTMLCanvasElement;
  de: EstadoFoto;
  para: EstadoFoto;
  inicio: number;
  pesoAtual: number;
  raf: number;
}

export interface GanchoFotos {
  readonly estado: Record<string, unknown>;
  readonly versao: number;
  readonly quadros: number;
  readonly tamanho: { largura: number; altura: number };
  renderizar(vista: VistaClinica, estado: EstadoFoto, opts?: { qualidade?: QualidadeFoto; peso?: number }): Promise<{ largura: number; altura: number; sha256: string }>;
  imagem(vista: VistaClinica, estado: EstadoFoto, opts?: { qualidade?: QualidadeFoto; peso?: number }): { largura: number; altura: number; dados: Uint8ClampedArray };
  mascaraRegiao(vista: VistaClinica, qualidade?: QualidadeFoto): Uint8Array;
  definirPeso(p: number): Record<string, unknown>;
  removerHalo(): void;
  restaurarHalo(): void;
  limparCache(opts?: { manterAntes?: boolean }): void;
  definirRefino(ligado: boolean): void;
  ocupado(): boolean;
  contexto(): WebGLContextAttributes | null;
  tempos(): Record<string, number> | null;
}

function ganchoSim(instrumentar: boolean): { fotos?: GanchoFotos } | null {
  if ((!GANCHOS_TESTE && !instrumentar) || typeof window === "undefined") return null;
  const w = window as unknown as { __simuladorSim?: { quadros: Record<string, number>; estado: Record<string, unknown>; renderSincrono: Record<string, () => number>; fotos?: GanchoFotos } };
  w.__simuladorSim ??= { quadros: {}, estado: {}, renderSincrono: {} };
  return w.__simuladorSim;
}

/** Copia a imagem pronta para um canvas visível (o tamanho em pixels segue a fonte). */
function pintar(destino: HTMLCanvasElement | null | undefined, fonte: HTMLCanvasElement, alfa = 1): void {
  if (!destino) return;
  if (destino.width !== fonte.width || destino.height !== fonte.height) {
    destino.width = fonte.width;
    destino.height = fonte.height;
  }
  const ctx = destino.getContext("2d");
  if (!ctx) return;
  ctx.globalAlpha = alfa;
  ctx.drawImage(fonte, 0, 0);
  ctx.globalAlpha = 1;
}

function apagar(destino: HTMLCanvasElement | null | undefined): void {
  const ctx = destino?.getContext("2d");
  if (!ctx || !destino) return;
  ctx.fillStyle = FUNDO_ESTUDIO;
  ctx.fillRect(0, 0, destino.width, destino.height);
}

/**
 * Controlador imperativo (fora do ciclo do React): decide transições, pinta os canvases visíveis
 * de forma síncrona (no layout effect: sem esperar o próximo quadro), agenda o refinamento e as
 * miniaturas e expõe os ganchos de teste.
 */
class Controlador {
  r: RenderizadorFotos | null = null;
  q: Quadro | null = null;
  readonly telas: { principal?: HTMLCanvasElement | null; base?: HTMLCanvasElement | null; topo?: HTMLCanvasElement | null; lado: Partial<Record<EstadoFoto, HTMLCanvasElement | null>>; mini: Partial<Record<VistaClinica, HTMLCanvasElement | null>> } = {
    lado: {},
    mini: {},
  };
  transicao: Transicao | null = null;
  versao = 0;
  geracao = 0;
  refino = true;
  erro: string | null = null;

  definirRefino(ligado: boolean): void {
    this.refino = ligado;
    if (!ligado) this.cancelarPendentes();
  }
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ultimasMostradas = "";
  private aoErro: (m: string | null) => void = () => undefined;
  private aoMostradas: (ids: string[], plano: Plano, imf: Imf) => void = () => undefined;
  private readonly refsTela = new Map<string, (c: HTMLCanvasElement | null) => void>();

  conectar(aoErro: (m: string | null) => void, aoMostradas: (ids: string[], plano: Plano, imf: Imf) => void): void {
    this.aoErro = aoErro;
    this.aoMostradas = aoMostradas;
  }

  /** Ref (estável) de um canvas visível: "principal", "base", "topo", "lado:<estado>", "mini:<vista>". */
  tela(nome: string): (c: HTMLCanvasElement | null) => void {
    let f = this.refsTela.get(nome);
    if (!f) {
      f = (c) => {
        const [grupo, k] = nome.split(":") as [string, string | undefined];
        if (grupo === "lado") this.telas.lado[k as EstadoFoto] = c;
        else if (grupo === "mini") this.telas.mini[k as VistaClinica] = c;
        else this.telas[grupo as "principal" | "base" | "topo"] = c;
      };
      this.refsTela.set(nome, f);
    }
    return f;
  }

  /** Cria o renderizador (um contexto WebGL) e repinta o último quadro pedido. */
  criar(o: ConstructorParameters<typeof RenderizadorFotos>[0]): void {
    this.descartar();
    try {
      this.r = new RenderizadorFotos(o);
    } catch (e) {
      this.erro = (e as Error).message;
      this.aoErro(this.erro);
      return;
    }
    this.ultimasMostradas = "";
    if (this.q) this.atualizar({ ...this.q }, true);
  }

  definirSelo(selo: ConfigSelo): void {
    if (!this.r || this.r.selo === selo) return;
    this.r.selo = selo;
    this.r.limparCache();
    if (this.q) this.atualizar({ ...this.q }, true);
  }

  /** Cortina: aplica direto no DOM (sem re-render do React); o arraste é só composição 2D. */
  aplicarCortina(p: number, alca: HTMLElement | null): void {
    if (this.telas.topo) this.telas.topo.style.clipPath = `inset(0 0 0 ${p}%)`;
    if (alca) {
      alca.style.left = `${p}%`;
      alca.setAttribute("aria-valuenow", String(Math.round(p)));
    }
  }

  id(e: EstadoFoto, q = this.q): string | null {
    if (e === "antes" || !q) return null;
    return q.ids[LETRA[e]] ?? q.ids[0] ?? null;
  }

  pedido(vista: VistaClinica, e: EstadoFoto, largura: number, altura: number, qualidade: QualidadeFoto = "interativa", compacto = largura < 560, q = this.q!): PedidoFoto {
    const lado = q.modo === "lado" && largura === q.larguraLado;
    return { vista, plano: q.plano, imf: q.imf, implanteId: this.id(e, q), largura, altura, qualidade, compacto, ...(lado ? { larguraInterativaMax: LARGURA_INTERATIVA_LADO_MAX } : {}) };
  }

  /** melhor imagem disponível: a refinada do cache ou a interativa (renderizada agora se faltar) */
  melhor(p: PedidoFoto): HTMLCanvasElement {
    return this.r!.emCache({ ...p, qualidade: "final" }) ?? this.r!.foto({ ...p, qualidade: "interativa" });
  }

  get ocupado(): boolean {
    return this.transicao !== null || this.timers.size > 0;
  }

  private agendar(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  cancelarPendentes(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private cancelarTransicao(): void {
    if (this.transicao) cancelAnimationFrame(this.transicao.raf);
    this.transicao = null;
  }

  /** Estados visíveis com peso > 0 (cada combinação mostrada vira um registro). */
  private mostradas(q: Quadro): string[] {
    const es: EstadoFoto[] = q.modo === "foto" ? [q.estado] : q.modo === "cortina" ? [q.esquerda, q.estado] : ["a", "b"];
    return [...new Set(es.map((e) => this.id(e, q)).filter((x): x is string => !!x))];
  }

  atualizar(q: Quadro, semTransicao = false): void {
    const ant = semTransicao ? null : this.q;
    this.q = q;
    const r = this.r;
    if (!r || (q.modo === "lado" ? q.larguraLado : q.largura) < 8) return;
    r.definirMargemCompleta(q.margem);
    this.geracao++;
    this.cancelarPendentes();
    const mesmaCena = ant && ant.vista === q.vista && ant.plano === q.plano && ant.imf === q.imf && ant.largura === q.largura && ant.margem === q.margem && ant.ids.join() === q.ids.join();
    const trocaEstado = ant && ant.modo === "foto" && q.modo === "foto" && !q.segurando && !ant.segurando && ant.estado !== q.estado;
    const deTransicao = this.transicao?.para;
    this.cancelarTransicao();
    try {
      if (trocaEstado && mesmaCena && !q.reduzir) this.iniciarTransicao(deTransicao ?? ant!.estado, q.estado);
      else this.pintarFinal();
      this.erro = null;
      this.aoErro(null);
    } catch (e) {
      this.falhou(e);
    }
    const ms = this.mostradas(q);
    const k = ms.join("|") + `|${q.plano}|${q.imf}`;
    if (k !== this.ultimasMostradas) {
      this.ultimasMostradas = k;
      if (ms.length) this.aoMostradas(ms, q.plano, q.imf);
    }
    this.agendarMiniaturas();
  }

  falhou(e: unknown): void {
    this.cancelarTransicao();
    for (const c of [this.telas.principal, this.telas.base, this.telas.topo, ...Object.values(this.telas.lado)]) apagar(c);
    this.erro = (e as Error).message || String(e);
    this.aoErro(this.erro);
    this.versao++;
  }

  pintarFinal(): void {
    const q = this.q!;
    if (q.modo === "foto") {
      const e = q.segurando ? "antes" : q.estado;
      pintar(this.telas.principal, this.melhor(this.pedido(q.vista, e, q.largura, q.altura)));
    } else if (q.modo === "cortina") {
      pintar(this.telas.base, this.melhor(this.pedido(q.vista, q.esquerda, q.largura, q.altura)));
      pintar(this.telas.topo, this.melhor(this.pedido(q.vista, q.estado, q.largura, q.altura)));
    } else {
      for (const e of this.estadosLado()) pintar(this.telas.lado[e], this.melhor(this.pedido(q.vista, e, q.larguraLado, q.alturaLado)));
    }
    this.versao++;
    this.agendarRefino();
  }

  estadosLado(q = this.q!): EstadoFoto[] {
    return q.ids.length > 1 ? ["antes", "a", "b"] : ["antes", "a"];
  }

  private iniciarTransicao(de: EstadoFoto, para: EstadoFoto): void {
    const tipo = de !== "antes" && para !== "antes" ? "esvanecer" : "morph";
    const t: Transicao = { tipo, de, para, inicio: performance.now(), pesoAtual: de === "antes" ? 0 : 1, raf: 0 };
    if (tipo === "esvanecer" && this.telas.principal && this.telas.principal.width > 1) {
      const c = document.createElement("canvas");
      c.width = this.telas.principal.width;
      c.height = this.telas.principal.height;
      c.getContext("2d")?.drawImage(this.telas.principal, 0, 0);
      t.origem = c;
    }
    this.transicao = t;
    this.quadroDaTransicao(t, performance.now() + 16); // primeiro quadro já no evento
    const passo = () => {
      if (this.transicao !== t) return;
      try {
        if (this.quadroDaTransicao(t, performance.now())) {
          this.transicao = null;
          this.pintarFinal();
          return;
        }
      } catch (e) {
        return this.falhou(e);
      }
      t.raf = requestAnimationFrame(passo);
    };
    t.raf = requestAnimationFrame(passo);
  }

  /** Pinta um quadro da transição; devolve true quando terminou. */
  private quadroDaTransicao(t: Transicao, agora: number): boolean {
    const q = this.q!;
    const dur = t.tipo === "morph" ? DURACAO_MORPH_MS : DURACAO_ESVANECER_MS;
    const f = Math.min(1, Math.max(0, (agora - t.inicio) / dur));
    if (f >= 1) return true;
    const s = suavizar(f);
    if (t.tipo === "esvanecer") {
      const para = this.melhor(this.pedido(q.vista, t.para, q.largura, q.altura));
      pintar(this.telas.principal, t.origem ?? this.melhor(this.pedido(q.vista, t.de, q.largura, q.altura)));
      // a origem pode ter outra resolução (refinada): o destino segue a da foto nova
      const ctx = this.telas.principal?.getContext("2d");
      if (ctx && this.telas.principal) {
        if (t.origem && (t.origem.width !== para.width || t.origem.height !== para.height)) {
          this.telas.principal.width = para.width;
          this.telas.principal.height = para.height;
          ctx.drawImage(t.origem, 0, 0, para.width, para.height);
        }
        ctx.globalAlpha = s;
        ctx.drawImage(para, 0, 0, this.telas.principal.width, this.telas.principal.height);
        ctx.globalAlpha = 1;
      }
    } else {
      const alvo = t.para === "antes" ? t.de : t.para;
      const peso = t.para === "antes" ? 1 - s : s;
      t.pesoAtual = peso;
      // peso > 0 em todo quadro intermediário: halo, linha e selo presentes (uAtivo = 1)
      pintar(this.telas.principal, this.r!.quadroTransicao(this.pedido(q.vista, alvo, q.largura, q.altura), Math.max(peso, 1e-3)));
    }
    this.versao++;
    return false;
  }

  private agendarRefino(): void {
    if (!this.refino) return;
    const g = this.geracao;
    this.agendar(() => {
      const q = this.q;
      if (!q || g !== this.geracao || this.transicao) return;
      const alvos: Array<[HTMLCanvasElement | null | undefined, PedidoFoto]> =
        q.modo === "foto"
          ? [[this.telas.principal, this.pedido(q.vista, q.segurando ? "antes" : q.estado, q.largura, q.altura, "final")]]
          : q.modo === "cortina"
            ? [
                [this.telas.base, this.pedido(q.vista, q.esquerda, q.largura, q.altura, "final")],
                [this.telas.topo, this.pedido(q.vista, q.estado, q.largura, q.altura, "final")],
              ]
            : this.estadosLado(q).map((e) => [this.telas.lado[e], this.pedido(q.vista, e, q.larguraLado, q.alturaLado, "final")] as [HTMLCanvasElement | null | undefined, PedidoFoto]);
      const um = (i: number) => {
        if (i >= alvos.length || g !== this.geracao) return;
        try {
          const [tela, p] = alvos[i]!;
          pintar(tela, this.r!.foto(p));
        } catch (e) {
          return this.falhou(e);
        }
        this.agendar(() => um(i + 1), 0);
      };
      um(0);
    }, ESPERA_REFINO_MS);
  }

  private agendarMiniaturas(): void {
    const q = this.q!;
    const g = this.geracao;
    const faltam: VistaClinica[] = [];
    for (const v of VISTAS_CLINICAS) {
      const p: PedidoFoto = { ...this.pedido(v, q.estado, MINIATURA.largura, MINIATURA.altura, "interativa", true), papel: "tira" };
      const pronta = this.r!.emCache(p);
      if (pronta) pintar(this.telas.mini[v], pronta);
      else faltam.push(v);
    }
    const uma = (i: number) => {
      if (g !== this.geracao) return;
      if (i >= faltam.length) return this.agendar(() => this.preaquecer(g), 0);
      try {
        pintar(this.telas.mini[faltam[i]!], this.r!.foto({ ...this.pedido(faltam[i]!, q.estado, MINIATURA.largura, MINIATURA.altura, "interativa", true), papel: "tira" }));
      } catch {
        apagar(this.telas.mini[faltam[i]!]);
      }
      this.agendar(() => uma(i + 1), 0);
    };
    this.agendar(() => uma(0), faltam.length ? 30 : 0);
  }

  /**
   * Com o comparador ocioso, adianta (uma por tarefa, cancelável) as fotos "depois" das outras
   * combinações de plano e sulco na vista e no tamanho atuais: a troca seguinte sai do cache, e a
   * cena de cada combinação já fica com o descarte de faces de costas pronto para a vista.
   */
  private preaquecer(g: number): void {
    const q = this.q;
    if (!q || !this.r) return;
    const lado = q.modo === "lado";
    const w = lado ? q.larguraLado : q.largura, h = lado ? q.alturaLado : q.altura;
    const pedidos: PedidoFoto[] = [];
    for (const plano of PLANOS)
      for (const imf of IMFS)
        for (const e of ["a", "b"] as const) {
          if (!this.id(e, q) || (e === "b" && q.ids.length < 2)) continue;
          const p = { ...this.pedido(q.vista, e, w, h), plano, imf };
          if (!this.r.emCache(p)) pedidos.push(p);
        }
    const um = (i: number) => {
      if (i >= pedidos.length || g !== this.geracao || !this.r) return;
      try {
        this.r.foto(pedidos[i]!);
      } catch {
        return; // a foto visível já mostra o erro, se houver
      }
      this.agendar(() => um(i + 1), 0);
    };
    if (pedidos.length) this.agendar(() => um(0), 0);
  }

  descartar(): void {
    this.cancelarPendentes();
    this.cancelarTransicao();
    this.r?.descartar();
    this.r = null;
  }

  /** Remove (ou devolve) o halo de todas as cenas — só para o teste da invariante do envelope. */
  alternarHalo(presente: boolean): void {
    if (!this.r) return;
    for (const c of this.r.todasCenas()) {
      if (presente && c.cascas[0].parent !== c.grupo) c.grupo.add(c.cascas[0]);
      if (!presente) c.grupo.remove(c.cascas[0]);
    }
    this.r.limparCache();
    if (this.q) this.atualizar({ ...this.q }, true);
  }
}

export function ComparadorFotos(props: Props) {
  const { conjuntos, implantes, plano, imf, envelopeMm, landmarks, selo, instrumentar = false, onMostradas, onSelecao } = props;
  const temB = implantes.length > 1;
  const [estadoEscolhido, setEstado] = useState<EstadoFoto>("antes");
  const [modo, setModo] = useState<ModoFoto>("foto");
  const [vista, setVista] = useState<VistaClinica>("frente");
  const [esquerdaEscolhida, setEsquerda] = useState<EstadoFoto>("antes");
  const [cortina, setCortina] = useState(50);
  const [segurando, setSegurando] = useState(false);
  const [apresentando, setApresentando] = useState(false);
  const [margem, setMargem] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tam, setTam] = useState({ largura: 0, altura: 0, larguraLado: 0, alturaLado: 0 });
  const [reduzir, setReduzir] = useState(false);

  // sem B, "B" volta a ser A
  const estado: EstadoFoto = !temB && estadoEscolhido === "b" ? "a" : estadoEscolhido;
  const esquerda: EstadoFoto = !temB && esquerdaEscolhida === "b" ? "antes" : esquerdaEscolhida;
  const raiz = useRef<HTMLDivElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const primeiroLado = useRef<HTMLDivElement>(null);
  const alca = useRef<HTMLDivElement>(null);
  const [ctrl] = useState(() => new Controlador());
  useLayoutEffect(() => {
    ctrl.conectar((m) => setErro((x) => (x === m ? x : m)), (ids, p, i) => onMostradas?.(ids, p, i));
  }, [ctrl, onMostradas]);

  // estado inicial: depois de gerar, anima Antes → A (a foto sendo editada)
  useEffect(() => {
    const t = setTimeout(() => setEstado((e) => (e === "antes" ? "a" : e)), 250);
    return () => clearTimeout(t);
  }, [conjuntos]);

  useEffect(() => {
    onSelecao?.({ estado, modo });
  }, [estado, modo, onSelecao]);


  // movimento reduzido
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const f = () => setReduzir(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  // tamanho dos quadros (px CSS; o renderizador desenha 1:1 e refina em dpr até 2)
  useLayoutEffect(() => {
    const medir = () => {
      const w = Math.round(palco.current?.clientWidth ?? 0);
      const wl = Math.round(primeiroLado.current?.clientWidth ?? 0);
      setTam((t) => {
        const n = { largura: w, altura: Math.round((w * 3) / 4), larguraLado: wl, alturaLado: Math.round((wl * 3) / 4) };
        return t.largura === n.largura && t.larguraLado === n.larguraLado ? t : n;
      });
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (palco.current) ro.observe(palco.current);
    if (primeiroLado.current) ro.observe(primeiroLado.current);
    return () => ro.disconnect();
  }, [modo, apresentando]);

  // um renderizador (um contexto WebGL) por conjunto de morphs; o selo muda sem recriar o contexto
  const seloAtual = useRef(selo);
  useLayoutEffect(() => {
    seloAtual.current = selo;
    ctrl.definirSelo(selo);
  }, [ctrl, selo]);
  useLayoutEffect(() => {
    ctrl.criar({ conjuntos, envelopeMm, landmarks, selo: seloAtual.current });
    return () => ctrl.descartar();
  }, [ctrl, conjuntos, envelopeMm, landmarks]);

  const ids = implantes.map((i) => i.id).join(",");
  // pinta de forma síncrona a cada mudança (dentro do próprio evento)
  useLayoutEffect(() => {
    ctrl.atualizar({
      estado,
      modo,
      vista,
      esquerda,
      segurando,
      plano,
      imf,
      largura: tam.largura,
      altura: tam.altura,
      larguraLado: tam.larguraLado,
      alturaLado: tam.alturaLado,
      margem,
      ids: ids.split(","),
      reduzir,
    });
  }, [ctrl, estado, modo, vista, esquerda, segurando, plano, imf, tam, margem, ids, reduzir]);

  useEffect(() => () => ctrl.cancelarPendentes(), [ctrl]);

  // ganchos de teste / benchmark
  useEffect(() => {
    const g = ganchoSim(instrumentar);
    if (!g) return;
    const imagemDe = (v: VistaClinica, e: EstadoFoto, o: { qualidade?: QualidadeFoto; peso?: number } = {}) => {
      const r = ctrl.r!;
      const q = ctrl.q!;
      const w = q.largura || 640;
      const h = q.altura || 480;
      const p = ctrl.pedido(v, e, w, h, o.qualidade ?? "interativa");
      let c: HTMLCanvasElement;
      if (o.peso !== undefined) {
        const alvo = e === "antes" ? "a" : e;
        c = r.quadroTransicao(ctrl.pedido(v, alvo, w, h, o.qualidade ?? "interativa"), o.peso);
      } else c = r.foto(p, { forcar: true });
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
      return { largura: c.width, altura: c.height, dados: d.data };
    };
    const estadoAtual = () => {
      const r = ctrl.r;
      const q = ctrl.q;
      if (!r || !q) return { pronto: false };
      const t = ctrl.transicao;
      const mostrado = q.segurando ? "antes" : q.estado;
      return {
        pronto: true,
        ...r.estadoDe(q.plano, q.imf, ctrl.id(mostrado, q)),
        estado: q.estado,
        mostrado,
        modo: q.modo,
        vista: q.vista,
        plano: q.plano,
        imf: q.imf,
        peso_mostrado: t ? t.pesoAtual : mostrado === "antes" ? 0 : 1,
        em_transicao: !!t,
        luzes: r.luzes(),
        preserveDrawingBuffer: r.atributosContexto()?.preserveDrawingBuffer ?? null,
        margem_completa: r.margemCompleta,
        iluminacao: r.iluminacao,
        erro: ctrl.erro,
        selo: linhasDoSelo(r.selo),
        renders: r.renders,
      };
    };
    const fotos: GanchoFotos = {
      get estado() {
        return estadoAtual();
      },
      get versao() {
        return ctrl.versao;
      },
      get quadros() {
        return ctrl.versao;
      },
      get tamanho() {
        return { largura: ctrl.q?.largura ?? 0, altura: ctrl.q?.altura ?? 0 };
      },
      async renderizar(v, e, o) {
        const im = imagemDe(v, e, o);
        const h = new Uint8Array(await crypto.subtle.digest("SHA-256", im.dados));
        return { largura: im.largura, altura: im.altura, sha256: [...h].map((b) => b.toString(16).padStart(2, "0")).join("") };
      },
      imagem: imagemDe,
      mascaraRegiao(v, qualidade = "interativa") {
        const q = ctrl.q!;
        const t = ctrl.r!.tamanhoPixels({ largura: q.largura || 640, altura: q.altura || 480, qualidade });
        return ctrl.r!.mascaraRegiao(v, q.plano, q.imf, q.ids, t.largura, t.altura);
      },
      definirPeso(p) {
        const q = ctrl.q!;
        const e = q.estado === "antes" ? "a" : q.estado;
        pintar(ctrl.telas.principal, ctrl.r!.quadroTransicao(ctrl.pedido(q.vista, e, q.largura, q.altura), p));
        return estadoAtual();
      },
      removerHalo() {
        ctrl.alternarHalo(false);
      },
      restaurarHalo() {
        ctrl.alternarHalo(true);
      },
      limparCache(o) {
        ctrl.r?.limparCache(o);
      },
      definirRefino(l) {
        ctrl.definirRefino(l);
      },
      ocupado: () => ctrl.ocupado,
      contexto: () => ctrl.r?.atributosContexto() ?? null,
      tempos: () => ctrl.r?.ultimoTempo ?? null,
    };
    g.fotos = fotos;
    return () => {
      if (g.fotos === fotos) delete g.fotos;
    };
  }, [ctrl, instrumentar]);

  // ---------------------------------------------------------------- apresentação
  const entrarApresentacao = useCallback(() => {
    setApresentando(true);
    const el = raiz.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => undefined);
  }, []);
  const sairApresentacao = useCallback(() => {
    setApresentando(false);
    if (typeof document !== "undefined" && document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!apresentando) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") sairApresentacao();
    };
    const tela = () => {
      if (!document.fullscreenElement) setApresentando(false);
    };
    window.addEventListener("keydown", tecla);
    document.addEventListener("fullscreenchange", tela);
    return () => {
      window.removeEventListener("keydown", tecla);
      document.removeEventListener("fullscreenchange", tela);
    };
  }, [apresentando, sairApresentacao]);

  // ---------------------------------------------------------------- cortina
  const arrastando = useRef(false);
  const posDaCortina = (clientX: number): number => {
    const b = palco.current!.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientX - b.left) / Math.max(1, b.width)) * 100));
  };
  const aplicarCortina = (p: number) => ctrl.aplicarCortina(p, alca.current);
  const aoApertarCortina = (e: PE<HTMLDivElement>) => {
    if (modo !== "cortina") return;
    arrastando.current = true;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ponteiro sintético/inativo: segue sem captura
    }
    aplicarCortina(posDaCortina(e.clientX));
  };
  const aoMoverCortina = (e: PE<HTMLDivElement>) => {
    if (!arrastando.current) return;
    aplicarCortina(posDaCortina(e.clientX));
  };
  const aoSoltarCortina = (e: PE<HTMLDivElement>) => {
    if (!arrastando.current) return;
    arrastando.current = false;
    setCortina(Math.round(posDaCortina(e.clientX) * 10) / 10);
  };
  const tecladoCortina = (e: KE<HTMLDivElement>) => {
    const passos: Record<string, number> = { ArrowLeft: -2, ArrowRight: 2, ArrowDown: -2, ArrowUp: 2, PageDown: -10, PageUp: 10 };
    let p: number | null = null;
    if (e.key in passos) p = cortina + passos[e.key]!;
    else if (e.key === "Home") p = 0;
    else if (e.key === "End") p = 100;
    if (p === null) return;
    e.preventDefault();
    setCortina(Math.min(100, Math.max(0, p)));
  };

  // ---------------------------------------------------------------- segurar para ver o antes
  const segurar = (v: boolean) => () => setSegurando(v);
  const teclaSegurar = (v: boolean) => (e: KE<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) setSegurando(v);
  };

  const rotulo = (e: EstadoFoto) => {
    if (e === "antes") return "Antes (foto do scan)";
    const i = implantes[LETRA[e]] ?? implantes[0];
    return `${ROTULO_ESTADO[e]} · ${i?.rotulo ?? ""} · ${props.rotuloPlano} · ${props.rotuloImf}`;
  };
  const estadosDisponiveis: EstadoFoto[] = temB ? ["antes", "a", "b"] : ["antes", "a"];
  const mostrado = segurando && modo === "foto" ? "antes" : estado;
  const env = virgula(envelopeMm);

  const seletor = (
    <div className={css.segmentado} role="group" aria-label="Estado mostrado">
      {estadosDisponiveis.map((e) => (
        <button key={e} type="button" aria-pressed={estado === e} onClick={() => setEstado(e)} data-testid={`foto-estado-${e}`}>
          {ROTULO_ESTADO[e]}
          {e !== "antes" && <span className={css.estadoRotulo}>{(implantes[LETRA[e]]?.rotulo ?? "").replace(/^(\S+).*?(\d+ mL)$/, "$1 $2")}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={raiz} className={`${css.estudio} ${apresentando ? css.apresentacao : modo === "lado" ? css.ladoCheio : css.lateralizado}`} data-testid="foto-comparador" data-modo={modo} data-apresentando={apresentando ? "1" : "0"}>
      {apresentando && (
        <p className={css.avisoApresentacao} data-testid="foto-aviso-apresentacao">
          Ilustração, não previsão de resultado · faixa de incerteza ±{env} mm
        </p>
      )}
      <div className={css.barra}>
        {seletor}
        {!apresentando && (
          <div className={css.segmentado} role="group" aria-label="Forma de comparar">
            {(
              [
                ["foto", "Uma foto"],
                ["cortina", "Cortina"],
                ["lado", "Lado a lado"],
              ] as const
            ).map(([m, t]) => (
              <button key={m} type="button" aria-pressed={modo === m} onClick={() => setModo(m)} data-testid={`foto-modo-${m}`}>
                {t}
              </button>
            ))}
          </div>
        )}
        <div className={css.acoes}>
          {modo === "foto" && (
            <button
              type="button"
              className={`secundario ${css.segurar}`}
              aria-pressed={segurando}
              onPointerDown={segurar(true)}
              onPointerUp={segurar(false)}
              onPointerCancel={segurar(false)}
              onPointerLeave={segurar(false)}
              onKeyDown={teclaSegurar(true)}
              onKeyUp={teclaSegurar(false)}
              onBlur={segurar(false)}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="foto-segurar-antes"
            >
              Segure para ver o antes
            </button>
          )}
          {apresentando ? (
            <button type="button" className="secundario" onClick={sairApresentacao} data-testid="foto-sair-apresentacao">
              Sair da apresentação
            </button>
          ) : (
            <button type="button" className="secundario" onClick={entrarApresentacao} data-testid="foto-apresentacao">
              Modo apresentação
            </button>
          )}
        </div>
      </div>

      {modo === "cortina" && !apresentando && (
        <div className={css.barra}>
          <span className="nota">À esquerda da cortina:</span>
          <div className={css.segmentado} role="group" aria-label="Estado à esquerda da cortina">
            {estadosDisponiveis.map((e) => (
              <button key={e} type="button" aria-pressed={esquerda === e} onClick={() => setEsquerda(e)} data-testid={`foto-esquerda-${e}`}>
                {ROTULO_ESTADO[e]}
              </button>
            ))}
          </div>
        </div>
      )}

      {modo === "lado" ? (
        <div className={css.ladoALado} style={{ ["--n" as string]: estadosDisponiveis.length }} data-testid="foto-lado-a-lado">
          {estadosDisponiveis.map((e, k) => (
            <div key={e} ref={k === 0 ? primeiroLado : undefined} className={css.lado} data-testid={`foto-lado-${e}`}>
              <canvas ref={ctrl.tela(`lado:${e}`)} aria-label={`Foto: ${rotulo(e)}`} role="img" />
              <span className={css.rotulo}>{rotulo(e)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={palco}
          className={css.palco}
          data-testid="foto-principal"
          data-estado={mostrado}
          onPointerDown={aoApertarCortina}
          onPointerMove={aoMoverCortina}
          onPointerUp={aoSoltarCortina}
          onPointerCancel={aoSoltarCortina}
        >
          {modo === "foto" ? (
            <canvas ref={ctrl.tela("principal")} role="img" aria-label={`Foto: ${rotulo(mostrado)}`} data-testid="foto-canvas" />
          ) : (
            <>
              <canvas ref={ctrl.tela("base")} role="img" aria-label={`Foto à esquerda: ${rotulo(esquerda)}`} />
              <canvas ref={ctrl.tela("topo")} role="img" aria-label={`Foto à direita: ${rotulo(estado)}`} style={{ clipPath: `inset(0 0 0 ${cortina}%)` }} />
              <div
                ref={alca}
                className={css.alca}
                style={{ left: `${cortina}%` }}
                role="slider"
                tabIndex={0}
                aria-label={`Cortina entre ${ROTULO_ESTADO[esquerda]} e ${ROTULO_ESTADO[estado]}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(cortina)}
                aria-valuetext={`${Math.round(cortina)} % de ${ROTULO_ESTADO[esquerda]}`}
                onKeyDown={tecladoCortina}
                data-testid="foto-cortina"
              >
                <span aria-hidden="true">⟷</span>
              </div>
              <span className={css.rotulo}>{ROTULO_ESTADO[esquerda]}</span>
            </>
          )}
          <span className={`${css.rotulo} ${modo === "cortina" ? css.rotuloDireita : ""}`} data-testid="foto-rotulo">
            {modo === "cortina" ? ROTULO_ESTADO[estado] : rotulo(mostrado)}
          </span>
          {erro && (
            <div className={css.erroFoto} role="alert" data-testid="foto-erro">
              Simulação ocultada: {erro}
            </div>
          )}
        </div>
      )}
      {modo === "lado" && erro && (
        <p className="erro" role="alert" data-testid="foto-erro">
          Simulação ocultada: {erro}
        </p>
      )}

      <div className={css.legenda} data-testid="foto-legenda">
        <span>
          <span className={css.amostraHalo} aria-hidden="true" />
          Faixa âmbar no contorno: incerteza ±{env} mm
        </span>
        <span>
          <span className={css.amostraLinha} aria-hidden="true" />
          limite da região simulada
        </span>
        <span>volume ±{Math.round(props.volumeFator * 100)} %</span>
        <strong>Ilustração geométrica, não previsão de resultado</strong>
      </div>

      {!apresentando && (
        <>
          <label className={css.margem}>
            <input type="checkbox" checked={margem} onChange={(e) => setMargem(e.target.checked)} data-testid="foto-margem-completa" /> Mostrar margem completa (pinta toda a região simulada)
          </label>
          <div className={css.tira} role="group" aria-label="Vistas do protocolo fotográfico">
            {VISTAS_CLINICAS.map((v) => (
              <button key={v} type="button" className={css.miniatura} aria-pressed={vista === v} onClick={() => setVista(v)} data-testid={`foto-vista-${v}`}>
                <span className={css.miniaturaImg}>
                  <canvas ref={ctrl.tela(`mini:${v}`)} aria-hidden="true" />
                </span>
                {ROTULOS_VISTAS_CLINICAS[v]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
