"use client";

import { nomeTarget, type Imf, type Landmarks, type Plano } from "@simulador/contratos";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { posicionarCamera } from "@/viewer/camera";
import type { MalhaCarregada } from "@/viewer/carregar";
import type { NomeVista } from "@/viewer/vistas";
import { camerasClinicas, quadroClinico, VISTAS_CLINICAS, type VistaClinica } from "./cameraClinica";
import { criarCenaSimulada, garantirEnvelope, type CenaSimulada } from "./cena";
import { shDaCena } from "./materialFoto";
import { FUNDO_ESTUDIO } from "./RenderizadorFotos";

export interface ConjuntoMorph {
  plano: Plano;
  imf: Imf;
  carregada: MalhaCarregada;
}

export interface PainelVista {
  chave: string;
  rotulo: string;
  implanteId: string;
}

interface Props {
  conjuntos: readonly ConjuntoMorph[];
  paineis: readonly PainelVista[];
  plano: Plano;
  imf: Imf;
  peso: number;
  envelopeMm: number;
  vista: NomeVista;
  /** landmarks da simulação: câmera clínica e luz padrão no quadro anatômico (sem eles, quadro do arquivo) */
  landmarks?: Landmarks | null;
  /** Expõe o contador de quadros por painel (window.__simuladorSim) para o benchmark de latência. */
  instrumentar?: boolean;
}

/** Pose comum entre os canvases (comparação lado a lado com câmeras sincronizadas). */
class SincroniaCamera {
  private versao = 0;
  private origem = "";
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly alvo = new THREE.Vector3();
  private readonly ouvintes = new Map<string, () => void>();

  registrar(chave: string, invalidar: () => void): () => void {
    this.ouvintes.set(chave, invalidar);
    return () => this.ouvintes.delete(chave);
  }

  publicar(chave: string, cam: THREE.Camera, alvo: THREE.Vector3): void {
    this.pos.copy(cam.position);
    this.quat.copy(cam.quaternion);
    this.alvo.copy(alvo);
    this.origem = chave;
    this.versao++;
    for (const [k, inv] of this.ouvintes) if (k !== chave) inv();
  }

  /** Aplica a última pose publicada por OUTRO canvas; devolve a versão vista. */
  aplicar(chave: string, versaoVista: number, cam: THREE.Camera, alvo: THREE.Vector3): number {
    if (this.versao !== versaoVista && this.origem !== chave) {
      cam.position.copy(this.pos);
      cam.quaternion.copy(this.quat);
      alvo.copy(this.alvo);
      cam.updateMatrixWorld();
    }
    return this.versao;
  }
}

const GANCHOS_TESTE = process.env.NEXT_PUBLIC_GANCHOS_TESTE === "1";
type Gancho = { quadros: Record<string, number>; estado: Record<string, unknown>; renderSincrono: Record<string, () => number> };
/**
 * Ganchos de medição: ligados no build de teste (NEXT_PUBLIC_GANCHOS_TESTE=1) ou, só com contador
 * de quadros e estado da cena, pela página /benchmark (prop `instrumentar`; torso sintético).
 */
function gancho(instrumentar = false): Gancho | null {
  if ((!GANCHOS_TESTE && !instrumentar) || typeof window === "undefined") return null;
  const w = window as unknown as { __simuladorSim?: Gancho };
  w.__simuladorSim ??= { quadros: {}, estado: {}, renderSincrono: {} };
  return w.__simuladorSim;
}

const OPCOES_CAMERA = { fov: 15, near: 1, far: 20000, position: [0, 0, 1600] as [number, number, number] };
const FOV_ORBITA_LIVRE = 35;
// Sem MSAA: o custo de preenchimento cai ~4× em GPUs fracas; a malha densa dispensa antialias.
const OPCOES_GL = { antialias: false, alpha: false, stencil: false, desynchronized: true, powerPreference: "high-performance" as const };
const ESTILO_CANVAS = { background: FUNDO_ESTUDIO };
const chaveConjunto = (p: Plano, i: Imf) => `${p}__${i}`;
const olhoTmp = new THREE.Vector3();

function Cena({ painel, conjuntos, plano, imf, peso, envelopeMm, vista, landmarks, sincronia, onErro, instrumentar }: Omit<Props, "paineis"> & { painel: PainelVista; sincronia: SincroniaCamera; onErro: (m: string | null) => void }) {
  const obter = useThree((s) => s.get);
  const invalidar = useThree((s) => s.invalidate);
  const controles = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => boolean } | null;
  const aplicando = useRef(false);
  const versaoLocal = useRef(0);
  // O quadro é renderizado DENTRO do layout effect (advance), antes de o useFrame receber o
  // closure novo: o useFrame lê o estado corrente daqui, não das props.
  const atual = useRef<{ plano: Plano; imf: Imf; implanteId: string; cenas: Map<string, CenaSimulada> | null }>({ plano, imf, implanteId: painel.implanteId, cenas: null });


  const caixa = conjuntos[0]!.carregada.caixa;
  // Câmeras clínicas (as mesmas do modo foto) e o quadro anatômico da luz padrão.
  const { cameras, quadro } = useMemo(() => {
    const q = quadroClinico(landmarks ?? null, caixa);
    return { cameras: camerasClinicas(landmarks ?? null, caixa), quadro: q.fonte === "landmarks" ? { x: q.x, y: q.y, z: q.z } : null };
  }, [landmarks, caixa]);
  // Uma cena (pele + envelope) por (plano, imf); trocar plano/IMF = trocar a visível (pré-carregadas).
  // Pele-foto (sem luz somada) e halo: o mesmo material do modo foto.
  const cenas = useMemo(() => {
    const m = new Map<string, CenaSimulada>();
    for (const c of conjuntos) {
      const cena = criarCenaSimulada(c.carregada.malha, envelopeMm);
      cena.definirIluminacao(shDaCena(c.carregada.extras, quadro).sh9);
      m.set(chaveConjunto(c.plano, c.imf), cena);
    }
    return m;
  }, [conjuntos, envelopeMm, quadro]);
  const raiz = useMemo(() => {
    const g = new THREE.Group();
    for (const c of cenas.values()) g.add(c.grupo);
    return g;
  }, [cenas]);
  useEffect(() => () => cenas.forEach((c) => c.descartar()), [cenas]);

  useLayoutEffect(() => {
    atual.current = { plano, imf, implanteId: painel.implanteId, cenas };
    const ativa = chaveConjunto(plano, imf);
    for (const [k, c] of cenas) {
      // a cena inativa só é escondida (pele e envelope juntos); mantém o alvo e a máscara prontos
      c.mostrar(k === ativa);
      if (k === ativa) c.definir(nomeTarget(painel.implanteId, plano, imf, "ambos"), peso);
    }
    // Renderiza JÁ, dentro do próprio evento (sem esperar o próximo rAF do frameloop "demand"):
    // economiza até um quadro de latência entre o input e a imagem.
    obter().advance(performance.now(), true);
  }, [cenas, plano, imf, peso, painel.implanteId, obter]);

  useEffect(() => {
    const camera = obter().camera as THREE.PerspectiveCamera;
    let centro: THREE.Vector3;
    if ((VISTAS_CLINICAS as readonly string[]).includes(vista)) {
      // câmera de fotografia clínica (FOV 15°, enquadramento fúrcula +40 mm a sulco −120 mm)
      const c = cameras[vista as VistaClinica];
      camera.fov = c.fov;
      camera.near = c.near;
      camera.far = c.far;
      camera.position.set(...c.posicao);
      camera.up.set(...c.up);
      centro = new THREE.Vector3(...c.alvo);
      camera.lookAt(centro);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    } else {
      camera.fov = FOV_ORBITA_LIVRE;
      centro = posicionarCamera(camera, caixa, vista);
    }
    if (controles) {
      aplicando.current = true;
      controles.target.copy(centro);
      controles.update();
      aplicando.current = false;
    }
    invalidar();
  }, [vista, caixa, cameras, obter, controles, invalidar]);

  useEffect(() => sincronia.registrar(painel.chave, invalidar), [sincronia, painel.chave, invalidar]);

  // gancho de teste: tempo de um render forçado a terminar (readPixels) — custo real da GPU/SwiftShader
  useEffect(() => {
    const g = gancho();
    if (!g) return;
    g.renderSincrono[painel.chave] = () => {
      const { gl, scene, camera } = obter();
      const ctx = gl.getContext();
      const px = new Uint8Array(4);
      const t = performance.now();
      gl.render(scene, camera);
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      return performance.now() - t;
    };
    return () => {
      delete g.renderSincrono[painel.chave];
    };
  }, [obter, painel.chave]);

  useFrame(() => {
    // câmera sincronizada: aplica a pose publicada por outro canvas
    if (controles) {
      aplicando.current = true;
      versaoLocal.current = sincronia.aplicar(painel.chave, versaoLocal.current, obter().camera, controles.target);
      aplicando.current = false;
    }
    const { plano: p, imf: i, implanteId, cenas: cs } = atual.current;
    const ativa = cs?.get(chaveConjunto(p, i));
    // descarte antecipado das faces de costas da pele para a vista atual (mesma imagem, menos
    // trabalho de vértice/primitiva: decisivo em GPU fraca e no painel duplo)
    if (ativa) {
      const cam = obter().camera;
      ativa.atualizarVista((cam as THREE.PerspectiveCamera).isPerspectiveCamera ? cam.getWorldPosition(olhoTmp) : null);
    }
    try {
      if (ativa) garantirEnvelope(ativa);
      onErro(null);
    } catch (e) {
      onErro((e as Error).message);
    }
    const g = gancho(instrumentar);
    if (g) {
      g.quadros[painel.chave] = (g.quadros[painel.chave] ?? 0) + 1;
      const c = obter().camera.position;
      let luzes = 0;
      obter().scene.traverse((o) => void ((o as THREE.Light).isLight && luzes++));
      g.estado[painel.chave] = { ...ativa?.estado(), plano: p, imf: i, implante: implanteId, camera: [c.x, c.y, c.z], luzes };
    }
  });

  const publicar = () => {
    if (aplicando.current || !controles) return;
    sincronia.publicar(painel.chave, obter().camera, controles.target);
  };

  return (
    <>
      {/* sem luzes: a pele é a foto do scan (a luz já está nela); o "depois" usa a razão SH9 */}
      <color attach="background" args={[FUNDO_ESTUDIO]} />
      <OrbitControls makeDefault enableDamping={false} onChange={publicar} />
      <primitive object={raiz} />
    </>
  );
}

/**
 * Viewer da simulação: 1 painel (um implante) ou 2 lado a lado (comparação), com câmeras
 * sincronizadas. Cada painel mostra a pele simulada SEMPRE com o envelope ±envelope_rms_mm.
 */
export default function VisualizadorSimulacao(props: Props) {
  const [sincronia] = useState(() => new SincroniaCamera());
  const [erros, setErros] = useState<Record<string, string | null>>({});
  return (
    <div className="sim-paineis" data-testid="simulacao-paineis" data-n={props.paineis.length}>
      {props.paineis.map((p) => (
        <figure key={p.chave} className="sim-painel" data-testid={`sim-painel-${p.chave}`}>
          <figcaption>{p.rotulo}</figcaption>
          <div className="sim-canvas">
            <Canvas frameloop="demand" flat dpr={1} camera={OPCOES_CAMERA} gl={OPCOES_GL} style={ESTILO_CANVAS}>
              <Cena
                {...props}
                painel={p}
                sincronia={sincronia}
                onErro={(m) => {
                  if ((erros[p.chave] ?? null) !== m) setErros((e) => ({ ...e, [p.chave]: m }));
                }}
              />
            </Canvas>
            <div className="sim-legenda" data-testid={`envelope-legenda-${p.chave}`}>
              <span className="cor-int">Linhas âmbar = faixa ±{String(props.envelopeMm).replace(".", ",")} mm</span> (contorno hachurado; pontilhado = limite da região simulada) · ilustração
            </div>
            {erros[p.chave] && (
              <div className="sim-erro" role="alert">
                Simulação ocultada: {erros[p.chave]}
              </div>
            )}
          </div>
        </figure>
      ))}
    </div>
  );
}
