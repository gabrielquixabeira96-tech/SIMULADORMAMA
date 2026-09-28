"""Projecao da(s) foto(s) no atlas UV da malha reconstruida (plano foto3d, pacote P2; contrato C3).

Entrada: a malha do template ajustado (P1) com a UV cilindrica do gerador (`Grade.uv`), uma ou mais
fotos ja registradas (camera K, R, t do `reconstrucao/1.0`, C1) e, por foto, a mascara da silhueta
(segmentacao do P1). Saida: a cor projetada por texel do atlas e a confianca `observado` em [0, 1].
Nada e sintetizado: cada texel observado e uma re-amostragem bilinear da foto (sRGB); o que nenhuma
foto viu fica com `observado = 0` e e preenchido depois por `preencher.py` (textura procedural do
ADR 0020, cor casada), marcado como nao observado.

Convencao da camera (C1; a mesma do `camera.py` do P1 — conferir na integracao)
------------------------------------------------------------------------------
- `x_cam = R @ X + t` (X em mm no quadro da malha, `anatomico` para o template); camera "OpenCV":
  +z para a frente (pontos visiveis tem z > 0), +x para a direita da imagem, +y para baixo.
- Pixel: `u = fx * x/z + cx`, `v = fy * y/z + cy` (com `k1`: `x/z, y/z` multiplicados por
  `1 + k1 * r^2`), em coordenadas continuas com origem no **canto** superior esquerdo da imagem: o
  pixel (linha i, coluna j) cobre [j, j+1) x [i, i+1) e seu centro e (j + 0,5; i + 0,5). Ponto
  principal no centro da imagem = (W/2, H/2).
- Serializacao (C1): `K` e `R` com 9 numeros **coluna-major** (como `THREE.Matrix3.elements`),
  `t` com 3; `k1` opcional (0).

Algoritmo (por foto)
--------------------
1. **Texels na superficie**: a malha e rasterizada no espaco UV (atlas W x H; centro do texel (i, j)
   em u = (j + 0,5)/W, v = 1 - (i + 0,5)/H, como `textura_pele.coordenadas_texels`); cada texel coberto
   recebe o ponto 3D e a normal (suave, dos vertices) interpolados baricentricamente na face. So as
   faces voltadas para alguma camera entram (as outras teriam peso 0 de qualquer jeito).
2. **Visibilidade (z-buffer)**: a malha e rasterizada na camera da foto (resolucao da foto, profundidade
   com interpolacao perspectivamente correta, o mais proximo por pixel). Um texel e visivel se a sua
   profundidade nao passa a do z-buffer no pixel onde ele cai mais um vies de 0,5 mm + a inclinacao
   (1 px * mm/px * tan(theta)), para nao auto-ocluir superficies obliquas. Texel ocluso: peso 0.
3. **Peso de fusao** `w = cos(theta)^3 * feather * visivel`, theta = angulo entre a normal e a direcao
   ao centro da camera; `feather = min(1, d / 12 px)`, d = distancia (px) do pixel a borda da mascara
   (0 fora dela); fora da imagem, 0. Decide **qual** foto domina onde ha mais de uma.
4. **Confianca** `c = smoothstep(cos(theta) / cos(75 graus)) * feather * visivel`: a foto "viu" o texel
   (dentro da silhueta, sem oclusao, de frente para a camera); cai a 0 so na tangencia (75-90 graus),
   onde a foto esta esticada mais de 4x. E o que `observado` mede: "o que a foto cobriu".
5. **Cor**: amostragem bilinear da foto (sRGB 0..1) no pixel projetado.

Fusao de varias fotos: com mais de uma, cada foto k > 0 recebe 3 ganhos RGB (minimos quadrados, em
luz linear, nos texels vistos por ela e pela foto de referencia — a frontal, ou a primeira) antes da
media ponderada `sum(w_k g_k c_k) / sum(w_k)`; `observado = 1 - prod(1 - c_k)`. No MVP (so frontal) a
fusao e a identidade.

`cobertura_observada_pct` = 100 * fracao dos texels do atlas (W x H) com `observado >= 0,15`
(`LIMIAR_NAO_OBSERVADO`: abaixo disso o texel e "nao observado", preenchido e hachurado no web).
Uma camera frontal clinica (FOV vertical 15 graus, quadro da furcula + 40 mm ao sulco - 120 mm) ve no
maximo ~38 % do atlas cilindrico inteiro (metade anterior, sem a faixa abaixo do quadro).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from mesh.malha.geometria import normais_vertices, soldar
from mesh.simulacao.iluminacao import linear_para_srgb, srgb_para_linear

LIMIAR_NAO_OBSERVADO = 0.15    # observado < 0,15 -> preenchido proceduralmente (e hachurado no web)
EXPOENTE_COS = 3               # peso de fusao w ~ cos(theta)^3
COS_CONFIANCA = float(np.cos(np.radians(75.0)))  # confianca plena ate 75 graus de obliquidade
FEATHER_PX = 12.0              # rampa do peso a partir da borda da mascara
VIES_MM = 0.5                  # vies do teste de profundidade
TAN_MAX = np.tan(np.radians(80.0))
MAX_CANDIDATOS = 3_000_000     # elementos por bloco no rasterizador (memoria ~ 200 MB no pior caso)
VISTAS = ("frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq")
_RE_FOTO = re.compile(r"^original/foto_(frente|obliqua_dir|obliqua_esq|perfil_dir|perfil_esq)\.jpg$")


# ----------------------------------------------------------------------------- camera

@dataclass(frozen=True)
class Camera:
    """Camera pinhole do registro da foto (C1). `K`, `R` 3x3; `t` (3,) em mm; `k1` radial."""

    K: np.ndarray
    R: np.ndarray
    t: np.ndarray
    largura_px: int
    altura_px: int
    k1: float = 0.0

    @classmethod
    def de_contrato(cls, foto: dict) -> Camera:
        """Le um item de `reconstrucao.fotos` (C1): K[9], R[9] coluna-major, t[3], k1, largura/altura."""
        K = np.asarray(foto["K"], dtype=np.float64).reshape(3, 3, order="F")
        R = np.asarray(foto["R"], dtype=np.float64).reshape(3, 3, order="F")
        t = np.asarray(foto["t"], dtype=np.float64).reshape(3)
        if not np.allclose(R @ R.T, np.eye(3), atol=1e-6) or np.linalg.det(R) < 0:
            raise ValueError("R nao e rotacao propria")
        return cls(K=K, R=R, t=t, largura_px=int(foto["largura_px"]), altura_px=int(foto["altura_px"]),
                   k1=float(foto.get("k1") or 0.0))

    def para_contrato(self) -> dict:
        return {"K": [float(v) for v in self.K.reshape(-1, order="F")],
                "R": [float(v) for v in self.R.reshape(-1, order="F")],
                "t": [float(v) for v in self.t], "k1": float(self.k1),
                "largura_px": int(self.largura_px), "altura_px": int(self.altura_px)}

    @property
    def centro(self) -> np.ndarray:
        """Centro optico no quadro da malha: C = -R^T t."""
        return -self.R.T @ self.t

    def para_camera(self, X: np.ndarray) -> np.ndarray:
        return np.asarray(X, dtype=np.float64) @ self.R.T + self.t

    def projetar(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(n,3) -> (uv (n,2) em px continuos, profundidade z (n,) em mm). z <= 0: atras da camera."""
        Xc = self.para_camera(X)
        z = Xc[:, 2]
        zs = np.where(np.abs(z) < 1e-9, 1e-9, z)
        xn, yn = Xc[:, 0] / zs, Xc[:, 1] / zs
        if self.k1:
            f = 1.0 + self.k1 * (xn * xn + yn * yn)
            xn, yn = xn * f, yn * f
        K = self.K
        u = K[0, 0] * xn + K[0, 1] * yn + K[0, 2]
        v = K[1, 1] * yn + K[1, 2]
        return np.stack([u, v], axis=1), z

    def mm_por_px(self, z: np.ndarray) -> np.ndarray:
        return np.asarray(z) / float(0.5 * (self.K[0, 0] + self.K[1, 1]))


@dataclass
class FotoRegistrada:
    """Uma foto com o seu registro. `imagem`: PIL RGB ou array (H, W, 3) uint8; `mascara`: (H, W) bool
    da silhueta do torso (None = a silhueta da propria malha nessa camera)."""

    imagem: Image.Image | np.ndarray
    camera: Camera
    mascara: np.ndarray | None = None
    vista: str = "frente"

    def rgb(self) -> np.ndarray:
        arr = np.asarray(self.imagem.convert("RGB") if isinstance(self.imagem, Image.Image) else self.imagem)
        if arr.ndim != 3 or arr.shape[2] < 3:
            raise ValueError("foto precisa ser RGB")
        arr = arr[..., :3]
        if arr.shape[:2] != (self.camera.altura_px, self.camera.largura_px):
            raise ValueError(f"foto {arr.shape[1]}x{arr.shape[0]} difere do registro "
                             f"{self.camera.largura_px}x{self.camera.altura_px}")
        return arr


def ler_foto(malha_dir: Path, arquivo: str) -> Image.Image:
    """Unico ponto de leitura de imagem do P2: so `original/foto_<vista>.jpg` da propria malha (LGPD;
    criterio 6 do P2). Devolve RGB ja decodificado (sem EXIF: o web ja o descartou)."""
    if not _RE_FOTO.match(arquivo):
        raise ValueError(f"arquivo de foto fora da lista permitida: {arquivo!r}")
    base = Path(malha_dir).resolve()
    caminho = (base / arquivo).resolve()
    if base not in caminho.parents:
        raise ValueError("caminho escapa de malha_dir")
    with Image.open(caminho) as im:
        return im.convert("RGB")


def fotos_do_registro(malha_dir: Path, fotos_c1: list[dict],
                      mascaras: dict[str, np.ndarray] | None = None) -> list[FotoRegistrada]:
    """`reconstrucao.fotos` (C1) -> fotos registradas: le cada `arquivo` por `ler_foto` (so
    `original/foto_<vista>.jpg` da propria malha) e monta a `Camera`. `mascaras`: {vista: (H, W) bool}
    da segmentacao (ausente = a silhueta da propria malha)."""
    saida = []
    for f in fotos_c1:
        vista = f["vista"]
        if vista not in VISTAS:
            raise ValueError(f"vista desconhecida: {vista!r}")
        saida.append(FotoRegistrada(imagem=ler_foto(malha_dir, f["arquivo"]), camera=Camera.de_contrato(f),
                                    mascara=(mascaras or {}).get(vista), vista=vista))
    return saida


# ----------------------------------------------------------------------------- malha

@dataclass
class MalhaUV:
    V: np.ndarray        # (n,3) mm
    F: np.ndarray        # (m,3)
    uv: np.ndarray       # (n,2) convencao OBJ (v para cima)
    N: np.ndarray        # (n,3) normais suaves unitarias (calculadas na malha soldada)


def malha_uv(malha) -> MalhaUV:
    """Aceita `MalhaRender` (V, F, uv) ou `trimesh.Trimesh` com `visual.uv`."""
    if hasattr(malha, "vertices") and hasattr(malha, "faces"):  # trimesh
        V = np.asarray(malha.vertices, dtype=np.float64)
        F = np.asarray(malha.faces, dtype=np.int64)
        uv = getattr(getattr(malha, "visual", None), "uv", None)
    else:
        V, F, uv = np.asarray(malha.V, dtype=np.float64), np.asarray(malha.F, dtype=np.int64), malha.uv
    if uv is None or len(uv) != len(V):
        raise ValueError("malha sem UV por vertice (o atlas do template e obrigatorio)")
    Vw, Fw, mapa = soldar(V, F)
    N = normais_vertices(Vw, Fw)[mapa]
    return MalhaUV(V=V, F=F, uv=np.asarray(uv, dtype=np.float64), N=N)


# ----------------------------------------------------------------------------- rasterizacao

def _candidatos(xy: np.ndarray, F: np.ndarray, W: int, H: int, envolver_x: bool = False):
    """Gera, por blocos, os pares (pixel, face, baricentricas) com o centro do pixel dentro da face.

    `xy` (n,2) em px continuos (centro do pixel (i, j) = (j + 0,5; i + 0,5)). Com `envolver_x`, x e
    periodico (atlas: REPEAT em u) e o indice de coluna e tomado modulo W. Deterministico."""
    A, B, C = xy[F[:, 0]], xy[F[:, 1]], xy[F[:, 2]]
    d = (B[:, 0] - A[:, 0]) * (C[:, 1] - A[:, 1]) - (B[:, 1] - A[:, 1]) * (C[:, 0] - A[:, 0])
    lo = np.minimum(np.minimum(A, B), C)
    hi = np.maximum(np.maximum(A, B), C)
    x0 = np.ceil(lo[:, 0] - 0.5).astype(np.int64)
    x1 = np.floor(hi[:, 0] - 0.5).astype(np.int64)
    y0 = np.maximum(np.ceil(lo[:, 1] - 0.5).astype(np.int64), 0)
    y1 = np.minimum(np.floor(hi[:, 1] - 0.5).astype(np.int64), H - 1)
    if not envolver_x:
        x0, x1 = np.maximum(x0, 0), np.minimum(x1, W - 1)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    ok = (bw > 0) & (bh > 0) & (np.abs(d) > 1e-12) & np.all(np.isfinite(lo), axis=1) & np.all(np.isfinite(hi), axis=1)
    faces = np.nonzero(ok)[0]
    if len(faces) == 0:
        return
    chave = bw[faces] * 100003 + bh[faces]
    ordem = np.argsort(chave, kind="stable")
    faces, chave = faces[ordem], chave[ordem]
    cortes = np.nonzero(np.diff(chave))[0] + 1
    for grupo in np.split(faces, cortes):
        gw, gh = int(bw[grupo[0]]), int(bh[grupo[0]])
        oy, ox = np.divmod(np.arange(gw * gh), gw)
        passo = max(1, MAX_CANDIDATOS // (gw * gh))
        for k in range(0, len(grupo), passo):
            g = grupo[k:k + passo]
            px = x0[g, None] + ox[None, :]
            py = y0[g, None] + oy[None, :]
            cx, cy = px + 0.5, py + 0.5
            a, b, c, dd = A[g], B[g], C[g], d[g][:, None]
            l1 = ((cx - a[:, 0:1]) * (c[:, 1:2] - a[:, 1:2]) - (cy - a[:, 1:2]) * (c[:, 0:1] - a[:, 0:1])) / dd
            l2 = ((b[:, 0:1] - a[:, 0:1]) * (cy - a[:, 1:2]) - (b[:, 1:2] - a[:, 1:2]) * (cx - a[:, 0:1])) / dd
            l0 = 1.0 - l1 - l2
            dentro = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
            if not dentro.any():
                continue
            fi, oi = np.nonzero(dentro)
            pxs = px[fi, oi] % W if envolver_x else px[fi, oi]
            yield (py[fi, oi] * W + pxs, g[fi], np.stack([l0[fi, oi], l1[fi, oi], l2[fi, oi]], axis=1))


def _juntar(gerador) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    pix, fac, bar = [], [], []
    for p, f, b in gerador:
        pix.append(p)
        fac.append(f)
        bar.append(b)
    if not pix:
        return np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros((0, 3))
    return np.concatenate(pix), np.concatenate(fac), np.concatenate(bar)


def texels_na_superficie(m: MalhaUV, W: int, H: int, faces: np.ndarray | None = None):
    """Rasteriza a malha no atlas W x H. Devolve (indice plano do texel (k,), ponto 3D (k,3), normal
    unitaria (k,3)); cada texel coberto aparece uma vez (na aresta comum, a face de menor indice)."""
    F = m.F if faces is None else m.F[faces]
    xy = np.stack([m.uv[:, 0] * W, (1.0 - m.uv[:, 1]) * H], axis=1)
    span = xy[F, 0].max(axis=1) - xy[F, 0].min(axis=1)
    F = F[span < 0.5 * W]  # faces que atravessariam a costura do atlas (nao ha no gerador)
    pix, fac, bar = _juntar(_candidatos(xy, F, W, H, envolver_x=True))
    ordem = np.lexsort((fac, pix))
    pix, fac, bar = pix[ordem], fac[ordem], bar[ordem]
    primeiro = np.ones(len(pix), bool)
    primeiro[1:] = pix[1:] != pix[:-1]
    pix, fac, bar = pix[primeiro], fac[primeiro], bar[primeiro]
    tri = F[fac]
    P = np.einsum("kj,kjc->kc", bar, m.V[tri])
    N = np.einsum("kj,kjc->kc", bar, m.N[tri])
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    return pix, P, N


def mapa_profundidade(m: MalhaUV, camera: Camera, faces: np.ndarray | None = None) -> np.ndarray:
    """Z-buffer (altura_px, largura_px) em mm (inf onde nao ha malha), profundidade perspectivamente
    correta no centro de cada pixel; a face mais proxima vence. Faces de costas tambem entram (ocluem)."""
    W, H = camera.largura_px, camera.altura_px
    F = m.F if faces is None else m.F[faces]
    uv, z = camera.projetar(m.V)
    F = F[np.all(z[F] > 1e-3, axis=1)]
    pix, fac, bar = _juntar(_candidatos(uv, F, W, H))
    zinv = np.einsum("kj,kj->k", bar, 1.0 / z[F[fac]])
    prof = 1.0 / zinv
    zbuf = np.full(W * H, np.inf)
    np.minimum.at(zbuf, pix, prof)
    return zbuf.reshape(H, W)


def _amostrar_bilinear(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """img (H, W, C); (u, v) em px continuos (centro do pixel em +0,5). Bilinear, borda: clamp."""
    H, W = img.shape[:2]
    coords = np.stack([np.clip(v - 0.5, 0.0, H - 1.0), np.clip(u - 0.5, 0.0, W - 1.0)])
    return np.stack([ndimage.map_coordinates(img[..., k], coords, order=1, mode="nearest")
                     for k in range(img.shape[2])], axis=1)


# ----------------------------------------------------------------------------- projecao

@dataclass
class ProjecaoAtlas:
    """Resultado da projecao: `cor` (H, W, 3) float32 sRGB 0..1 (0 onde nao observado), `observado`
    (H, W) float32 em [0, 1], `cobertura_observada_pct`, estatisticas por foto e avisos."""

    cor: np.ndarray
    observado: np.ndarray
    cobertura_observada_pct: float
    por_foto: list[dict] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)

    @property
    def tamanho(self) -> tuple[int, int]:
        return int(self.observado.shape[1]), int(self.observado.shape[0])


def pesos_da_foto(m: MalhaUV, P: np.ndarray, N: np.ndarray, foto: FotoRegistrada,
                  zbuf: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """Peso de fusao w (k,), confianca c (k,) e cor sRGB (k,3) de cada ponto (P, N) nesta foto."""
    cam = foto.camera
    W, H = cam.largura_px, cam.altura_px
    uv, z = cam.projetar(P)
    vdir = cam.centro[None, :] - P
    vdir /= np.maximum(np.linalg.norm(vdir, axis=1, keepdims=True), 1e-12)
    cos = np.einsum("kc,kc->k", N, vdir)
    dentro = (z > 1e-3) & (uv[:, 0] >= 0) & (uv[:, 0] < W) & (uv[:, 1] >= 0) & (uv[:, 1] < H) & (cos > 0)
    w = np.zeros(len(P))
    conf = np.zeros(len(P))
    cor = np.zeros((len(P), 3))
    info = {"vista": foto.vista, "texels_na_imagem": int(dentro.sum())}
    idx = np.nonzero(dentro)[0]
    if len(idx) == 0:
        info.update(texels_visiveis=0, texels_oclusos=0)
        return w, conf, cor, info
    if zbuf is None:
        zbuf = mapa_profundidade(m, cam)
    j = np.floor(uv[idx, 0]).astype(np.int64)
    i = np.floor(uv[idx, 1]).astype(np.int64)
    c = cos[idx]
    tan = np.minimum(np.sqrt(np.maximum(1.0 - c * c, 0.0)) / np.maximum(c, 1e-6), TAN_MAX)
    vies = VIES_MM + cam.mm_por_px(z[idx]) * tan
    visivel = z[idx] <= zbuf[i, j] + vies
    info["texels_visiveis"] = int(visivel.sum())
    info["texels_oclusos"] = int((~visivel).sum())
    mascara = foto.mascara if foto.mascara is not None else np.isfinite(zbuf)
    mascara = np.asarray(mascara, dtype=bool)
    if mascara.shape != (H, W):
        raise ValueError("mascara com tamanho diferente da foto")
    dist = ndimage.distance_transform_edt(mascara)
    feather = np.clip(dist[i, j] / FEATHER_PX, 0.0, 1.0)
    base = feather * visivel
    w[idx] = np.power(c, EXPOENTE_COS) * base
    t = np.clip(c / COS_CONFIANCA, 0.0, 1.0)
    conf[idx] = t * t * (3.0 - 2.0 * t) * base
    ativos = idx[w[idx] > 0]
    rgb = foto.rgb().astype(np.float32) / np.float32(255.0)
    cor[ativos] = _amostrar_bilinear(rgb, uv[ativos, 0], uv[ativos, 1])
    return w, conf, cor, info


def _ganhos(ref_w, ref_cor, w, cor) -> np.ndarray:
    """3 ganhos RGB (luz linear) que levam `cor` a `ref_cor` nos texels vistos pelas duas fotos."""
    s = np.minimum(ref_w, w)
    ok = s > 0.05
    if ok.sum() < 200:
        return np.ones(3)
    a = srgb_para_linear(ref_cor[ok])
    b = srgb_para_linear(cor[ok])
    sw = s[ok][:, None]
    g = np.sum(sw * a * b, axis=0) / np.maximum(np.sum(sw * b * b, axis=0), 1e-12)
    return np.clip(g, 0.5, 2.0)


def projetar_fotos(malha, fotos: list[FotoRegistrada], tamanho_atlas: tuple[int, int]) -> ProjecaoAtlas:
    """Projeta as fotos no atlas (largura, altura) da malha (C3: o da textura do template, 4 px/mm).

    `malha`: `MalhaRender`/`trimesh.Trimesh` com UV do atlas, ou um `MalhaUV` pronto."""
    if not fotos:
        raise ValueError("nenhuma foto")
    m = malha if isinstance(malha, MalhaUV) else malha_uv(malha)
    W, H = int(tamanho_atlas[0]), int(tamanho_atlas[1])
    # faces voltadas para alguma camera (as demais tem cos <= 0 em todo ponto)
    Fn = np.cross(m.V[m.F[:, 1]] - m.V[m.F[:, 0]], m.V[m.F[:, 2]] - m.V[m.F[:, 0]])
    centro_f = m.V[m.F].mean(axis=1)
    frente = np.zeros(len(m.F), bool)
    for f in fotos:
        frente |= np.einsum("kc,kc->k", Fn, f.camera.centro[None, :] - centro_f) > 0
    # margem de 1 anel: um texel de face de costas pode ter normal suave de frente
    vizinhas = np.zeros(len(m.V), bool)
    vizinhas[m.F[frente].reshape(-1)] = True
    faces = np.nonzero(frente | vizinhas[m.F].any(axis=1))[0]
    pix, P, N = texels_na_superficie(m, W, H, faces)

    ws, confs, cores, infos = [], [], [], []
    for f in fotos:
        w, conf, c, info = pesos_da_foto(m, P, N, f)
        ws.append(w)
        confs.append(conf)
        cores.append(c)
        infos.append(info)
    ref = next((k for k, f in enumerate(fotos) if f.vista == "frente"), 0)
    soma_w = np.zeros(len(P))
    soma_c = np.zeros((len(P), 3))
    resto = np.ones(len(P))
    for k in range(len(fotos)):
        g = np.ones(3) if k == ref else _ganhos(ws[ref], cores[ref], ws[k], cores[k])
        infos[k]["ganhos_rgb"] = [round(float(v), 4) for v in g]
        c = cores[k] if k == ref else linear_para_srgb(srgb_para_linear(cores[k]) * g[None, :])
        soma_w += ws[k]
        soma_c += ws[k][:, None] * c
        resto *= 1.0 - confs[k]
    cor_t = np.where(soma_w[:, None] > 0, soma_c / np.maximum(soma_w, 1e-12)[:, None], 0.0)
    cor = np.zeros((H * W, 3), np.float32)
    obs = np.zeros(H * W, np.float32)
    cor[pix] = cor_t
    obs[pix] = np.clip(1.0 - resto, 0.0, 1.0)
    cobertura = 100.0 * float(np.count_nonzero(obs >= LIMIAR_NAO_OBSERVADO)) / (W * H)
    for info, conf in zip(infos, confs, strict=True):
        info["cobertura_pct"] = round(100.0 * float(np.count_nonzero(conf >= LIMIAR_NAO_OBSERVADO)) / (W * H), 2)
    return ProjecaoAtlas(cor=cor.reshape(H, W, 3), observado=obs.reshape(H, W),
                         cobertura_observada_pct=round(cobertura, 2), por_foto=infos)
