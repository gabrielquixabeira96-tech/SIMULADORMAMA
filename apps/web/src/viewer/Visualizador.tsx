"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vetor3 } from "@simulador/contratos";
import { verticeMaisProximo, type MalhaCarregada } from "./carregar";

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
  onClique: (c: CliqueNaMalha) => void;
}

// Objetos ESTÁVEIS (fora do componente): o R3F reaplica as opções de câmera quando o objeto
// muda entre renders, o que reposicionaria a câmera a cada atualização de estado.
const OPCOES_CAMERA = { fov: 35, near: 1, far: 20000, position: [0, 0, 1200] as [number, number, number] };
const OPCOES_GL = { preserveDrawingBuffer: false, antialias: true };
const ESTILO_CANVAS = { background: "var(--fundo-viewer)" };

function Enquadrar({ carregada }: { carregada: MalhaCarregada }) {
  const obter = useThree((s) => s.get);
  const controles = useThree((s) => s.controls);
  useEffect(() => {
    const { camera } = obter();
    const cam = camera as THREE.PerspectiveCamera;
    const ctl = controles as unknown as { target: THREE.Vector3; update: () => void } | null;
    const esfera = carregada.caixa.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(esfera.radius, 1);
    // Paciente olha para +Z (contratos §1): câmera à frente, em +Z.
    cam.position.set(esfera.center.x, esfera.center.y, esfera.center.z + r * 2.6);
    cam.near = r / 200;
    cam.far = r * 50;
    cam.updateProjectionMatrix();
    cam.lookAt(esfera.center);
    if (ctl) {
      ctl.target.copy(esfera.center);
      ctl.update();
    }
  }, [carregada, obter, controles]);
  return null;
}

export default function Visualizador({ carregada, marcadores, linhaRegua, clicavel, onClique }: Props) {
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
          <Enquadrar carregada={carregada} />
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
