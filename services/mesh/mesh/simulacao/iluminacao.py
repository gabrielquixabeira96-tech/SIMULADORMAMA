"""Iluminacao em harmonicos esfericos de ordem 2 (SH9) — contratos §10.6 (`iluminacao_sh9/1.0`); ADR 0020.

Para que serve
--------------
O modo foto do web (ADR 0019) desenha a textura **sem somar luz** e aplica, depois do morph, so a
mudanca de sombreamento causada pela nova normal: `R = E(N_depois) / E(N_antes)` (*ratio image*).
`E` e a irradiancia difusa da luz que ja esta "assada" na textura, em SH9 (Ramamoorthi & Hanrahan
2001, "An Efficient Representation for Irradiance Environment Maps"), no **espaco do objeto do .glb**
(a luz acompanha a paciente, nao a camera). Este modulo:

- define a base (`BASE_SH9`) e a avaliacao (`irradiancia_sh9`);
- converte "ambiente + direcional" em coeficientes (`sh9_de_luz`) e da a luz padrao (`sh9_padrao`);
- ajusta os 9 coeficientes a luminancia de uma textura amostrada nos vertices (`ajustar_sh9`), por
  minimos quadrados robustos (IRLS com peso de Huber), com recuo para a luz padrao quando o ajuste
  nao explica os dados.

Convencao (congelada no contrato C1 — o web implementa a mesma)
--------------------------------------------------------------
Base real sem fase de Condon-Shortley, ordem (l, m) com m = -l..l, `n = (x, y, z)` unitario no espaco
do objeto:

    i : 0      1      2      3      4       5       6              7       8
    Y : c0     c1*y   c1*z   c1*x   c2*x*y  c2*y*z  c3*(3z^2 - 1)  c2*x*z  c4*(x^2 - y^2)
    c0 = 0.282095  c1 = 0.488603  c2 = 1.092548  c3 = 0.315392  c4 = 0.546274

`sh9` sao coeficientes de **irradiancia** (ja convoluidos com o cosseno: A0 = pi, A1 = 2pi/3,
A2 = pi/4), de modo que `E(n) = sum_i sh9[i] * Y_i(n)`, em luminancia linear (0..1). E a mesma base
e ordem de `THREE.SphericalHarmonics3`. A escala de `sh9` nao importa para o web (so a razao
E(N_depois)/E(N_antes) e usada); no ajuste ela carrega o albedo medio da pele.

Nada aqui mede a paciente nem ve imagem com IA: e algebra linear sobre a textura ja existente.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

ESQUEMA = "iluminacao_sh9/1.0"

C0, C1, C2, C3, C4 = 0.282095, 0.488603, 1.092548, 0.315392, 0.546274
A0, A1, A2 = np.pi, 2.0 * np.pi / 3.0, np.pi / 4.0
# fator de convolucao por coeficiente (l = 0, 1, 1, 1, 2, 2, 2, 2, 2)
CONVOLUCAO = np.array([A0, A1, A1, A1, A2, A2, A2, A2, A2])

# Luz padrao (contrato C1): ambiente 0,45 + direcional 0,55, frontal-superior no quadro anatomico.
AMBIENTE_PADRAO = 0.45
DIRECIONAL_PADRAO = 0.55
DIRECAO_PADRAO_ANATOMICA = np.array([0.0, 0.35, 0.94]) / np.linalg.norm([0.0, 0.35, 0.94])

# Ajuste (ADR 0020): recua para a luz padrao com R^2 < 0,3 ou menos de 500 amostras.
R2_MINIMO = 0.3
AMOSTRAS_MINIMAS = 500
LIMIAR_FRENTE = -0.2          # so vertices com N . (0,0,1)_obj > -0,2 (sem mascara explicita)
HUBER_K = 1.345               # constante de Huber (95 % de eficiencia sob ruido gaussiano)
ITERACOES_IRLS = 50


def BASE_SH9(n: np.ndarray) -> np.ndarray:  # noqa: N802 (nome do plano/contrato C1)
    """(k, 3) normais unitarias -> (k, 9) valores da base SH real de ordem 2 (convencao C1)."""
    n = np.atleast_2d(np.asarray(n, dtype=np.float64))
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    return np.stack([
        np.full_like(x, C0),
        C1 * y, C1 * z, C1 * x,
        C2 * x * y, C2 * y * z, C3 * (3.0 * z * z - 1.0), C2 * x * z, C4 * (x * x - y * y),
    ], axis=1)


def irradiancia_sh9(N: np.ndarray, sh9) -> np.ndarray:
    """E(n) = sum_i sh9[i] * Y_i(n) para normais (..., 3) -> (...). Avaliada por componente (sem a
    matriz (k, 9)), para servir tambem a grades de textura de milhoes de texels."""
    N = np.asarray(N)
    if N.dtype not in (np.float32, np.float64):
        N = N.astype(np.float64)
    c = np.asarray(sh9, dtype=N.dtype)
    x, y, z = N[..., 0], N[..., 1], N[..., 2]
    return (c[0] * C0 + C1 * (c[1] * y + c[2] * z + c[3] * x)
            + C2 * (c[4] * x * y + c[5] * y * z + c[7] * x * z)
            + c[6] * C3 * (3.0 * z * z - 1.0) + c[8] * C4 * (x * x - y * y))


def sh9_de_luz(ambiente: float, direcional: float, direcao) -> np.ndarray:
    """Coeficientes de irradiancia de uma luz ambiente uniforme (E = `ambiente` em toda direcao) mais
    uma direcional de intensidade `direcional` vinda de `direcao` (E ~ direcional * max(0, n.L),
    truncada na ordem 2: sobe a 1,0625 x no eixo e desce a ~-0,04 x a 122 graus)."""
    L = np.asarray(direcao, dtype=np.float64)
    L = L / np.linalg.norm(L)
    sh = direcional * CONVOLUCAO * BASE_SH9(L[None, :])[0]
    sh[0] += ambiente / C0
    return sh


def eixos_anatomicos(landmarks: dict | None) -> np.ndarray | None:
    """Matriz 3x3 R = [x y z] (colunas: eixos anatomicos no espaco do objeto) pela formula de
    referencia do contratos §1.1; None se faltar landmark."""
    if not landmarks:
        return None
    from mesh.medir.antropometria import quadro_anatomico

    q = quadro_anatomico(landmarks)
    if q is None:
        return None
    return np.column_stack([q["x"], q["y"], q["z"]]).astype(np.float64)


def sh9_padrao(eixos: np.ndarray | None = None) -> np.ndarray:
    """Luz padrao do contrato C1 (ambiente 0,45 + direcional 0,55, L = normalizar(0; 0,35; 0,94) no
    quadro anatomico), levada ao espaco do objeto por `eixos` (R = [x y z]; None = identidade, que e
    o caso dos torsos sinteticos, gerados no quadro anatomico). E(n) > 0 para todo n (minimo ~0,43)."""
    L = DIRECAO_PADRAO_ANATOMICA if eixos is None else np.asarray(eixos, dtype=np.float64) @ DIRECAO_PADRAO_ANATOMICA
    return sh9_de_luz(AMBIENTE_PADRAO, DIRECIONAL_PADRAO, L)


# ----------------------------------------------------------------------------- cor

def srgb_para_linear(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_para_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def luminancia(rgb_linear: np.ndarray) -> np.ndarray:
    """Luminancia relativa (Rec. 709 / sRGB) de cor linear (..., 3)."""
    return np.asarray(rgb_linear, dtype=np.float64) @ np.array([0.2126, 0.7152, 0.0722])


def amostrar_textura(textura: Image.Image, uv: np.ndarray) -> np.ndarray:
    """Cor sRGB (0..1) bilinear nos `uv` (convencao OBJ: v para cima), com o mesmo endereçamento do
    sampler do .glb (REPEAT em u, CLAMP em v; contratos §5.3)."""
    img = np.asarray(textura.convert("RGB"), dtype=np.float64) / 255.0
    H, W = img.shape[:2]
    u = np.asarray(uv[:, 0], dtype=np.float64)
    v = np.asarray(uv[:, 1], dtype=np.float64)
    x = np.mod(u, 1.0) * W - 0.5
    y = np.clip((1.0 - v) * H - 0.5, 0.0, H - 1.0)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    x1, y1 = (x0 + 1) % W, np.minimum(y0 + 1, H - 1)
    x0 %= W
    topo = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    base = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return topo * (1 - fy) + base * fy


# ----------------------------------------------------------------------------- ajuste

def _mad(r: np.ndarray) -> float:
    return float(1.4826 * np.median(np.abs(r - np.median(r))))


def _mq_ponderado(B: np.ndarray, y: np.ndarray, w: np.ndarray) -> np.ndarray:
    s = np.sqrt(w)
    return np.linalg.lstsq(B * s[:, None], y * s, rcond=None)[0]


def ajuste_robusto(B: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """IRLS com peso de Huber (escala por MAD recalculada a cada passo). Devolve (coeficientes,
    pesos finais, R^2 ponderado = 1 - sum w r^2 / sum w (y - media_w)^2)."""
    w = np.ones(len(y))
    c = _mq_ponderado(B, y, w)
    for _ in range(ITERACOES_IRLS):
        r = y - B @ c
        escala = max(_mad(r), 1e-9)
        k = HUBER_K * escala
        a = np.abs(r)
        w = np.where(a <= k, 1.0, k / np.maximum(a, 1e-300))
        c_novo = _mq_ponderado(B, y, w)
        if np.max(np.abs(c_novo - c)) < 1e-9:
            c = c_novo
            break
        c = c_novo
    r = y - B @ c
    media = float(np.sum(w * y) / np.sum(w))
    tot = float(np.sum(w * (y - media) ** 2))
    r2 = 1.0 - float(np.sum(w * r * r)) / tot if tot > 0 else 0.0
    return c, w, r2


def _resultado(sh9: np.ndarray, r2: float, origem: str) -> dict:
    return {"esquema": ESQUEMA, "sh9": [round(float(v), 6) for v in sh9], "r2": round(float(r2), 4),
            "origem": origem}


def ajustar_sh9(textura: Image.Image | None, uv: np.ndarray | None, N: np.ndarray,
                mascara: np.ndarray | None = None, eixos: np.ndarray | None = None,
                detalhes: bool = False):
    """Ajusta a luz assada na textura (contrato C1: `asset.extras.iluminacao`).

    - `textura`/`uv`: a imagem e a UV por vertice (convencao OBJ) da malha; `N`: normais unitarias
      por vertice no espaco do objeto (as da malha lida, soldada).
    - Amostras: luminancia linear da textura em cada vertice, so onde `mascara` (se dada) ou onde
      N . (0,0,1)_obj > -0,2 (com `eixos`, o z anatomico no lugar de (0,0,1)_obj; nos torsos
      sinteticos os dois coincidem); texels saturados (algum canal >= 0,995) ou pretos ficam de fora.
    - `eixos`: R = [x y z] do quadro anatomico no espaco do objeto (`eixos_anatomicos(landmarks)`).
    - Modelo: luminancia ~ sum_i c_i Y_i(N) (o albedo medio vai para a escala de c).
    - Recuo `origem: "padrao"` (com `sh9_padrao(eixos)`): sem textura/UV, < 500 amostras, textura lisa
      (desvio da luminancia < 0,001), R^2 < 0,3 ou irradiancia ajustada <= 0 em alguma normal amostrada.
      `r2` fica em [0, 1] (0 quando nao houve ajuste).

    Devolve `{"esquema", "sh9", "r2", "origem"}` (e, com `detalhes=True`, uma tupla com um dicionario
    de diagnostico: n_amostras, pesos, coeficientes brutos, mascara usada).
    """
    padrao = sh9_padrao(eixos)
    info: dict = {"n_amostras": 0, "motivo": None}

    def saida(res):
        return (res, info) if detalhes else res

    if textura is None or uv is None or len(uv) != len(N):
        info["motivo"] = "sem_textura"
        return saida(_resultado(padrao, 0.0, "padrao"))
    N = np.asarray(N, dtype=np.float64)
    # "frente": z do objeto; com landmarks, o z anatomico (num scan real o quadro do objeto e arbitrario)
    frente = np.array([0.0, 0.0, 1.0]) if eixos is None else np.asarray(eixos, dtype=np.float64)[:, 2]
    sel = (N @ frente > LIMIAR_FRENTE) if mascara is None else np.asarray(mascara, dtype=bool).copy()
    sel &= np.all(np.isfinite(uv), axis=1) & np.all(np.isfinite(N), axis=1)
    idx = np.nonzero(sel)[0]
    cor = amostrar_textura(textura, uv[idx])
    ok = (cor.max(axis=1) < 0.995) & (cor.max(axis=1) > 0.004)
    idx = idx[ok]
    info["n_amostras"] = int(len(idx))
    if len(idx) < AMOSTRAS_MINIMAS:
        info["motivo"] = "poucas_amostras"
        return saida(_resultado(padrao, 0.0, "padrao"))
    y = luminancia(srgb_para_linear(cor[ok]))
    if float(np.std(y)) < 1e-3:
        # textura lisa (p. ex. o 2x2 cinza que o trimesh poe quando o .mtl falta): nada a ajustar
        info["motivo"] = "textura_uniforme"
        return saida(_resultado(padrao, 0.0, "padrao"))
    B = BASE_SH9(N[idx])
    c, w, r2 = ajuste_robusto(B, y)
    r2 = max(float(r2), 0.0) if np.isfinite(r2) else 0.0
    info.update({"coeficientes": c, "pesos": w, "indices": idx, "r2": r2})
    if r2 < R2_MINIMO:
        info["motivo"] = "r2_baixo"
        return saida(_resultado(padrao, r2, "padrao"))
    if np.min(B @ c) <= 0:
        info["motivo"] = "irradiancia_nao_positiva"
        return saida(_resultado(padrao, r2, "padrao"))
    return saida(_resultado(c, r2, "ajuste"))
