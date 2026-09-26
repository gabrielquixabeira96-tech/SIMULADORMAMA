"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ehIdentidade, validarAssetGlb } from "./validarGlb";

/**
 * Carregadores do viewer. Tudo em mm, Y para cima, sem escala na carga (ADR 0010).
 * - GLB processado (servidor): índices de vértice válidos (mesma ordem de processada.obj).
 * - OBJ/MTL/PNG ou PLY locais: pré-visualização; índices de vértice NÃO são canônicos no OBJ
 *   (o OBJLoader desindexa), por isso medir/gravar exige o GLB processado.
 */

export interface MalhaCarregada {
  objeto: THREE.Object3D;
  malha: THREE.Mesh;
  caixa: THREE.Box3;
  nVertices: number;
  /** true quando `vertice` do raycast corresponde ao índice canônico da malha processada */
  indicesCanonicos: boolean;
  origem: "glb" | "obj" | "ply";
  quadro?: "scan" | "anatomico";
}

const COR_NEUTRA = 0xd9b8a3;

function primeiraMalha(o: THREE.Object3D): THREE.Mesh {
  let achada: THREE.Mesh | null = null;
  o.traverse((c) => {
    if (!achada && (c as THREE.Mesh).isMesh) achada = c as THREE.Mesh;
  });
  if (!achada) throw new Error("arquivo sem malha");
  return achada;
}

function finalizar(objeto: THREE.Object3D, origem: MalhaCarregada["origem"], indicesCanonicos: boolean, quadro?: MalhaCarregada["quadro"]): MalhaCarregada {
  objeto.updateMatrixWorld(true);
  const malha = primeiraMalha(objeto);
  const g = malha.geometry as THREE.BufferGeometry;
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const caixa = new THREE.Box3().setFromObject(objeto);
  return { objeto, malha, caixa, nVertices: g.getAttribute("position").count, indicesCanonicos, origem, quadro };
}

export async function carregarGlb(url: string, esquemaEsperado?: string): Promise<MalhaCarregada> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`falha ao baixar a malha (${resp.status})`);
  const buf = await resp.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buf, "");
  const v = validarAssetGlb(gltf.asset, esquemaEsperado);
  if (!v.ok) throw new Error(`GLB recusado: ${v.motivo}`);
  // Nenhum nó com transformação (contratos §5.3).
  let comTransformacao = false;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !ehIdentidade(o.matrixWorld.elements)) comTransformacao = true;
  });
  if (comTransformacao) throw new Error("GLB recusado: nó com transformação (a malha deve estar em mm, sem escala)");
  const malha = primeiraMalha(gltf.scene);
  const g = malha.geometry as THREE.BufferGeometry;
  return finalizar(gltf.scene, "glb", g.index !== null, v.quadro);
}

/** Carrega OBJ + MTL + texturas a partir de arquivos locais (File) ou de URLs nomeadas. */
export async function carregarObj(arquivos: Map<string, string>): Promise<MalhaCarregada> {
  const nomes = [...arquivos.keys()];
  const nomeObj = nomes.find((n) => n.toLowerCase().endsWith(".obj"));
  if (!nomeObj) throw new Error("nenhum .obj selecionado");
  const nomeMtl = nomes.find((n) => n.toLowerCase().endsWith(".mtl"));
  const gerenciador = new THREE.LoadingManager();
  let pedidos = 0;
  let concluidos = 0;
  let avisar: (() => void) | null = null;
  gerenciador.onProgress = (_u, carregados, total) => {
    pedidos = total;
    concluidos = carregados;
  };
  gerenciador.onStart = (_u, carregados, total) => {
    pedidos = total;
    concluidos = carregados;
  };
  gerenciador.onLoad = () => avisar?.();
  gerenciador.onError = () => avisar?.();
  gerenciador.setURLModifier((url) => {
    const base = decodeURIComponent(url.split(/[\\/]/).pop() ?? url);
    return arquivos.get(base) ?? url;
  });
  const textoObj = await (await fetch(arquivos.get(nomeObj)!)).text();
  const obj = new OBJLoader(gerenciador);
  if (nomeMtl) {
    const textoMtl = await (await fetch(arquivos.get(nomeMtl)!)).text();
    const mtl = new MTLLoader(gerenciador).parse(textoMtl, "");
    mtl.preload();
    obj.setMaterials(mtl);
  }
  const grupo = obj.parse(textoObj);
  // Espera as texturas pedidas pelo MTL (se houver), com limite de 10 s.
  await new Promise<void>((ok) => {
    if (pedidos === 0 || concluidos >= pedidos) {
      // pode haver pedido iniciado mas ainda sem progresso: dá uma volta no loop
      setTimeout(() => (pedidos === 0 || concluidos >= pedidos ? ok() : (avisar = ok)), 0);
    } else avisar = ok;
    setTimeout(ok, 10_000);
  });
  grupo.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshPhongMaterial;
    if (mat && "map" in mat && mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    if (!nomeMtl) m.material = new THREE.MeshStandardMaterial({ color: COR_NEUTRA, roughness: 0.8 });
  });
  return finalizar(grupo, "obj", false);
}

export async function carregarPly(url: string): Promise<MalhaCarregada> {
  const buf = await (await fetch(url)).arrayBuffer();
  const g = new PLYLoader().parse(buf);
  const temCor = !!g.getAttribute("color");
  const mat = new THREE.MeshStandardMaterial({ color: temCor ? 0xffffff : COR_NEUTRA, vertexColors: temCor, roughness: 0.8 });
  const malha = new THREE.Mesh(g, mat);
  const grupo = new THREE.Group();
  grupo.add(malha);
  // PLY indexado preserva a ordem dos vértices do arquivo, mas não é a malha processada.
  return finalizar(grupo, "ply", false);
}

/** Índice do vértice (entre os 3 da face atingida) mais próximo do ponto do raycast. */
export function verticeMaisProximo(g: THREE.BufferGeometry, face: { a: number; b: number; c: number }, pontoLocal: THREE.Vector3): number {
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  let melhor = face.a;
  let dMelhor = Infinity;
  for (const i of [face.a, face.b, face.c]) {
    v.fromBufferAttribute(pos, i);
    const d = v.distanceToSquared(pontoLocal);
    if (d < dMelhor) {
      dMelhor = d;
      melhor = i;
    }
  }
  return melhor;
}
