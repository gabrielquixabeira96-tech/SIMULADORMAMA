/**
 * Vistas padronizadas da câmera (direção DA malha PARA a câmera, no quadro da malha:
 * +X esquerda da paciente, +Y cranial, +Z anterior). Oblíqua "dir" = câmera à direita da
 * paciente (−X). As vistas inferiores deixam ver o sulco inframamário sob mamas com ptose.
 */
export const VISTAS = {
  frente: { rotulo: "Frente", direcao: [0, 0, 1] },
  obliqua_dir: { rotulo: "Oblíqua D", direcao: [-Math.SQRT1_2, 0, Math.SQRT1_2] },
  obliqua_esq: { rotulo: "Oblíqua E", direcao: [Math.SQRT1_2, 0, Math.SQRT1_2] },
  perfil_dir: { rotulo: "Perfil D", direcao: [-1, 0, 0.0001] },
  perfil_esq: { rotulo: "Perfil E", direcao: [1, 0, 0.0001] },
  inferior: { rotulo: "Inferior", direcao: [0, -Math.SQRT1_2, Math.SQRT1_2] },
  inferior_dir: { rotulo: "Inferior D", direcao: [-0.5, -0.6, 0.62] },
  inferior_esq: { rotulo: "Inferior E", direcao: [0.5, -0.6, 0.62] },
} as const satisfies Record<string, { rotulo: string; direcao: readonly [number, number, number] }>;

export type NomeVista = keyof typeof VISTAS;
export const NOMES_VISTAS = Object.keys(VISTAS) as NomeVista[];

/** Distância da câmera ao centro, em raios da esfera envolvente (fov vertical 35°). */
export const DISTANCIA_EM_RAIOS = 2.6;
