"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vetor3 } from "@simulador/contratos";
import { verticeMaisProximo, type MalhaCarregada } from "./carregar";
import { posicionarCamera } from "./camera";
import { NOMES_VISTAS, type NomeVista } from "./vistas";

export interface Marcador {
  id: string;
  posicao: Vetor3;
  cor: string;
}

export interface CliqueNaMalha {
  posicao: Vetor3;
  vertice: number;
}

interface Props {
  carregada: MalhaCarregada | null;
  marcadores: Marcador[];
  linhaRegua: [Vetor3, Vetor3] | null;
  clicavel: boolean;
  vista: NomeVista;
  onClique: (c: CliqueNaMalha) => void;
}

// Objetos ESTÁVEIS (fora do componente): o R3F reaplica as opções de câmera quando o objeto
// muda entre renders, o que reposicionaria a câmera a cada atualização de estado.
const OPCOES_CAMERA = { fov: 35, near: 1, far: 20000, position: [0, 0, 1200] as [number, number, number] };
const OPCOES_GL = { preserveDrawingBuffer: false, antialias: true };
const ESTILO_CANVAS = { background: "var(--fundo-viewer)" };

function Enquadrar({ carregada, vista }: { carregada: MalhaCarregada; vista: NomeVista }) {
  const obter = useThree((s) => s.get);
  const controles = useThree((s) => s.controls);
  const invalidar = useThree((s) => s.invalidate);
  useEffect(() => {
    const { camera } = obter();
    const centro = posicionarCamera(camera as THREE.PerspectiveCamera, carregada.caixa, vista);
    const ctl = controles as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (ctl) {
      ctl.target.copy(centro);
      ctl.update();
    }
    invalidar();
  }, [carregada, vista, obter, controles, invalidar]);
  return null;
}

/**
 * Gancho de TESTE (só em builds com NEXT_PUBLIC_GANCHOS_TESTE=1, usado pelos e2e de validação):
 * projeta um ponto 3D (mm) para pixels da página com a câmera viva e diz se ele está visível
 * (primeira interseção do raio a < 1 mm do ponto) e o cosseno entre o raio e a normal da face.
 * Não altera nada na cena; é o "olho" de um operador que mira o ponto e clica.
 */
const GANCHOS_TESTE = process.env.NEXT_PUBLIC_GANCHOS_TESTE === "1";

function GanchoTeste({ carregada }: { carregada: MalhaCarregada }) {
  const obter = useThree((s) => s.get);
  useEffect(() => {
    const w = window as unknown as { __simuladorViewer?: unknown };
    w.__simuladorViewer = {
      projetar(p: [number, number, number]) {
        const { camera, gl, raycaster } = obter();
        camera.updateMatrixWorld();
        const alvo = new THREE.Vector3(...p);
        const ndc = alvo.clone().project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        const x = rect.left + ((ndc.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - ndc.y) / 2) * rect.height;
        raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
        const hit = raycaster.intersectObject(carregada.objeto, true)[0];
        const visivel = !!hit && hit.point.distanceTo(alvo) < 1.0 && Math.abs(ndc.x) < 0.98 && Math.abs(ndc.y) < 0.98;
        const cos = hit?.face ? Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(raycaster.ray.direction)) : 0;
        return { x, y, visivel, cos, mm_por_px: (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360) * camera.position.distanceTo(alvo)) / rect.height };
      },
      /** Avalia todas as vistas SEM renderizar: a de maior cosseno em que o ponto é visível. */
      melhorVista(p: [number, number, number], margemTopoPx = 60) {
        const { camera, gl } = obter();
        const rect = gl.domElement.getBoundingClientRect();
        const alvo = new THREE.Vector3(...p);
        const tmp = (camera as THREE.PerspectiveCamera).clone();
        const ray = new THREE.Raycaster();
        let melhor: { vista: NomeVista; cos: number } | null = null;
        for (const v of NOMES_VISTAS) {
          posicionarCamera(tmp, carregada.caixa, v);
          const ndc = alvo.clone().project(tmp);
          const y = rect.top + ((1 - ndc.y) / 2) * rect.height;
          if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95 || y < margemTopoPx) continue;
          ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), tmp);
          const hit = ray.intersectObject(carregada.objeto, true)[0];
          if (!hit || hit.point.distanceTo(alvo) >= 1.0 || !hit.face) continue;
          const cos = Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(ray.ray.direction));
          if (!melhor || cos > melhor.cos) melhor = { vista: v, cos };
        }
        return melhor;
      },
    };
    return () => {
      delete w.__simuladorViewer;
    };
  }, [carregada, obter]);
  return null;
}

export default function Visualizador({ carregada, marcadores, linhaRegua, clicavel, vista, onClique }: Props) {
  const raioMarcador = useMemo(() => {
    if (!carregada) return 3;
    const r = carregada.caixa.getBoundingSphere(new THREE.Sphere()).radius;
    return Math.max(1, r * 0.012);
  }, [carregada]);

  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    if (!clicavel || !carregada) return;
    if (e.delta > 4) return; // foi arraste de câmera, não clique
    e.stopPropagation();
    const face = e.face;
    const obj = e.object as THREE.Mesh;
    if (!face || !obj.isMesh) return;
    const local = obj.worldToLocal(e.point.clone());
    const vertice = verticeMaisProximo(obj.geometry as THREE.BufferGeometry, face, local);
    onClique({ posicao: [e.point.x, e.point.y, e.point.z], vertice });
  };

  return (
    <Canvas
      frameloop="demand"
      data-testid="viewer-canvas"
      camera={OPCOES_CAMERA}
      gl={OPCOES_GL}
      style={ESTILO_CANVAS}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[300, 600, 1200]} intensity={1.6} />
      <directionalLight position={[-400, 200, -600]} intensity={0.4} />
      <OrbitControls makeDefault enableDamping={false} />
      {carregada && (
        <>
          <Enquadrar carregada={carregada} vista={vista} />
          {GANCHOS_TESTE && <GanchoTeste carregada={carregada} />}
          <primitive object={carregada.objeto} onClick={aoClicar} />
        </>
      )}
      {marcadores.map((m) => (
        <mesh key={m.id} position={m.posicao} raycast={() => null}>
          <sphereGeometry args={[raioMarcador, 16, 12]} />
          <meshBasicMaterial color={m.cor} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {linhaRegua && <Line points={linhaRegua} color="#1f6feb" lineWidth={2} depthTest={false} />}
    </Canvas>
  );
}
