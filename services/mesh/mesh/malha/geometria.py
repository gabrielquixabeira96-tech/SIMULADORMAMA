"""Primitivas geometricas vetorizadas: solda de vertices, normais, ponto mais proximo, volume assinado."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree


def soldar(V: np.ndarray, F: np.ndarray, tol_mm: float = 1e-5) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Funde vertices com a mesma posicao (costuras de UV). Devolve (Vw, Fw, mapa_render_para_soldado).

    A ordem dos vertices soldados segue a primeira ocorrencia na malha de entrada.
    """
    chave = np.round(np.asarray(V, dtype=np.float64) / tol_mm).astype(np.int64)
    _, primeiro, inverso = np.unique(chave, axis=0, return_index=True, return_inverse=True)
    inverso = inverso.reshape(-1)
    ordem = np.argsort(primeiro)  # renumera na ordem de primeira ocorrencia
    rank = np.empty_like(ordem)
    rank[ordem] = np.arange(len(ordem))
    mapa = rank[inverso]
    Vw = np.asarray(V, dtype=np.float64)[np.sort(primeiro)]
    Fw = mapa[np.asarray(F)]
    return Vw, Fw.astype(np.int64), mapa


def areas_faces(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)


def normais_vertices(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    fn = np.cross(b - a, c - a)  # ponderada pela area
    N = np.zeros_like(V, dtype=np.float64)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    norma = np.linalg.norm(N, axis=1, keepdims=True)
    norma[norma == 0] = 1.0
    return N / norma


def volume_assinado(V: np.ndarray, F: np.ndarray) -> float:
    """Soma de det(a,b,c)/6 (teorema da divergencia). Em malha fechada = volume interno, em mm^3."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def componentes(F: np.ndarray, n_vertices: int) -> tuple[int, np.ndarray]:
    """Componentes conexos por vertice compartilhado. Devolve (n, rotulo_por_vertice)."""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    g = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n_vertices, n_vertices))
    return connected_components(g, directed=False)


def compactar(V: np.ndarray, F: np.ndarray, *extras: np.ndarray | None):
    """Remove vertices nao referenciados. Devolve (V2, F2, indices_mantidos, *extras2)."""
    usados = np.unique(F)
    mapa = -np.ones(len(V), dtype=np.int64)
    mapa[usados] = np.arange(len(usados))
    saida = [V[usados], mapa[F], usados]
    for x in extras:
        saida.append(None if x is None else x[usados])
    return tuple(saida)


# ----------------------------------------------------------------------------- ponto mais proximo

def ponto_mais_proximo_triangulos(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray):
    """Ponto mais proximo de p em cada triangulo (a,b,c) — Ericson, Real-Time Collision Detection 5.1.5.

    Todos os argumentos (n,3). Devolve (q (n,3), bary (n,3)).
    """
    ab, ac, ap = b - a, c - a, p - a
    d1 = np.einsum("ij,ij->i", ab, ap)
    d2 = np.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3 = np.einsum("ij,ij->i", ab, bp)
    d4 = np.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5 = np.einsum("ij,ij->i", ab, cp)
    d6 = np.einsum("ij,ij->i", ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2

    n = len(p)
    bary = np.zeros((n, 3))
    feito = np.zeros(n, dtype=bool)

    def definir(mask, u, v, w):
        m = mask & ~feito
        bary[m, 0], bary[m, 1], bary[m, 2] = u[m], v[m], w[m]
        feito[m] = True

    um, zero = np.ones(n), np.zeros(n)
    with np.errstate(divide="ignore", invalid="ignore"):
        definir((d1 <= 0) & (d2 <= 0), um, zero, zero)  # vertice a
        definir((d3 >= 0) & (d4 <= d3), zero, um, zero)  # vertice b
        v_ab = d1 / (d1 - d3)
        definir((vc <= 0) & (d1 >= 0) & (d3 <= 0), 1 - v_ab, v_ab, zero)  # aresta ab
        definir((d6 >= 0) & (d5 <= d6), zero, zero, um)  # vertice c
        w_ac = d2 / (d2 - d6)
        definir((vb <= 0) & (d2 >= 0) & (d6 <= 0), 1 - w_ac, zero, w_ac)  # aresta ac
        w_bc = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        definir((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), zero, 1 - w_bc, w_bc)  # aresta bc
        den = va + vb + vc
        v_in = vb / den
        w_in = vc / den
        definir(np.ones(n, dtype=bool), 1 - v_in - w_in, v_in, w_in)  # interior
    bary = np.nan_to_num(bary, nan=1.0 / 3.0)
    q = bary[:, :1] * a + bary[:, 1:2] * b + bary[:, 2:3] * c
    return q, bary


@dataclass
class Proximidade:
    """Consulta de ponto mais proximo na superficie (faces vizinhas dos k vertices mais proximos)."""

    V: np.ndarray
    F: np.ndarray

    def __post_init__(self):
        self.V = np.asarray(self.V, dtype=np.float64)
        self.F = np.asarray(self.F, dtype=np.int64)
        self.arvore = cKDTree(self.V)
        # adjacencia vertice -> faces, em matriz preenchida com -1 (n_vertices, valencia_max)
        nf = len(self.F)
        vert = self.F.reshape(-1)
        face = np.repeat(np.arange(nf), 3)
        ordem = np.argsort(vert, kind="stable")
        vert_o, face_o = vert[ordem], face[ordem]
        inicio = np.searchsorted(vert_o, np.arange(len(self.V) + 1))
        grau = np.diff(inicio)
        gmax = int(grau.max()) if len(grau) else 1
        pos = np.arange(len(vert_o)) - inicio[vert_o]
        self._adj = -np.ones((len(self.V), max(gmax, 1)), dtype=np.int64)
        self._adj[vert_o, pos] = face_o

    def consultar(self, pontos: np.ndarray, k: int = 6, lote: int = 4000):
        """Devolve (ponto (n,3), face (n,), bary (n,3), distancia (n,))."""
        pontos = np.atleast_2d(np.asarray(pontos, dtype=np.float64))
        k = min(k, len(self.V))
        _, viz = self.arvore.query(pontos, k=k)
        viz = np.asarray(viz).reshape(len(pontos), -1)
        n = len(pontos)
        Q = np.zeros((n, 3))
        FACE = np.zeros(n, dtype=np.int64)
        BARY = np.zeros((n, 3))
        DIST = np.zeros(n)
        for i0 in range(0, n, lote):
            i1 = min(n, i0 + lote)
            cand = self._adj[viz[i0:i1]].reshape(i1 - i0, -1)  # (b, k*gmax)
            m = cand.shape[1]
            valido = cand >= 0
            cand_s = np.where(valido, cand, 0)
            tri = self.F[cand_s.reshape(-1)]
            pp = np.repeat(pontos[i0:i1], m, axis=0)
            q, bary = ponto_mais_proximo_triangulos(pp, self.V[tri[:, 0]], self.V[tri[:, 1]], self.V[tri[:, 2]])
            d = np.linalg.norm(q - pp, axis=1).reshape(i1 - i0, m)
            d[~valido] = np.inf
            j = np.argmin(d, axis=1)
            idx = np.arange(i1 - i0) * m + j
            Q[i0:i1] = q[idx]
            BARY[i0:i1] = bary[idx]
            FACE[i0:i1] = cand_s.reshape(-1)[idx]
            DIST[i0:i1] = d[np.arange(i1 - i0), j]
        return Q, FACE, BARY, DIST
