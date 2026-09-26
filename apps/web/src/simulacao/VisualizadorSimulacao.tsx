"use client";

import { nomeTarget, type Imf, type Plano } from "@simulador/contratos";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { posicionarCamera } from "@/viewer/camera";
import type { MalhaCarregada } from "@/viewer/carregar";
import type { NomeVista } from "@/viewer/vistas";
import { criarCenaSimulada, garantirEnvelope, type CenaSimulada } from "./cena";

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
}

/** Pose compartilhada entre os canvases (comparação lado a lado com câmeras sincronizadas). */
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
function gancho(): Gancho | null {
  if (!GANCHOS_TESTE || typeof window === "undefined") return null;
  const w = window as unknown as { __simuladorSim?: Gancho };
  w.__simuladorSim ??= { quadros: {}, estado: {}, renderSincrono: {} };
  return w.__simuladorSim;
}

const OPCOES_CAMERA = { fov: 35, near: 1, far: 20000, position: [0, 0, 1200] as [number, number, number] };
// Sem MSAA: o custo de preenchimento cai ~4× em GPUs fracas; a malha densa dispensa antialias.
const OPCOES_GL = { antialias: false, alpha: false, stencil: false, desynchronized: true, powerPreference: "high-performance" as const };
const ESTILO_CANVAS = { background: "var(--fundo-viewer)" };
const chaveConjunto = (p: Plano, i: Imf) => `${p}__${i}`;

function Cena({ painel, conjuntos, plano, imf, peso, envelopeMm, vista, sincronia, onErro }: Omit<Props, "paineis"> & { painel: PainelVista; sincronia: SincroniaCamera; onErro: (m: string | null) => void }) {
  const obter = useThree((s) => s.get);
  const invalidar = useThree((s) => s.invalidate);
  const controles = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => boolean } | null;
  const aplicando = useRef(false);
  const versaoLocal = useRef(0);
  // O quadro é renderizado DENTRO do layout effect (advance), antes de o useFrame receber o
  // closure novo: o useFrame lê o estado corrente daqui, não das props.
  const atual = useRef<{ plano: Plano; imf: Imf; implanteId: string; cenas: Map<string, CenaSimulada> | null }>({ plano, imf, implanteId: painel.implanteId, cenas: null });


  // Uma cena (pele + envelope) por (plano, imf); trocar plano/IMF = trocar a visível (pré-carregadas).
  const cenas = useMemo(() => {
    const m = new Map<string, CenaSimulada>();
    for (const c of conjuntos) m.set(chaveConjunto(c.plano, c.imf), criarCenaSimulada(c.carregada.malha, envelopeMm));
    return m;
  }, [conjuntos, envelopeMm]);
  const raiz = useMemo(() => {
    const g = new THREE.Group();
    for (const c of cenas.values()) g.add(c.grupo);
    return g;
  }, [cenas]);
  useEffect(() => () => cenas.forEach((c) => c.descartar()), [cenas]);
  const caixa = conjuntos[0]!.carregada.caixa;

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
    const { camera } = obter();
    const centro = posicionarCamera(camera as THREE.PerspectiveCamera, caixa, vista);
    if (controles) {
      aplicando.current = true;
      controles.target.copy(centro);
      controles.update();
      aplicando.current = false;
    }
    invalidar();
  }, [vista, caixa, obter, controles, invalidar]);

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
    try {
      if (ativa) garantirEnvelope(ativa);
      onErro(null);
    } catch (e) {
      onErro((e as Error).message);
    }
    const g = gancho();
    if (g) {
      g.quadros[painel.chave] = (g.quadros[painel.chave] ?? 0) + 1;
      const c = obter().camera.position;
      g.estado[painel.chave] = { ...ativa?.estado(), plano: p, imf: i, implante: implanteId, camera: [c.x, c.y, c.z] };
    }
  });

  const publicar = () => {
    if (aplicando.current || !controles) return;
    sincronia.publicar(painel.chave, obter().camera, controles.target);
  };

  return (
    <>
      <color attach="background" args={["#e9ecef"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[300, 600, 1200]} intensity={1.7} />
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
              Envelope de incerteza ±{String(props.envelopeMm).replace(".", ",")} mm RMS · <span className="cor-ext">casca azul = +{String(props.envelopeMm).replace(".", ",")} mm</span> ·{" "}
              <span className="cor-int">faixa laranja = região simulada (até −{String(props.envelopeMm).replace(".", ",")} mm)</span>
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
