"""Geodesica discreta exata (MMP — Mitchell, Mount & Papadimitriou; implementacao de Kirsanov via
`pygeodesic`, MIT) entre pontos da superficie — contratos §3.1, ADR 0011.

Detalhes que garantem a exatidao do valor registrado:

1. **Pontos exatos, nao vertices.** Cada extremo (`posicao`) e projetado na superficie e inserido
   como vertice novo (divisao 1->3 do triangulo que o contem). Assim a geodesica parte do ponto
   clicado/gabarito e nao do vertice mais proximo (que, numa malha de 30–50 mil vertices, estaria a
   ate ~2 mm e sozinho estouraria a tolerancia de ±1 mm). Pontos a < 2 % de um vertice sao
   ajustados a ele; pontos junto a uma aresta sao empurrados 2 % para dentro (deslocamento
   < 0,1 mm), evitando triangulos degenerados.
2. **Recorte elipsoidal exato.** O MMP de Kirsanov propaga frentes pela malha toda ate alcancar o
   alvo; para acelerar sem perder exatidao, calcula-se um limite superior L (Dijkstra sobre
   arestas, que nunca e menor que a geodesica exata) e mantem-se so as faces com algum vertice em
   |x-s| + |x-t| <= L + 2*aresta_max. Todo ponto de qualquer caminho de comprimento <= L esta nesse
   elipsoide (a distancia euclidiana nunca excede a geodesica), logo o caminho minimo sobrevive.
3. A malha deve estar **soldada** (sem vertices duplicados em costura de UV); `geometria.soldar`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from mesh.malha.geometria import Proximidade, componentes

ALGORITMO = "mmp"
BIBLIOTECA = "pygeodesic"


@dataclass
class MalhaGeodesica:
    V: np.ndarray
    F: np.ndarray
    indices: dict[str, int]  # nome do ponto -> indice do vertice inserido
    deslocamento_mm: dict[str, float]  # distancia entre o ponto pedido e o vertice usado


def inserir_pontos(V: np.ndarray, F: np.ndarray, pontos: dict[str, np.ndarray],
                   prox: Proximidade | None = None, tol_vertice: float = 0.02,
                   margem_aresta: float = 0.02) -> MalhaGeodesica:
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    prox = prox or Proximidade(V, F)
    nomes = list(pontos)
    P = np.array([np.asarray(pontos[n], dtype=np.float64) for n in nomes]).reshape(-1, 3)
    q, face, bary, _ = prox.consultar(P, k=8)

    novosV: list[np.ndarray] = []
    remover: set[int] = set()
    novasF: list[list[int]] = []
    indices: dict[str, int] = {}
    desloc: dict[str, float] = {}
    usadas: dict[int, str] = {}
    for i, nome in enumerate(nomes):
        f = int(face[i])
        tri = F[f]
        b = bary[i].copy()
        j = int(np.argmax(b))
        if b[j] >= 1.0 - tol_vertice or f in usadas:
            # muito perto de um vertice (ou face ja dividida por outro ponto): usa o vertice
            v = int(tri[j]) if b[j] >= 1.0 - tol_vertice else int(tri[np.argmax(b)])
            indices[nome] = v
            desloc[nome] = float(np.linalg.norm(V[v] - P[i]))
            continue
        b = np.maximum(b, margem_aresta)
        b /= b.sum()
        ponto = b @ V[tri]
        idx = len(V) + len(novosV)
        novosV.append(ponto)
        remover.add(f)
        usadas[f] = nome
        a_, b_, c_ = (int(x) for x in tri)
        novasF += [[a_, b_, idx], [b_, c_, idx], [c_, a_, idx]]
        indices[nome] = idx
        desloc[nome] = float(np.linalg.norm(ponto - P[i]))
    if novosV:
        manter = np.ones(len(F), dtype=bool)
        manter[list(remover)] = False
        V = np.vstack([V, np.array(novosV)])
        F = np.vstack([F[manter], np.array(novasF, dtype=np.int64)])
    return MalhaGeodesica(V=V, F=F, indices=indices, deslocamento_mm=desloc)


def _grafo_arestas(V: np.ndarray, F: np.ndarray):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
    g = coo_matrix((w, (e[:, 0], e[:, 1])), shape=(len(V), len(V))).tocsr()
    return g, float(w.max())


def geodesica_mmp(V: np.ndarray, F: np.ndarray, s: int, t: int, grafo=None) -> float:
    """Comprimento da geodesica exata entre os vertices s e t (malha soldada)."""
    from pygeodesic.geodesic import PyGeodesicAlgorithmExact

    if s == t:
        return 0.0
    if grafo is None:
        grafo = _grafo_arestas(V, F)
    g, emax = grafo
    L = float(dijkstra(g, directed=False, indices=s, limit=np.inf)[t])
    if not np.isfinite(L):
        raise ValueError("pontos em componentes desconexos da malha")
    soma = np.linalg.norm(V - V[s], axis=1) + np.linalg.norm(V - V[t], axis=1)
    dentro = soma <= L + 2.0 * emax + 1e-6
    Fs = F[dentro[F].any(axis=1)]
    usados = np.unique(Fs)
    mapa = -np.ones(len(V), dtype=np.int64)
    mapa[usados] = np.arange(len(usados))
    Vs, Fs2 = V[usados], mapa[Fs]
    # mantem so o componente que contem s (ilhas do recorte confundem o MMP)
    _, rot = componentes(Fs2, len(Vs))
    alvo = rot[mapa[s]]
    Fs2 = Fs2[rot[Fs2[:, 0]] == alvo]
    usados2 = np.unique(Fs2)
    mapa2 = -np.ones(len(Vs), dtype=np.int64)
    mapa2[usados2] = np.arange(len(usados2))
    alg = PyGeodesicAlgorithmExact(Vs[usados2], mapa2[Fs2].astype(np.int32))
    d, _ = alg.geodesicDistance(int(mapa2[mapa[s]]), int(mapa2[mapa[t]]))
    if d is None or not np.isfinite(d):
        raise RuntimeError("falha no calculo da geodesica")
    return float(min(d, L))


def geodesicas_entre_pontos(V: np.ndarray, F: np.ndarray, pontos: dict[str, np.ndarray],
                            pares: dict[str, tuple[str, str]], prox: Proximidade | None = None) -> dict[str, float]:
    """Geodesicas MMP para cada par nomeado {id: (ponto_a, ponto_b)} entre pontos da superficie."""
    necessarios = {n for par in pares.values() for n in par}
    mg = inserir_pontos(V, F, {n: pontos[n] for n in necessarios}, prox=prox)
    grafo = _grafo_arestas(mg.V, mg.F)
    return {k: geodesica_mmp(mg.V, mg.F, mg.indices[a], mg.indices[b], grafo) for k, (a, b) in pares.items()}
