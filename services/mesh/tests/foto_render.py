"""Oraculo minimo de teste para o P2 (projecao da foto): camera clinica, render texturizado e SSIM.

Escrito de proposito de forma independente do rasterizador de `mesh.foto.projetar` (laco por face,
z-buffer explicito), para que a ida e volta foto -> atlas -> re-render nao valide o codigo contra ele
mesmo. Tudo em memoria: nenhuma imagem e gravada nem lida de disco (as "fotos" sao renders do torso
sintetico, restricao 2). Quando o `raster.py` do P1 existir, ele pode substituir `renderizar`.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image
from scipy import ndimage

from mesh.foto.projetar import Camera

FOV_CLINICO_GRAUS = 15.0          # apps/web/src/simulacao/cameraClinica.ts
ASPECTO = 4.0 / 3.0
MARGEM_ACIMA_FURCULA_MM = 40.0
MARGEM_ABAIXO_SULCO_MM = 120.0
OCUPACAO = 0.96
GIRO = {"frente": 0.0, "obliqua_dir": 45.0, "obliqua_esq": -45.0, "perfil_dir": 90.0, "perfil_esq": -90.0}
FUNDO = (0x8A, 0x8F, 0x96)


def camera_clinica(landmarks: dict, vista: str = "frente", largura_px: int = 2000) -> Camera:
    """A camera clinica do web (FOV vertical 15 graus, 4:3, mesma distancia nas 5 vistas), para um torso
    no quadro anatomico, como `Camera` no formato C1 (OpenCV, px com centro em +0,5)."""
    p = {k: np.asarray(v["posicao"] if isinstance(v, dict) else v, dtype=float) for k, v in landmarks.items()}
    x, y, z = np.eye(3)
    centro = 0.5 * (p["mamilo_dir"] + p["mamilo_esq"])
    sulco = min(p["sulco_dir"], p["sulco_esq"], key=lambda s: s @ y)
    limites = [p["furcula"] + MARGEM_ACIMA_FURCULA_MM * y, sulco - MARGEM_ABAIXO_SULCO_MM * y]
    tan_meio = np.tan(np.radians(FOV_CLINICO_GRAUS / 2)) * OCUPACAO

    def direcao(v):
        t = np.radians(GIRO[v])
        return -np.sin(t) * x + np.cos(t) * z

    dist = 300.0
    for v in GIRO:
        for q in limites:
            a = q - centro
            dist = max(dist, abs(a @ y) / tan_meio + a @ direcao(v))
    d = direcao(vista)
    pos = centro + dist * d
    zc = -d
    yc = -y
    xc = np.cross(yc, zc)
    R = np.stack([xc, yc, zc])
    H = int(round(largura_px / ASPECTO))
    f = (H / 2.0) / np.tan(np.radians(FOV_CLINICO_GRAUS / 2))
    K = np.array([[f, 0, largura_px / 2.0], [0, f, H / 2.0], [0, 0, 1.0]])
    return Camera(K=K, R=R, t=-R @ pos, largura_px=largura_px, altura_px=H)


def rasterizar_por_face(V: np.ndarray, F: np.ndarray, cam: Camera):
    """Z-buffer por laco de faces. Devolve (face (H, W) int, -1 = fundo; baricentricas perspectivamente
    corretas (H, W, 3); profundidade (H, W), inf = fundo)."""
    W, H = cam.largura_px, cam.altura_px
    uv, z = cam.projetar(V)
    face = np.full((H, W), -1, np.int64)
    bar = np.zeros((H, W, 3))
    prof = np.full((H, W), np.inf)
    for k, (a, b, c) in enumerate(F):
        if min(z[a], z[b], z[c]) <= 1e-3:
            continue
        pa, pb, pc = uv[a], uv[b], uv[c]
        area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
        if abs(area) < 1e-12:
            continue
        xs = (pa[0], pb[0], pc[0])
        ys = (pa[1], pb[1], pc[1])
        j0, j1 = max(int(np.ceil(min(xs) - 0.5)), 0), min(int(np.floor(max(xs) - 0.5)), W - 1)
        i0, i1 = max(int(np.ceil(min(ys) - 0.5)), 0), min(int(np.floor(max(ys) - 0.5)), H - 1)
        if j1 < j0 or i1 < i0:
            continue
        gx, gy = np.meshgrid(np.arange(j0, j1 + 1) + 0.5, np.arange(i0, i1 + 1) + 0.5)
        w0 = ((pb[0] - gx) * (pc[1] - gy) - (pb[1] - gy) * (pc[0] - gx)) / area
        w1 = ((pc[0] - gx) * (pa[1] - gy) - (pc[1] - gy) * (pa[0] - gx)) / area
        w2 = 1.0 - w0 - w1
        dentro = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
        if not dentro.any():
            continue
        q0, q1, q2 = w0 / z[a], w1 / z[b], w2 / z[c]
        s = q0 + q1 + q2
        zz = 1.0 / s
        janela = prof[i0:i1 + 1, j0:j1 + 1]
        ganha = dentro & (zz < janela)
        if not ganha.any():
            continue
        janela[ganha] = zz[ganha]
        face[i0:i1 + 1, j0:j1 + 1][ganha] = k
        bar[i0:i1 + 1, j0:j1 + 1][ganha] = np.stack([q0 / s, q1 / s, q2 / s], -1)[ganha]
    return face, bar, prof


def amostrar_atlas(atlas: np.ndarray, uvs: np.ndarray) -> np.ndarray:
    """Bilinear no atlas (H, W, C) float, REPEAT em u e CLAMP em v (sampler do .glb)."""
    H, W = atlas.shape[:2]
    x = np.mod(uvs[:, 0], 1.0) * W - 0.5
    y = np.clip((1.0 - uvs[:, 1]) * H - 0.5, 0.0, H - 1.0)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    x1, y1 = (x0 + 1) % W, np.minimum(y0 + 1, H - 1)
    x0 %= W
    a = atlas.reshape(H, W, -1)
    topo = a[y0, x0] * (1 - fx) + a[y0, x1] * fx
    base = a[y1, x0] * (1 - fx) + a[y1, x1] * fx
    return topo * (1 - fy) + base * fy


def renderizar(V, F, uv, atlas: np.ndarray, cam: Camera, raster=None, fundo=FUNDO):
    """Render sem luz (a luz ja esta assada no atlas), fundo cinza neutro. `atlas` (H, W, C) float
    0..1 (ou 0..255). Devolve (imagem (H, W, C) float, mascara da silhueta, uv por pixel (H, W, 2))."""
    face, bar, _ = raster if raster is not None else rasterizar_por_face(V, F, cam)
    msk = face >= 0
    uvp = np.zeros(face.shape + (2,))
    uvp[msk] = np.einsum("kj,kjc->kc", bar[msk], uv[F[face[msk]]])
    C = atlas.shape[2] if atlas.ndim == 3 else 1
    img = np.empty(face.shape + (C,))
    img[:] = np.asarray(fundo[:C], dtype=float) / (255.0 if atlas.max() <= 1.0 else 1.0)
    img[msk] = amostrar_atlas(atlas.reshape(atlas.shape[0], atlas.shape[1], C), uvp[msk])
    return img, msk, uvp


def jpeg_em_memoria(rgb8: np.ndarray, qualidade: int = 92) -> np.ndarray:
    """Ida e volta JPEG so em memoria (a foto real chega como JPEG q=0,92 do canvas do web)."""
    buf = io.BytesIO()
    Image.fromarray(rgb8).save(buf, format="JPEG", quality=qualidade)
    buf.seek(0)
    with Image.open(buf) as im:
        return np.asarray(im.convert("RGB"))


def ssim(a: np.ndarray, b: np.ndarray, regiao: np.ndarray | None = None, sigma: float = 1.5) -> float:
    """SSIM (Wang et al. 2004) em numpy/scipy: janela gaussiana sigma 1,5, C1 = (0,01 L)^2,
    C2 = (0,03 L)^2, L = 255; em imagens RGB, media dos canais; media do mapa na `regiao`."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    if a.ndim == 2:
        a, b = a[..., None], b[..., None]
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mapas = []
    for k in range(a.shape[2]):
        x, y = a[..., k], b[..., k]
        mx, my = ndimage.gaussian_filter(x, sigma), ndimage.gaussian_filter(y, sigma)
        sxx = ndimage.gaussian_filter(x * x, sigma) - mx * mx
        syy = ndimage.gaussian_filter(y * y, sigma) - my * my
        sxy = ndimage.gaussian_filter(x * y, sigma) - mx * my
        mapas.append(((2 * mx * my + C1) * (2 * sxy + C2)) / ((mx * mx + my * my + C1) * (sxx + syy + C2)))
    mapa = np.mean(mapas, axis=0)
    return float(mapa[regiao].mean() if regiao is not None else mapa.mean())
