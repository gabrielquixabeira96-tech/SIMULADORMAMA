"""Rasterizador CPU para uso unico (fotos sinteticas, mapa de visibilidade): sem OpenGL, sem GPU.

Dois caminhos que devem concordar (teste: >= 99,5 % dos pixels cobertos):
- `pintor`: algoritmo do pintor com Pillow (`ImageDraw.polygon` numa imagem modo "I"): faces de costas
  descartadas, ordenadas da mais distante para a mais proxima, cada uma pintada com o proprio indice.
  E o caminho de producao das fotos sinteticas.
- `zbuffer`: z-buffer de referencia em numpy (amostragem no centro do pixel, profundidade 1/z
  interpolada em tela), mais lento em faces grandes; e o oraculo dos testes.

Os dois devolvem o indice da face visivel por pixel (-1 = fundo). `baricentricas` recupera, por
pixel, as coordenadas baricentricas com correcao de perspectiva (para interpolar UV). Pixel (i, j) =
coluna i, linha j, centro em (i + 0,5, j + 0,5) (convencao de mesh/foto/__init__.py).
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from mesh.foto.camera import para_camera


def tela(V: np.ndarray, K: np.ndarray, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Vertices -> (u, v, z_cam) (n, 3)."""
    Xc = para_camera(V, R, t)
    z = Xc[:, 2]
    return np.column_stack([K[0, 0] * Xc[:, 0] / z + K[0, 2], K[1, 1] * Xc[:, 1] / z + K[1, 2], z])


def faces_de_frente(S: np.ndarray, F: np.ndarray) -> np.ndarray:
    """Mascara das faces anti-horarias vistas de fora que ficam de frente para a camera. Na tela (v para
    baixo) a orientacao se inverte: area assinada < 0 = de frente."""
    a, b, c = S[F[:, 0], :2], S[F[:, 1], :2], S[F[:, 2], :2]
    area = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    z_ok = (S[F, 2] > 1e-6).all(1)
    return (area < 0) & z_ok


def pintor(S: np.ndarray, F: np.ndarray, largura: int, altura: int, cull: bool = True) -> np.ndarray:
    idx = np.nonzero(faces_de_frente(S, F))[0] if cull else np.arange(len(F))
    prof = S[F[idx], 2].mean(1)
    ordem = idx[np.argsort(-prof, kind="stable")]
    img = Image.new("I", (largura, altura), -1)
    d = ImageDraw.Draw(img)
    P = S[:, :2] - 0.5  # Pillow: o pixel (i, j) e o ponto inteiro (i, j)
    tri = P[F[ordem]]
    for k, face in enumerate(ordem.tolist()):
        p = tri[k]
        d.polygon([(p[0, 0], p[0, 1]), (p[1, 0], p[1, 1]), (p[2, 0], p[2, 1])], fill=face)
    return np.asarray(img, dtype=np.int32)


def zbuffer(S: np.ndarray, F: np.ndarray, largura: int, altura: int, cull: bool = True,
            devolver_profundidade: bool = False):
    idx = np.nonzero(faces_de_frente(S, F))[0] if cull else np.arange(len(F))
    T = S[F[idx]]  # (m, 3, 3)
    lo = np.floor(T[:, :, :2].min(1) - 0.5).astype(np.int64) + 1  # primeiro centro >= min
    hi = np.floor(T[:, :, :2].max(1) - 0.5).astype(np.int64)
    lo = np.maximum(lo, 0)
    hi[:, 0] = np.minimum(hi[:, 0], largura - 1)
    hi[:, 1] = np.minimum(hi[:, 1], altura - 1)
    tam = np.maximum(hi - lo + 1, 0).max(1)
    pix_all, z_all, f_all = [], [], []
    limites = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1 << 30]
    for k0, k1 in zip(limites[:-1], limites[1:], strict=True):
        sel = np.nonzero((tam >= k0) & (tam < k1))[0] if k0 > 1 else np.nonzero((tam >= 1) & (tam < k1))[0]
        if len(sel) == 0:
            continue
        k = int(tam[sel].max())
        passo = max(1, int(4_000_000 // (k * k)))
        for s0 in range(0, len(sel), passo):
            ss = sel[s0:s0 + passo]
            Tt = T[ss]
            oi = np.arange(k)
            px = lo[ss, 0][:, None, None] + oi[None, None, :]
            py = lo[ss, 1][:, None, None] + oi[None, :, None]
            ok = (px <= hi[ss, 0][:, None, None]) & (py <= hi[ss, 1][:, None, None])
            cx, cy = px + 0.5, py + 0.5
            a, b, c = Tt[:, 0], Tt[:, 1], Tt[:, 2]

            def aresta(p, q, cx=cx, cy=cy):
                return ((q[:, 0] - p[:, 0])[:, None, None] * (cy - p[:, 1][:, None, None])
                        - (q[:, 1] - p[:, 1])[:, None, None] * (cx - p[:, 0][:, None, None]))

            w0, w1, w2 = aresta(b, c), aresta(c, a), aresta(a, b)
            area = w0 + w1 + w2
            dentro = ok & (((w0 <= 0) & (w1 <= 0) & (w2 <= 0)) | ((w0 >= 0) & (w1 >= 0) & (w2 >= 0))) & (area != 0)
            with np.errstate(divide="ignore", invalid="ignore"):
                l0, l1, l2 = w0 / area, w1 / area, w2 / area
                inv_z = l0 / a[:, 2][:, None, None] + l1 / b[:, 2][:, None, None] + l2 / c[:, 2][:, None, None]
            m = np.nonzero(dentro)
            pix_all.append(np.broadcast_to(py, dentro.shape)[m] * largura + np.broadcast_to(px, dentro.shape)[m])
            z_all.append(1.0 / inv_z[m])
            f_all.append(idx[ss][m[0]])
    face = np.full(largura * altura, -1, np.int32)
    prof = np.full(largura * altura, np.inf)
    if pix_all:
        pix = np.concatenate(pix_all)
        z = np.concatenate(z_all)
        fa = np.concatenate(f_all)
        o = np.lexsort((fa, z, pix))
        pix, z, fa = pix[o], z[o], fa[o]
        prim = np.ones(len(pix), bool)
        prim[1:] = pix[1:] != pix[:-1]
        face[pix[prim]] = fa[prim]
        prof[pix[prim]] = z[prim]
    face = face.reshape(altura, largura)
    if devolver_profundidade:
        return face, prof.reshape(altura, largura)
    return face


def baricentricas(S: np.ndarray, F: np.ndarray, face: np.ndarray):
    """Para os pixels cobertos: (linhas, colunas, faces, lambdas (n, 3) com correcao de perspectiva)."""
    jj, ii = np.nonzero(face >= 0)
    f = face[jj, ii]
    T = S[F[f]]
    cx, cy = ii + 0.5, jj + 0.5
    a, b, c = T[:, 0], T[:, 1], T[:, 2]

    def aresta(p, q):
        return (q[:, 0] - p[:, 0]) * (cy - p[:, 1]) - (q[:, 1] - p[:, 1]) * (cx - p[:, 0])

    w = np.stack([aresta(b, c), aresta(c, a), aresta(a, b)], 1)
    area = w.sum(1, keepdims=True)
    area[area == 0] = 1e-12
    lam = np.clip(w / area, 0.0, 1.0)  # bordas do pintor podem cair um pouco fora
    lam /= lam.sum(1, keepdims=True)
    lam = lam / T[:, :, 2]
    lam /= lam.sum(1, keepdims=True)
    return jj, ii, f, lam
