"""Fotos sinteticas de um torso sintetico (dados de teste e "fotos de exemplo" da demo).

`foto_sintetica(pasta_torso, vista)` renderiza `torso.obj` + `textura.png` (a textura fotografica do
ADR 0020, com a luz ja assada: nada de luz somada) pela camera clinica do web (`cameraClinica.ts`:
FOV vertical 15 graus, 4:3, mirando o ponto medio dos mamilos, mesma distancia nas 5 vistas), sobre um
fundo cinza neutro `#8a8f96` com gradiente leve, e grava em `<pasta_torso>/fotos/`:

- `foto_<vista>.jpg` — JPEG q = 92, sem EXIF; recortada no topo 15 mm acima da furcula (simula o
  recorte do rosto que o navegador faz: a furcula fica a poucos % do topo);
- `mascara_<vista>.png` — mascara exata (L, 255 = torso) da mesma imagem;
- `registro_<vista>.json` — K, R, t exatos (coluna-major, convencao OpenCV), focal 35 mm equivalente,
  landmarks 2D exatos (projecao das posicoes do gabarito) e quais estao visiveis (z-buffer).

Deterministica: mesma entrada -> mesmos bytes (sem relogio, sem aleatoriedade fora da semente).
Nada disto e versionado: vai para `data/` (gitignored) ou para diretorios temporarios dos testes.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

from mesh.foto import raster
from mesh.foto.camera import coluna_major, focal_35mm_de_k, olhar_para, para_camera, projetar
from mesh.malha.io import ler_malha

VISTAS = ("frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq")
GIRO_PACIENTE_GRAUS = {"frente": 0.0, "obliqua_dir": 45.0, "obliqua_esq": -45.0, "perfil_dir": 90.0,
                       "perfil_esq": -90.0}
FOV_CLINICO_GRAUS = 15.0
MARGEM_ACIMA_FURCULA_MM = 40.0
MARGEM_ABAIXO_SULCO_MM = 120.0
OCUPACAO = 0.96
RECORTE_ACIMA_FURCULA_MM = 15.0
FUNDO_RGB = (0x8A, 0x8F, 0x96)
QUALIDADE_JPEG = 92
TOL_VISIVEL_MM = 2.0


def _norm(v):
    return v / np.linalg.norm(v)


def quadro_anatomico(lm: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Eixos x, y, z do quadro anatomico (contratos §1.1) a partir das posicoes dos landmarks."""
    y0 = _norm(lm["furcula"] - lm["linha_media_inferior"])
    x0 = _norm(lm["mamilo_esq"] - lm["mamilo_dir"])
    z = _norm(np.cross(x0, y0))
    return np.cross(y0, z), y0, z


def cameras_clinicas(lm: dict, largura: int = 2000, altura: int = 1500) -> dict[str, tuple]:
    """Porte de `camerasClinicas` (apps/web/src/simulacao/cameraClinica.ts) com landmarks:
    vista -> (K, R, t) OpenCV para uma imagem `largura` x `altura`."""
    x, y, z = quadro_anatomico(lm)
    centro = 0.5 * (lm["mamilo_dir"] + lm["mamilo_esq"])
    sd, se = lm["sulco_dir"], lm["sulco_esq"]
    sulco = sd if np.dot(sd - centro, y) <= np.dot(se - centro, y) else se
    limites = [lm["furcula"] + MARGEM_ACIMA_FURCULA_MM * y, sulco - MARGEM_ABAIXO_SULCO_MM * y]
    tan_meio = np.tan(np.radians(FOV_CLINICO_GRAUS / 2)) * OCUPACAO
    dist = 300.0
    dirs = {}
    for v in VISTAS:
        a = np.radians(GIRO_PACIENTE_GRAUS[v])
        d = -np.sin(a) * x + np.cos(a) * z
        dirs[v] = d
        for p in limites:
            q = p - centro
            dist = max(dist, abs(np.dot(q, y)) / tan_meio + np.dot(q, d))
    f = (altura / 2.0) / np.tan(np.radians(FOV_CLINICO_GRAUS / 2))
    K = np.array([[f, 0.0, largura / 2.0], [0.0, f, altura / 2.0], [0.0, 0.0, 1.0]])
    out = {}
    for v in VISTAS:
        R, t = olhar_para(centro + dist * dirs[v], centro, up=y)
        out[v] = (K.copy(), R, t)
    return out


def _amostrar_textura(tex: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Bilinear, periodica em u (costura nas costas), UV com origem embaixo a esquerda."""
    Ht, Wt = tex.shape[:2]
    x = uv[:, 0] * Wt - 0.5
    yy = (1.0 - uv[:, 1]) * Ht - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(yy).astype(np.int64)
    fx, fy = (x - x0)[:, None], (yy - y0)[:, None]
    xa, xb = x0 % Wt, (x0 + 1) % Wt
    ya, yb = np.clip(y0, 0, Ht - 1), np.clip(y0 + 1, 0, Ht - 1)
    t = tex.astype(np.float32)
    return ((t[ya, xa] * (1 - fx) + t[ya, xb] * fx) * (1 - fy) + (t[yb, xa] * (1 - fx) + t[yb, xb] * fx) * fy)


def _fundo(largura: int, altura: int, semente: int) -> np.ndarray:
    base = np.array(FUNDO_RGB, np.float32)
    grad = np.linspace(6.0, -6.0, altura, dtype=np.float32)[:, None, None]  # mais claro no alto
    lat = (np.linspace(-1.0, 1.0, largura, dtype=np.float32) ** 2)[None, :, None] * -3.0  # vinheta leve
    img = base[None, None, :] + grad + lat
    rng = np.random.default_rng([int(semente), 3])
    return img + rng.normal(0.0, 1.2, img.shape).astype(np.float32)  # ruido de sensor leve


def renderizar(malha, textura: np.ndarray, K, R, t, largura: int, altura: int, semente: int = 0):
    """(imagem RGB uint8 (H, W, 3), mascara bool, face por pixel, profundidade por pixel)."""
    S = raster.tela(malha.V, K, R, t)
    face = raster.pintor(S, malha.F, largura, altura)
    img = _fundo(largura, altura, semente)
    jj, ii, f, lam = raster.baricentricas(S, malha.F, face)
    uv = (malha.uv[malha.F[f]] * lam[:, :, None]).sum(1)
    img[jj, ii] = _amostrar_textura(textura, uv)
    prof = np.full((altura, largura), np.inf)
    prof[jj, ii] = 1.0 / (lam / S[malha.F[f], 2]).sum(1)
    return np.clip(np.rint(img), 0, 255).astype(np.uint8), face >= 0, face, prof


def foto_sintetica(pasta_torso: Path, vista: str, largura: int = 2000, _cache: dict | None = None) -> dict:
    """Gera e grava a foto sintetica de `vista`; devolve o registro (dict JSON)."""
    if vista not in VISTAS:
        raise ValueError(f"vista desconhecida: {vista}")
    pasta = Path(pasta_torso)
    gab = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
    lm = {k: np.asarray(v["posicao"], dtype=np.float64) for k, v in gab["landmarks"].items()}
    cache = _cache if _cache is not None else {}
    if "malha" not in cache:
        cache["malha"] = ler_malha(pasta / "torso.obj")
        cache["textura"] = np.asarray(Image.open(pasta / "textura.png").convert("RGB"))
    malha, textura = cache["malha"], cache["textura"]
    altura = int(round(largura * 3 / 4))
    K, R, t = cameras_clinicas(lm, largura, altura)[vista]
    # recorte do topo (o "rosto"): a borda superior fica 15 mm acima da furcula nesta vista
    _, y_ax, _ = quadro_anatomico(lm)
    v_topo = projetar((lm["furcula"] + RECORTE_ACIMA_FURCULA_MM * y_ax)[None], K, R, t)[0, 1]
    corte = int(max(0, np.floor(v_topo)))
    K = K.copy()
    K[1, 2] -= corte
    altura_c = altura - corte
    img, mascara, _, prof = renderizar(malha, textura, K, R, t, largura, altura_c,
                                       semente=int(gab["parametros"]["semente"]))
    uv = {k: projetar(p[None], K, R, t)[0] for k, p in lm.items()}
    visiveis = []
    for k, p in lm.items():
        u, v = uv[k]
        i, j = int(np.floor(u)), int(np.floor(v))
        if not (0 <= i < largura and 0 <= j < altura_c):
            continue
        zc = para_camera(p[None], R, t)[0, 2]
        janela = prof[max(0, j - 1):j + 2, max(0, i - 1):i + 2]
        if np.isfinite(janela).any() and zc <= np.min(janela) + TOL_VISIVEL_MM:
            visiveis.append(k)
    destino = pasta / "fotos"
    destino.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    Image.fromarray(img, "RGB").save(buf, format="JPEG", quality=QUALIDADE_JPEG)
    (destino / f"foto_{vista}.jpg").write_bytes(buf.getvalue())
    buf = io.BytesIO()
    Image.fromarray((mascara * 255).astype(np.uint8), "L").save(buf, format="PNG")
    (destino / f"mascara_{vista}.png").write_bytes(buf.getvalue())
    registro = {
        "esquema": "registro_foto_sintetica/1.0",
        "torso": gab["nome"],
        "vista": vista,
        "arquivo": f"fotos/foto_{vista}.jpg",
        "mascara": f"fotos/mascara_{vista}.png",
        "largura_px": largura,
        "altura_px": altura_c,
        "recorte_topo_px": corte,
        "focal_35mm": focal_35mm_de_k(K, largura, altura_c),
        "K": coluna_major(K),
        "R": coluna_major(R),
        "t": [float(v) for v in t],
        "k1": 0.0,
        "landmarks_2d": {k: [float(uv[k][0]), float(uv[k][1])] for k in lm},
        "visiveis": visiveis,
        "fundo_rgb": list(FUNDO_RGB),
    }
    (destino / f"registro_{vista}.json").write_text(json.dumps(registro, ensure_ascii=False, indent=2) + "\n",
                                                    encoding="utf-8")
    return registro


def fotos_sinteticas(pasta_torso: Path, vistas=("frente", "obliqua_dir", "perfil_dir"), largura: int = 2000) -> dict:
    cache: dict = {}
    return {v: foto_sintetica(pasta_torso, v, largura, _cache=cache) for v in vistas}
