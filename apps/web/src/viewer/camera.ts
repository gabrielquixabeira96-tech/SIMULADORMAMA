import * as THREE from "three";
import { DISTANCIA_EM_RAIOS, VISTAS, type NomeVista } from "./vistas";

/** Posiciona a câmera numa vista padronizada, olhando para o centro da esfera envolvente. */
export function posicionarCamera(cam: THREE.PerspectiveCamera, caixa: THREE.Box3, vista: NomeVista): THREE.Vector3 {
  const esfera = caixa.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(esfera.radius, 1);
  const [dx, dy, dz] = VISTAS[vista].direcao;
  const dir = new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(r * DISTANCIA_EM_RAIOS);
  cam.position.copy(esfera.center).add(dir);
  cam.up.set(0, 1, 0);
  cam.near = r / 200;
  cam.far = r * 50;
  cam.lookAt(esfera.center);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return esfera.center;
}
