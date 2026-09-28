"""Camera pinhole, projecao e PnP (pose a partir de pontos 2D-3D com K conhecido).

Convencao OpenCV (ver mesh/foto/__init__.py): x_cam = R X + t, u = fx x/z + cx, v = fy y/z + cy, com
distorcao radial opcional de 1 termo (k1) aplicada nas coordenadas normalizadas.

- `matriz_k`: f em px a partir da focal equivalente 35 mm, f_px = max(W, H) * f35 / 36 (36 mm e o lado
  maior do quadro de 35 mm; em foto retrato o lado maior e a altura); ponto principal no centro.
  Recusa lente < 20 mm equivalente (`lente_grande_angular`: distorcao e perspectiva fortes demais).
- `resolver_pnp`: DLT com K conhecido (>= 6 pontos) + candidatos orbitais das vistas clinicas
  (frente, oblíquas 45 graus, perfis 90 graus), cada um refinado por `least_squares(loss="soft_l1")` em
  (rotvec, t); fica o de menor custo. Menos de 6 pontos -> `landmarks_2d_incompletos`; pontos 2D
  colineares ou 3D degenerados -> `pontos_colineares`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

FOCAL_35MM_MINIMA = 20.0
GIROS_VISTAS = {"frente": 0.0, "obliqua_dir": 45.0, "obliqua_esq": -45.0, "perfil_dir": 90.0, "perfil_esq": -90.0}


class ErroCamera(ValueError):
    def __init__(self, codigo: str, mensagem: str):
        super().__init__(f"{codigo}: {mensagem}")
        self.codigo = codigo
        self.mensagem = mensagem


def matriz_k(largura_px: int, altura_px: int, focal_35mm: float) -> np.ndarray:
    if not np.isfinite(focal_35mm) or focal_35mm < FOCAL_35MM_MINIMA:
        raise ErroCamera("lente_grande_angular", f"focal equivalente {focal_35mm} mm < {FOCAL_35MM_MINIMA} mm")
    f = max(largura_px, altura_px) * float(focal_35mm) / 36.0
    return np.array([[f, 0.0, largura_px / 2.0], [0.0, f, altura_px / 2.0], [0.0, 0.0, 1.0]])


def focal_35mm_de_k(K: np.ndarray, largura_px: int, altura_px: int) -> float:
    return float(K[0, 0]) * 36.0 / max(largura_px, altura_px)


def coluna_major(M: np.ndarray) -> list[float]:
    """Matriz -> lista coluna-major (como THREE.Matrix3/4.elements)."""
    return [float(v) for v in np.asarray(M, dtype=np.float64).T.reshape(-1)]


def de_coluna_major(v, n: int = 3) -> np.ndarray:
    return np.asarray(v, dtype=np.float64).reshape(n, n).T


def para_camera(P: np.ndarray, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    return np.asarray(P, dtype=np.float64) @ R.T + t


def projetar(P: np.ndarray, K: np.ndarray, R: np.ndarray, t: np.ndarray, k1: float = 0.0) -> np.ndarray:
    """Pontos 3D (..., 3) do mundo -> pixels (..., 2)."""
    Xc = para_camera(P, R, t)
    z = Xc[..., 2]
    xn, yn = Xc[..., 0] / z, Xc[..., 1] / z
    if k1:
        d = 1.0 + k1 * (xn * xn + yn * yn)
        xn, yn = xn * d, yn * d
    return np.stack([K[0, 0] * xn + K[0, 2], K[1, 1] * yn + K[1, 2]], axis=-1)


def centro_da_camera(R: np.ndarray, t: np.ndarray) -> np.ndarray:
    return -R.T @ t


def olhar_para(posicao, alvo, up=(0.0, 1.0, 0.0)) -> tuple[np.ndarray, np.ndarray]:
    """(R, t) OpenCV de uma camera em `posicao` olhando para `alvo` com `up` para cima na imagem."""
    posicao, alvo, up = (np.asarray(v, dtype=np.float64) for v in (posicao, alvo, up))
    f = alvo - posicao
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    R = np.stack([r, d, f])
    return R, -R @ posicao


def angulo_entre_rotacoes_graus(R1: np.ndarray, R2: np.ndarray) -> float:
    c = (np.trace(R1.T @ R2) - 1.0) / 2.0
    return float(np.degrees(np.arccos(np.clip(c, -1.0, 1.0))))


@dataclass
class ResultadoPnP:
    R: np.ndarray
    t: np.ndarray
    residuos_px: np.ndarray     # (n,) norma do erro de reprojecao por ponto
    rms_px: float
    custo: float


def _checar_degenerado(X: np.ndarray, uv: np.ndarray) -> None:
    uvc = uv - uv.mean(0)
    s2 = np.linalg.svd(uvc, compute_uv=False)
    if s2[0] < 1e-9 or s2[1] / s2[0] < 0.02:
        raise ErroCamera("pontos_colineares", "pontos 2D (quase) colineares")
    s3 = np.linalg.svd(X - X.mean(0), compute_uv=False)
    if s3[0] < 1e-9 or s3[1] / s3[0] < 0.02:
        raise ErroCamera("pontos_colineares", "pontos 3D (quase) colineares")


def dlt(X: np.ndarray, uv: np.ndarray, K: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """DLT em coordenadas normalizadas (K conhecido). None se degenerado."""
    n = len(X)
    if n < 6:
        return None
    xn = (np.linalg.inv(K) @ np.column_stack([uv, np.ones(n)]).T).T
    c = X.mean(0)
    s = np.sqrt(((X - c) ** 2).sum(1).mean())
    Xs = np.column_stack([(X - c) / s, np.ones(n)])
    A = np.zeros((2 * n, 12))
    A[0::2, 0:4] = Xs
    A[0::2, 8:12] = -xn[:, [0]] * Xs
    A[1::2, 4:8] = Xs
    A[1::2, 8:12] = -xn[:, [1]] * Xs
    _, S, Vt = np.linalg.svd(A)
    Pm = Vt[-1].reshape(3, 4)
    Ap = Pm[:, :3] / s
    bp = Pm[:, 3] - Ap @ c
    if np.mean((X @ Ap.T + bp)[:, 2]) < 0:
        Ap, bp = -Ap, -bp
    U, Sv, Vt2 = np.linalg.svd(Ap)
    if Sv.mean() < 1e-12:
        return None
    R = U @ Vt2
    if np.linalg.det(R) < 0:
        return None
    t = bp / Sv.mean()
    return R, t


def _residuos(x, X, uv, K, k1):
    R = Rotation.from_rotvec(x[:3]).as_matrix()
    return (projetar(X, K, R, x[3:6], k1) - uv).reshape(-1)


def refinar(X, uv, K, R0, t0, k1: float = 0.0, loss: str = "soft_l1", f_scale: float = 3.0) -> ResultadoPnP:
    x0 = np.concatenate([Rotation.from_matrix(R0).as_rotvec(), t0])
    r = least_squares(_residuos, x0, args=(X, uv, K, k1), loss=loss, f_scale=f_scale, method="trf",
                      x_scale=np.array([0.01, 0.01, 0.01, 5.0, 5.0, 20.0]), max_nfev=400)
    R = Rotation.from_rotvec(r.x[:3]).as_matrix()
    t = r.x[3:6]
    e = (projetar(X, K, R, t, k1) - uv)
    res = np.linalg.norm(e, axis=1)
    return ResultadoPnP(R=R, t=t, residuos_px=res, rms_px=float(np.sqrt((res ** 2).mean())), custo=float(r.cost))


def candidatos_orbitais(X: np.ndarray, uv: np.ndarray, K: np.ndarray, giros_graus=None):
    """Poses iniciais: camera orbitando o centroide 3D no plano horizontal (giro da paciente como em
    cameraClinica.ts), distancia pela razao entre as dispersoes 3D e 2D."""
    c = X.mean(0)
    d3 = np.sqrt(((X - c) ** 2).sum(1).mean())
    d2 = np.sqrt(((uv - uv.mean(0)) ** 2).sum(1).mean())
    dist = K[0, 0] * d3 / max(d2, 1e-6)
    giros = GIROS_VISTAS.values() if giros_graus is None else giros_graus
    for g in giros:
        a = np.radians(g)
        direcao = np.array([-np.sin(a), 0.0, np.cos(a)])
        yield olhar_para(c + dist * direcao, c)


def resolver_pnp(X, uv, K, k1: float = 0.0, minimo: int = 6, giros_graus=None) -> ResultadoPnP:
    X = np.asarray(X, dtype=np.float64)
    uv = np.asarray(uv, dtype=np.float64)
    if len(X) != len(uv):
        raise ValueError("X e uv com tamanhos diferentes")
    if len(X) < minimo:
        raise ErroCamera("landmarks_2d_incompletos", f"{len(X)} pontos; minimo {minimo}")
    _checar_degenerado(X, uv)
    iniciais = list(candidatos_orbitais(X, uv, K, giros_graus))
    d = dlt(X, uv, K)
    if d is not None:
        iniciais.insert(0, d)
    melhor = None
    for R0, t0 in iniciais:
        if np.mean(para_camera(X, R0, t0)[:, 2]) <= 0:
            continue
        r = refinar(X, uv, K, R0, t0, k1)
        if np.min(para_camera(X, r.R, r.t)[:, 2]) <= 0:
            continue
        if melhor is None or r.custo < melhor.custo - 1e-9:
            melhor = r
    if melhor is None:
        raise ErroCamera("registro_ruim", "nenhuma pose com os pontos a frente da camera")
    return melhor
