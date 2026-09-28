"""Textura procedural "fotografica" de pele do torso sintetico (contratos §4.5; ADR 0020).

Tudo e codigo deterministico (numpy/scipy) a partir da `semente` e da superficie analitica do torso;
nenhum arquivo de imagem e lido e nenhuma foto real e usada (ADR 0009 item 5; restricao 2). O
objetivo e que a demo deixe de parecer manequim e que o modo foto do web (ADR 0019) tenha o que
mostrar: pele por fototipo, areola e mamilo desenhados na UV com a metrica real da superficie e uma
luz de estudio "assada" com coeficientes SH9 conhecidos (os mesmos que o gabarito registra).

Mapeamento texel -> superficie
------------------------------
A UV do torso e cilindrica (gerador.Grade): u = (s + P/2) / P, v = (y - y_base) / (y_topo - y_base),
com `s` o arco da secao a partir da linha media anterior e P o perimetro. O centro do texel (i, j)
(linha i de cima para baixo, como no PNG) fica em u = (j + 0,5)/W, v = 1 - (i + 0,5)/H. A imagem tem
`px_por_mm` texels por mm nas duas direcoes (largura = min(4096, P * px_por_mm), multipla de 4;
altura = min(2048, altura * px_por_mm)) e e periodica em u (a costura, nas costas, nao aparece).

Camadas (espaco linear; a saida e sRGB 8 bits)
----------------------------------------------
1. **Albedo** por fototipo de Fitzpatrick (tabela `FOTOTIPOS`), com mosqueado de baixa frequencia
   (+-3 % de matiz e +-3,5 % de luminancia), microtextura/poros (fBm periodico em u), subtom rosado
   leve nos polos inferiores e na regiao esternal, pele das mamas um pouco mais palida que o colo e
   alguns nevos pequenos longe das areolas.
2. **Areola** (O 40 mm, borda suave de 2 mm, levemente irregular) e **mamilo** (O 10 mm) desenhados
   pela **distancia 3D** ao ponto do mamilo `torso.ponto(*mama.param_mamilo())`: para cada texel,
   (s, y) -> `torso.avaliar` -> |P - P_mamilo| (`distancia_ao_mamilo`), de modo que o disco e um disco
   na pele, nao na UV.
   A mistura pele -> areola -> mamilo e feita em log (densidade de pigmento), entao a crominancia
   log(G/R) passa pelo ponto medio no raio nominal. 8-12 tuberculos de Montgomery (mais claros, com
   relevo) e as rugas radiais do mamilo entram como relevo fino (normal perturbada) e cor.
3. **Luz assada** como numa foto clinica: irradiancia SH9 de duas luzes frontais simetricas (+-37
   graus, elevadas ~24 graus) mais ambiente (`LUZ_GRAVADA`), avaliada na normal da superficie com o
   microrrelevo; sombra da prega inframamaria em funcao da distancia abaixo da linha do sulco; brilho
   difuso leve (multiplicativo, acromatico). Os coeficientes SH9 voltam no dicionario (`sh9`), para o
   gabarito e para o teste de recuperacao do ajuste (T11).

Desempenho: a parede do torso e separavel (a secao depende so de s, a cintura so de y), entao a
normal, as tangentes e as alturas so sao calculadas por diferencas finitas da superficie exata nas
caixas onde ha mama ou incisura; o resto da imagem usa as formulas fechadas da parede. Os campos
grandes sao float32. `realismo="esquematico"` delega a `textura.textura_neutra` (Marco 0).
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import sparse

from mesh.simulacao.iluminacao import ESQUEMA, irradiancia_sh9, linear_para_srgb, sh9_de_luz, srgb_para_linear
from mesh.sintetico.superficie import INCISURA_PROF_MM, INCISURA_SIGMA_X_MM, INCISURA_SIGMA_Y_MM, MAMILO_SIGMA_MM
from mesh.sintetico.textura import textura_neutra

REALISMOS = ("fotografico", "esquematico")
LARGURA_MAX_PX = 4096
ALTURA_MAX_PX = 2048
AREOLA_MM = 40.0
MAMILO_MM = 10.0
BORDA_AREOLA_MM = 2.0
BORDA_MAMILO_MM = 1.0

# sRGB 8 bits da pele, da areola e do mamilo sob a luz frontal (E ~ 1). Aproximacoes de tons de
# pele por fototipo de Fitzpatrick (I = muito clara ... VI = muito escura); nao sao medidas de pessoa.
FOTOTIPOS: dict[str, tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]] = {
    "I": ((241, 214, 196), (206, 150, 140), (190, 126, 118)),
    "II": ((231, 196, 170), (190, 132, 118), (174, 110, 98)),
    "III": ((214, 170, 140), (165, 108, 88), (150, 90, 72)),
    "IV": ((184, 134, 100), (132, 82, 62), (116, 68, 52)),
    "V": ((140, 95, 68), (98, 60, 44), (84, 50, 38)),
    "VI": ((92, 62, 46), (62, 37, 28), (52, 31, 24)),
}

# Luz de estudio assada (quadro anatomico = espaco do objeto do torso sintetico): ambiente + duas
# luzes frontais simetricas (padrao de fotografia clinica), normalizada para E ~ 1 de frente.
LUZ_GRAVADA = {
    "ambiente": 0.36,
    "direcionais": [(0.45, (0.55, 0.40, 0.73)), (0.45, (-0.55, 0.40, 0.73))],
}
SOMBRA_SULCO = 0.38            # escurecimento maximo junto a prega inframamaria
SOMBRA_SULCO_MM = 7.0          # decaimento abaixo da linha do sulco
BRILHO = 0.05                  # brilho difuso (multiplicativo) no apice
VETOR_RUBOR = np.array([0.5, -0.35, -0.6], dtype=np.float32)  # direcao "mais vermelho" em log RGB
FAIXA_LINHAS = 64              # linhas por faixa no passo final (cabe em cache; fixo = deterministico)
_F32 = np.float32
# desvio-padrao do ruido de valor B-spline cubico 2D com rede N(0, 1): sqrt(E[sum w^2]^2)
_DP_BSPLINE_2D = 0.4793653


# ----------------------------------------------------------------------------- utilidades

def sh9_gravada() -> np.ndarray:
    """Coeficientes SH9 (espaco do objeto) da luz assada na textura fotografica."""
    sh = sh9_de_luz(LUZ_GRAVADA["ambiente"], 0.0, (0.0, 0.0, 1.0))
    for intensidade, direcao in LUZ_GRAVADA["direcionais"]:
        sh = sh + sh9_de_luz(0.0, intensidade, direcao)
    return sh


def dimensoes(torso, px_por_mm: float) -> tuple[int, int]:
    P = torso.secao.perimetro
    Ht = torso.y_topo - torso.y_base
    W = min(LARGURA_MAX_PX, int(round(P * px_por_mm / 4.0)) * 4)
    H = min(ALTURA_MAX_PX, int(round(Ht * px_por_mm)))
    return max(W, 4), max(H, 2)


def coordenadas_texels(torso, W: int, H: int) -> tuple[np.ndarray, np.ndarray]:
    """(s por coluna (W,), y por linha (H,)) dos centros dos texels (linha 0 = topo da imagem)."""
    P = torso.secao.perimetro
    Ht = torso.y_topo - torso.y_base
    s = -P / 2.0 + (np.arange(W) + 0.5) / W * P
    y = torso.y_base + (1.0 - (np.arange(H) + 0.5) / H) * Ht
    return s, y


def texel_de(torso, W: int, H: int, s: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inverso de `coordenadas_texels`: (coluna, linha) continuas do centro de texel de (s, y)."""
    P = torso.secao.perimetro
    Ht = torso.y_topo - torso.y_base
    return (np.asarray(s) + P / 2.0) / P * W - 0.5, (1.0 - (np.asarray(y) - torso.y_base) / Ht) * H - 0.5


def _smooth(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _caixa(eixo: np.ndarray, lo: float, hi: float) -> slice:
    """Fatia dos indices de `eixo` (monotono) dentro de [lo, hi]."""
    ix = np.nonzero((eixo >= lo) & (eixo <= hi))[0]
    return slice(0, 0) if len(ix) == 0 else slice(int(ix.min()), int(ix.max()) + 1)


def _caixas_relevo(torso) -> list[tuple[float, float, float, float]]:
    """Caixas (s_lo, s_hi, y_lo, y_hi) em mm fora das quais h(s, y) < 1e-7 mm (so parede)."""
    caixas = [(-6 * INCISURA_SIGMA_X_MM, 6 * INCISURA_SIGMA_X_MM, -6 * INCISURA_SIGMA_Y_MM, 6 * INCISURA_SIGMA_Y_MM)]
    for mama in torso.mamas:
        sm, ym = mama.param_mamilo()
        su = sorted((mama.lado * (mama.s_mamilo - mama.e_med), mama.lado * (mama.s_mamilo + mama.e_lat)))
        caixas.append((min(su[0], sm - 6 * MAMILO_SIGMA_MM) - 1.0, max(su[1], sm + 6 * MAMILO_SIGMA_MM) + 1.0,
                       min(mama.y_apice - mama.e_inf, ym - 6 * MAMILO_SIGMA_MM) - 1.0,
                       max(mama.y_apice + mama.e_sup, ym + 6 * MAMILO_SIGMA_MM) + 1.0))
    return caixas


def alturas_grade(torso, s: np.ndarray, y: np.ndarray) -> np.ndarray:
    """h(s, y) = incisura + mama_dir + mama_esq (a mesma soma de `Torso.avaliar`) na grade s x y,
    calculada so nas caixas onde cada termo e nao nulo."""
    h = np.zeros((len(y), len(s)))
    termos = [torso.incisura] + [m.altura for m in torso.mamas]
    for (s_lo, s_hi, y_lo, y_hi), termo in zip(_caixas_relevo(torso), termos, strict=True):
        cs, cy = _caixa(s, s_lo, s_hi), _caixa(y, y_lo, y_hi)
        if cs.stop > cs.start and cy.stop > cy.start:
            S, Y = np.meshgrid(s[cs], y[cy])
            h[cy, cs] += termo(S, Y)
    return h


def superficie_grade(torso, s: np.ndarray, y: np.ndarray, h: np.ndarray | None = None) -> np.ndarray:
    """Pontos (H, W, 3) de S(s, y) na grade produto s x y: o mesmo que `torso.avaliar` (diferenca
    < 1e-6 mm, testado), com a parede avaliada de forma separavel."""
    x, z, tx, tz = torso.secao.avaliar(s)
    k, dk = torso._escala(y)
    k, dk = k[:, None], dk[:, None]
    x, z, tx, tz = x[None, :], z[None, :], tx[None, :], tz[None, :]
    nx = -k * tz
    ny = k * dk * (tz * x - tx * z)
    nz = k * tx * np.ones_like(dk)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    if h is None:
        h = alturas_grade(torso, s, y)
    P = np.empty((len(y), len(s), 3))
    P[..., 0] = k * x + h * nx * inv
    P[..., 1] = y[:, None] + h * ny * inv
    P[..., 2] = k * z + h * nz * inv + INCISURA_PROF_MM
    return P


def _normalizar(v: np.ndarray) -> np.ndarray:
    n = np.sqrt(np.sum(v * v, axis=-1, keepdims=True))
    return v / np.maximum(n, 1e-12)


def distancia_ao_mamilo(torso, mama, S: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """Distancia 3D (mm) de S(s, y) ao ponto do mamilo `torso.ponto(*mama.param_mamilo())` (a ponta do
    relevo do mamilo): a metrica com que areola e mamilo sao desenhados. Numa cupula curva a corda de
    borda a borda da areola fica menor que o dobro desse raio (ver ADR 0020, T10)."""
    return np.linalg.norm(torso.avaliar(S, Y) - torso.ponto(*mama.param_mamilo()), axis=-1)


class Geometria:
    """Normal, tangentes unitarias (d/ds, d/dy) e |dP/ds|, |dP/dy| por texel, entregues por faixas de
    linhas (float32). Fora das caixas de relevo: formulas fechadas da parede (separaveis, a partir de
    vetores 1D); dentro: diferencas centrais da superficie exata com passo de 1 texel, pre-calculadas."""

    def __init__(self, torso, s: np.ndarray, y: np.ndarray, ds: float, dy: float):
        self.W = len(s)
        self.x, self.z, self.tx, self.tz = (v.astype(_F32) for v in torso.secao.avaliar(s))
        k, dk = torso._escala(y)
        self.k, self.dk = k.astype(_F32), dk.astype(_F32)
        self.caixas = []
        for s_lo, s_hi, y_lo, y_hi in _caixas_relevo(torso):
            cs, cy = _caixa(s, s_lo, s_hi), _caixa(y, y_lo, y_hi)
            if cs.stop <= cs.start or cy.stop <= cy.start:
                continue
            sb, yb = s[cs], y[cy]
            Ps = (superficie_grade(torso, sb + ds, yb) - superficie_grade(torso, sb - ds, yb)) / (2 * ds)
            Py = (superficie_grade(torso, sb, yb + dy) - superficie_grade(torso, sb, yb - dy)) / (2 * dy)
            cs_n = np.linalg.norm(Ps, axis=-1)
            cy_n = np.linalg.norm(Py, axis=-1)
            self.caixas.append((cy, cs, _normalizar(np.cross(Ps, Py)).astype(_F32),
                                (Ps / cs_n[..., None]).astype(_F32), (Py / cy_n[..., None]).astype(_F32),
                                cs_n.astype(_F32), cy_n.astype(_F32)))

    def faixa(self, i0: int, i1: int):
        """(N, Ts, Ty, |Ps|, |Py|) das linhas [i0, i1)."""
        n, W = i1 - i0, self.W
        k, dk = self.k[i0:i1, None], self.dk[i0:i1, None]
        # parede: Ps = k (tx, 0, tz); Py = (dk x, 1, dk z); N = Ps x Py / |.|
        Ts = np.empty((n, W, 3), _F32)
        Ts[..., 0] = self.tx
        Ts[..., 1] = 0.0
        Ts[..., 2] = self.tz
        Ty = np.empty((n, W, 3), _F32)
        Ty[..., 0] = dk * self.x
        Ty[..., 1] = 1.0
        Ty[..., 2] = dk * self.z
        cy = np.sqrt(np.sum(Ty * Ty, axis=-1))
        Ty /= cy[..., None]
        cs = np.broadcast_to(k, (n, W)).copy()
        N = _normalizar(np.cross(Ts, Ty))
        for (fy, fs, Nb, Tsb, Tyb, csb, cyb) in self.caixas:
            a, b = max(i0, fy.start), min(i1, fy.stop)
            if a >= b:
                continue
            dst, src = slice(a - i0, b - i0), slice(a - fy.start, b - fy.start)
            N[dst, fs], Ts[dst, fs], Ty[dst, fs] = Nb[src], Tsb[src], Tyb[src]
            cs[dst, fs], cy[dst, fs] = csb[src], cyb[src]
        return N, Ts, Ty, cs, cy


# ----------------------------------------------------------------------------- ruido periodico

def _pesos_bspline(t: np.ndarray, n: int, periodico: bool) -> sparse.csr_matrix:
    i0 = np.floor(t).astype(np.int64)
    f = t - i0
    f2, f3 = f * f, f * f * f
    w = np.stack([(1 - f) ** 3 / 6.0, (3 * f3 - 6 * f2 + 4) / 6.0, (-3 * f3 + 3 * f2 + 3 * f + 1) / 6.0, f3 / 6.0], 1)
    cols = i0[:, None] + np.arange(-1, 3)[None, :]
    cols = np.mod(cols, n) if periodico else np.clip(cols, 0, n - 1)
    linhas = np.repeat(np.arange(len(t)), 4)
    return sparse.csr_matrix((w.reshape(-1), (linhas, cols.reshape(-1))), shape=(len(t), n))


class _Ruido:
    """Ruido de valor com interpolacao B-spline cubica sobre uma rede N(0, 1), periodico em s (numero
    inteiro de celulas no perimetro), isotropico em mm, desvio-padrao ~1 (normalizacao teorica, sem
    depender da amostra). Deterministico pelo rng: cada chamada consome a rede inteira."""

    def __init__(self, rng: np.random.Generator, s: np.ndarray, y: np.ndarray, perimetro: float):
        self.rng, self.s, self.y, self.P = rng, s, y, perimetro

    def campo(self, celula_mm: float, linhas: slice = slice(None), colunas: slice = slice(None)) -> np.ndarray:
        nu = max(4, int(round(self.P / celula_mm)))
        tu = (self.s[colunas] + self.P / 2.0) / (self.P / nu)
        y0 = float(self.y.min())
        nv = int(np.ceil((float(self.y.max()) - y0) / celula_mm)) + 4
        tv = (self.y[linhas] - y0) / celula_mm + 1.5
        rede = self.rng.standard_normal((nv, nu))
        Av, Au = _pesos_bspline(tv, nv, False), _pesos_bspline(tu, nu, True)
        meio = np.asarray(Au @ rede.T).T                 # (nv, W)
        return (np.asarray(Av @ meio) / _DP_BSPLINE_2D).astype(_F32)

    def fbm(self, celula_mm: float, oitavas: int, ganho: float = 0.5) -> np.ndarray:
        total = np.zeros((len(self.y), len(self.s)), _F32)
        amp, soma2 = 1.0, 0.0
        for k in range(oitavas):
            total += _F32(amp) * self.campo(celula_mm / 2**k)
            soma2 += amp * amp
            amp *= ganho
        return total / _F32(np.sqrt(soma2))


# ----------------------------------------------------------------------------- textura

def _log_srgb(c) -> np.ndarray:
    return np.log(srgb_para_linear(np.asarray(c, dtype=np.float64) / 255.0)).astype(_F32)


_LUT_SRGB = np.round(linear_para_srgb(np.arange(65536) / 65535.0) * 255.0).astype(np.uint8)


def _para_srgb8(lin: np.ndarray) -> np.ndarray:
    idx = np.clip(lin * _F32(65535.0) + _F32(0.5), 0, 65535).astype(np.uint16)
    return _LUT_SRGB[idx]


def textura_pele(semente: int, torso, fototipo: str = "III", px_por_mm: float = 4.0,
                 realismo: str = "fotografico", areola_mm: float = AREOLA_MM,
                 mamilo_mm: float = MAMILO_MM) -> tuple[Image.Image, dict]:
    """Gera a textura e devolve `(imagem RGB, bloco "textura" do gabarito)`.

    `torso` e o `superficie.Torso` ja com as amplitudes resolvidas (o mesmo que gerou a malha).
    O dicionario traz `esquema: "iluminacao_sh9/1.0"`, os `sh9` da luz assada (espaco do objeto =
    quadro anatomico), `r2: 1.0`, `origem: "sintetico"`, o realismo, o fototipo, a resolucao e os
    diametros nominais de areola e mamilo."""
    if realismo not in REALISMOS:
        raise ValueError(f"realismo desconhecido: {realismo}")
    if realismo == "esquematico":
        img = textura_neutra(semente)
        return img, {"esquema": ESQUEMA, "realismo": "esquematico",
                     "sh9": [round(float(v), 6) for v in sh9_de_luz(1.0, 0.0, (0.0, 0.0, 1.0))],
                     "r2": 1.0, "origem": "sintetico", "largura_px": img.size[0], "altura_px": img.size[1]}
    if fototipo not in FOTOTIPOS:
        raise ValueError(f"fototipo desconhecido: {fototipo}")

    rng = np.random.default_rng([int(semente), 20260928])
    W, H = dimensoes(torso, px_por_mm)
    s, y = coordenadas_texels(torso, W, H)
    ds = torso.secao.perimetro / W
    dy = (torso.y_topo - torso.y_base) / H
    ruido = _Ruido(rng, s, y, torso.secao.perimetro)
    geo = Geometria(torso, s, y, ds, dy)
    y_mamilos = 0.5 * (torso.mama_dir.y_mamilo + torso.mama_esq.y_mamilo)
    pele, areola, mamilo = (_log_srgb(c) for c in FOTOTIPOS[fototipo])

    # --- campos escalares do albedo: rubor (matiz) e luminancia, em log
    poros = ruido.fbm(1.4, 3, ganho=0.6)
    rubor = _F32(0.035) * ruido.fbm(45.0, 2)
    lum = _F32(0.035) * ruido.fbm(28.0, 2) + _F32(0.022) * poros
    palidez = np.zeros((H, W), _F32)
    for mama in torso.mamas:  # mamas um pouco mais palidas (sem borda: gaussiana na pegada); polo inferior rosado
        su = sorted((mama.lado * (mama.s_mamilo - 1.8 * mama.e_med), mama.lado * (mama.s_mamilo + 1.8 * mama.e_lat)))
        cs = _caixa(s, su[0], su[1])
        cy = _caixa(y, mama.y_apice - 1.8 * mama.e_inf, mama.y_apice + 1.8 * mama.e_sup)
        S, Y = np.meshgrid(s[cs], y[cy])
        du, dv = mama.lado * S - mama.s_mamilo, Y - mama.y_apice
        r2 = (du / np.where(du > 0, mama.e_lat, mama.e_med)) ** 2 + (dv / np.where(dv > 0, mama.e_sup, mama.e_inf)) ** 2
        m = np.exp(-2.0 * r2)
        palidez[cy, cs] = np.maximum(palidez[cy, cs], m)
        rubor[cy, cs] += _F32(0.05) * (m * _smooth((mama.y_mamilo - Y) / 30.0)).astype(_F32)
    cs, cy = _caixa(s, -110.0, 110.0), _caixa(y, y_mamilos - 90.0, -40.0)   # regiao esternal
    S, Y = np.meshgrid(s[cs], y[cy])
    rubor[cy, cs] += (0.042 * np.exp(-0.5 * (S / 28.0) ** 2) * _smooth((-40.0 - Y) / 30.0)
                      * _smooth((Y - y_mamilos + 90.0) / 40.0)).astype(_F32)
    colo = _smooth((y - (y_mamilos + 55.0)) / 70.0).astype(_F32)[:, None] * (1 - palidez)  # colo mais bronzeado
    rubor += _F32(0.02) * colo - _F32(0.015) * palidez
    lum += _F32(0.025) * palidez - _F32(0.03) * colo
    del colo, palidez
    log_alb = pele[None, None, :] + rubor[..., None] * VETOR_RUBOR + lum[..., None]
    del rubor, lum

    # nevos pequenos, longe das areolas (so na frente do torso)
    mamilos = [np.array(m.param_mamilo()) for m in torso.mamas]
    for _ in range(int(rng.integers(5, 10))):
        for _tentativa in range(20):
            cs_ = rng.uniform(-0.28, 0.28) * torso.secao.perimetro
            cy_ = rng.uniform(y_mamilos - 120.0, -20.0)
            if all(np.hypot(cs_ - m[0], cy_ - m[1]) > 45.0 for m in mamilos):
                break
        raio = rng.uniform(0.7, 1.5)
        cs, cy = _caixa(s, cs_ - 4 * raio, cs_ + 4 * raio), _caixa(y, cy_ - 4 * raio, cy_ + 4 * raio)
        S, Y = np.meshgrid(s[cs], y[cy])
        t = 1.0 - _smooth((np.hypot(S - cs_, Y - cy_) - 0.6 * raio) / (0.8 * raio))
        log_alb[cy, cs] += (t[..., None] * np.array([-0.95, -1.2, -1.3])).astype(_F32)

    # --- relevo fino (mm): microtextura da pele (poros) + areola + tuberculos + mamilo
    relevo = _F32(-0.03) * poros
    del poros
    r_a, r_m = areola_mm / 2.0, mamilo_mm / 2.0
    for mama in torso.mamas:
        sm, ym = mama.param_mamilo()
        caixa = r_a + 8.0
        cs, cy = _caixa(s, sm - caixa, sm + caixa), _caixa(y, ym - caixa, ym + caixa)
        S, Y = np.meshgrid(s[cs], y[cy])
        d = distancia_ao_mamilo(torso, mama, S, Y)       # (s, y) -> superficie -> distancia 3D ao mamilo
        du, dv = mama.lado * (S - sm), Y - ym
        teta = np.arctan2(dv, du)
        irreg = np.zeros_like(d)
        for k in range(3, 7):
            irreg += rng.uniform(-1, 1) / k * np.cos(k * teta + rng.uniform(0, 2 * np.pi))
        irreg *= 0.45 / sum(1.0 / k for k in range(3, 7))
        t_ar = 1.0 - _smooth((d - (r_a + irreg - BORDA_AREOLA_MM / 2)) / BORDA_AREOLA_MM)
        t_mm = 1.0 - _smooth((d - (r_m - BORDA_MAMILO_MM / 2)) / BORDA_MAMILO_MM)

        # areola: cor propria com papilas, anel externo um pouco mais escuro
        grao = ruido.campo(0.9, cy, cs).astype(np.float64)
        log_ar = areola[None, None, :] + (0.035 * grao - 0.06 * _smooth((d - 0.6 * r_a) / (0.4 * r_a)))[..., None]
        # tuberculos de Montgomery (8-12): mais claros e levemente mais rosados, relevo ~0,45 mm
        n_tub = int(rng.integers(8, 13))
        fase = rng.uniform(0, 2 * np.pi)
        tub = np.zeros_like(d)
        for k in range(n_tub):
            ang = fase + 2 * np.pi * (k + rng.uniform(-0.3, 0.3)) / n_tub
            rr = rng.uniform(0.48, 0.82) * r_a
            rho = rng.uniform(0.8, 1.3)
            dd = np.hypot(du - rr * np.cos(ang), dv - rr * np.sin(ang))
            tub = np.maximum(tub, np.clip(1.0 - (dd / rho) ** 2, 0.0, 1.0) * rng.uniform(0.7, 1.0))
        log_ar = log_ar + tub[..., None] * (0.15 * (pele - areola) + 0.03)
        # mamilo: cor propria, rugas radiais
        rugas = np.cos(9.0 * teta + 2.0 * grao) * np.exp(-((d / r_m) ** 2))
        log_mm = mamilo[None, None, :] + (0.06 * rugas - 0.05 * _smooth(1 - d / r_m))[..., None]

        # mistura em log (densidade de pigmento): pele -> areola -> mamilo
        la = log_alb[cy, cs].astype(np.float64)
        la = (1 - t_ar)[..., None] * la + t_ar[..., None] * log_ar
        la = (1 - t_mm)[..., None] * la + t_mm[..., None] * log_mm
        log_alb[cy, cs] = la

        # relevo: papilas da areola, tuberculos, mamilo (~4 mm) com rugas
        rel = relevo[cy, cs] + t_ar * (0.05 * grao) + 0.35 * tub
        rel += 4.0 * np.clip(1.0 - (d / (r_m + 0.6)) ** 2, 0.0, 1.0) ** 1.5 + 0.12 * rugas * t_mm
        relevo[cy, cs] = rel

    # --- sombra da prega inframamaria: funcao da distancia abaixo da linha do sulco (borda inferior
    # da pegada), atenuada nas pontas medial e lateral e proporcional ao "balanco" da mama
    sombra = np.ones((H, W), _F32)
    for mama in torso.mamas:
        su = sorted((mama.lado * (mama.s_mamilo - mama.e_med), mama.lado * (mama.s_mamilo + mama.e_lat)))
        cs = _caixa(s, su[0], su[1])
        cy = _caixa(y, mama.y_apice - mama.e_inf - 8 * SOMBRA_SULCO_MM, mama.y_apice)
        S, Y = np.meshgrid(s[cs], y[cy])
        du = mama.lado * S - mama.s_mamilo
        q = np.clip(np.abs(du) / np.where(du > 0, mama.e_lat, mama.e_med), 0.0, 1.0)
        abaixo = mama.y_apice - mama.e_inf * np.sqrt(1.0 - q * q) - Y
        perfil = np.where(abaixo >= 0, np.exp(-np.maximum(abaixo, 0) / SOMBRA_SULCO_MM),
                          np.exp(np.minimum(abaixo, 0) / 1.5))
        forca = SOMBRA_SULCO * min(1.0, mama.H / 35.0)
        sombra[cy, cs] *= (1.0 - forca * perfil * _smooth((1.0 - q) / 0.35)).astype(_F32)

    # --- por faixas de linhas: normal perturbada pelo relevo, luz assada (SH9) x sombra x brilho, sRGB
    gs = (np.roll(relevo, -1, axis=1) - np.roll(relevo, 1, axis=1)) / _F32(2.0 * ds)
    gy = np.gradient(relevo, axis=0) / _F32(-dy)
    del relevo
    sh = sh9_gravada()
    sh32 = sh.astype(_F32)
    meio = _normalizar(np.array([0.0, 0.40, 0.73]) + np.array([0.0, 0.0, 1.0])).astype(_F32)
    saida = np.empty((H, W, 3), np.uint8)
    for i0 in range(0, H, FAIXA_LINHAS):
        i1 = min(H, i0 + FAIXA_LINHAS)
        N, Ts, Ty, cs_, cy_ = geo.faixa(i0, i1)
        Nr = _normalizar(N - (gs[i0:i1] / cs_)[..., None] * Ts - (gy[i0:i1] / cy_)[..., None] * Ty)
        luz = np.maximum(irradiancia_sh9(Nr, sh32), _F32(0.02))
        luz *= _F32(1.0) + _F32(BRILHO) * np.clip(Nr @ meio, 0.0, 1.0) ** 16
        luz *= sombra[i0:i1]
        lin = np.exp(log_alb[i0:i1])
        lin *= luz[..., None]
        saida[i0:i1] = _para_srgb8(lin)
    del geo, gs, gy, sombra, log_alb
    imagem = Image.fromarray(saida)
    bloco = {
        "esquema": ESQUEMA,
        "realismo": "fotografico",
        "sh9": [round(float(v), 6) for v in sh],
        "r2": 1.0,
        "origem": "sintetico",
        "fototipo": fototipo,
        "px_por_mm": float(px_por_mm),
        "largura_px": int(W),
        "altura_px": int(H),
        "areola_mm": float(areola_mm),
        "mamilo_mm": float(mamilo_mm),
    }
    return imagem, bloco
