"""Modelo geometrico-parametrico v1 (`geometrico_parametrico_v1`; contratos §9; ADR 0014).

Todos os coeficientes vem de config/simulacao.json e sao `nao_calibrado`. E ilustracao, nao
previsao. Para cada lado implantado:

1. **Referencial**: `QuadroBase` do lado (plano base medial / base lateral / sulco; e1 medial->lateral,
   e2 cranial, n anterior) e eixo cranial anatomico (furcula - linha media inferior). A direcao de
   empurrao anterior e `n` sem a componente cranial (`d_ant`), para que deslocamentos anteriores nao
   mexam em Y.
2. **Forma do implante** (`perfil_implante`): pegada eliptica base x altura; altura
   h = P * (1 - rho^k)^gama, com gama = `borda_implante_expoente` (0,5 = borda elipsoidal, o
   "elipsoide truncado") e k resolvido para que o volume da forma seja o `volume_ml` do catalogo.
   Anatomico: apice a `ponto_max_projecao_fator` da altura, de cima para baixo (polo inferior cheio).
3. **Posicao na parede**: pegada centrada no ponto medio da base (medial-lateral) com a borda inferior
   no sulco (novo, se rebaixado).
4. **Tecido mole**: a pele recebe o campo de altura do implante com pegada alargada
   (`alargamento_base_fator`), volume transmitido = V * `transmissao_projecao_fator` * fator de
   tecido (pincamento; `tecido_mole`), polo superior atenuado (`preenchimento_polo_superior_fator`)
   e suavizado por gaussiana (`suavizacao_sigma_mm`). Abaixo do sulco a pele nao e empurrada
   (transicao de `imf_transicao_mm`), o que mantem a prega.
5. **Mamilo**: ajuste por nucleo compacto ~gaussiano (sigma = `mamilo_sigma_fator` * base) que leva o mamilo a um
   deslocamento anterior = `deslocamento_mamilo_anterior_fator` * P_efetiva e cranial =
   `deslocamento_mamilo_cranial_fator` * P_efetiva.
6. **Sulco** (`imf=rebaixar`): translacao caudal de min(`mm_por_100ml` * V / 100, `maximo_mm`) no
   sulco, decaindo em gaussiana (lateral, cranial e caudal) e com a profundidade.

Propriedades garantidas (testadas): monotonicidade (P maior -> mamilo mais projetado), simetria
(o campo e equivariante a espelhamento em X), `manter` nao move o sulco, `rebaixar` o move exatamente
o valor configurado.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy.interpolate import RegularGridInterpolator
from scipy.ndimage import gaussian_filter
from scipy.optimize import brentq
from scipy.special import beta as fbeta

from mesh import esquemas
from mesh.medir.antropometria import QuadroBase, _pos, quadro_base
from mesh.simulacao.interfaces import Implante, ResultadoSimulacao

MODELO = "geometrico_parametrico_v1"
PASSO_GRADE_MM = 1.0
# Chaves obrigatorias de `modelo_geometrico` em config/simulacao.json (sem valor padrao no codigo:
# todo coeficiente e `nao_calibrado` e vive na config; chave ausente -> ErroSimulacao).
CHAVES_MODELO = (
    "borda_implante_expoente", "imf_transicao_mm", "mamilo_sigma_fator", "rebaixar_sigma_lateral_fator",
    "rebaixar_decaimento_cranial_fator", "rebaixar_decaimento_caudal_fator", "profundidade_sigma_mm",
    "frente_profundidade_min_mm", "frente_profundidade_rampa_mm", "frente_normal_rampa",
)


def _nucleo(r2: np.ndarray, sigma: float) -> np.ndarray:
    """Nucleo de suporte compacto ~gaussiano: (1 - r^2/R^2)^3, R = 3 sigma; zero alem de R (o lado
    oposto e as costas ficam exatamente intactos)."""
    R2 = (3.0 * sigma) ** 2
    return np.where(r2 < R2, (1.0 - r2 / R2) ** 3, 0.0)


class ErroSimulacao(ValueError):
    pass


def _coef(config: dict, *caminho: str) -> float:
    """Coeficiente `{valor, nao_calibrado}` da config; ausente -> ErroSimulacao (sem fallback)."""
    no: object = config
    for k in caminho:
        if not isinstance(no, dict) or k not in no:
            raise ErroSimulacao("config_simulacao_incompleta:" + ".".join(caminho))
        no = no[k]
    if not (isinstance(no, dict) and "valor" in no):
        raise ErroSimulacao("config_simulacao_incompleta:" + ".".join(caminho) + ".valor")
    return float(no["valor"])


@dataclass(frozen=True)
class Coefs:
    transmissao: float
    alargamento: float
    polo_superior: float
    mamilo_anterior: float
    mamilo_cranial: float
    sigma_mm: float
    rebaixar_mm_por_100ml: float
    rebaixar_max_mm: float
    espessura_ref_mm: float
    atenuacao_por_mm: float
    ponto_max_anatomico: float
    gama: float
    imf_transicao_mm: float
    mamilo_sigma_fator: float
    rebaixar_sigma_lateral: float
    rebaixar_cranial: float
    rebaixar_caudal: float
    prof_sigma_mm: float
    frente_prof_min_mm: float
    frente_prof_rampa_mm: float
    frente_normal_rampa: float
    versao: str


def coeficientes(config: dict, plano: str) -> Coefs:
    """Todos os coeficientes vem de config/simulacao.json; qualquer chave ausente -> ErroSimulacao."""
    if plano not in config.get("planos", {}):
        raise ErroSimulacao(f"plano desconhecido: {plano}")
    mg = {k: _coef(config, "modelo_geometrico", k) for k in CHAVES_MODELO}
    return Coefs(
        transmissao=_coef(config, "planos", plano, "transmissao_projecao_fator"),
        alargamento=_coef(config, "planos", plano, "alargamento_base_fator"),
        polo_superior=_coef(config, "planos", plano, "preenchimento_polo_superior_fator"),
        mamilo_anterior=_coef(config, "planos", plano, "deslocamento_mamilo_anterior_fator"),
        mamilo_cranial=_coef(config, "planos", plano, "deslocamento_mamilo_cranial_fator"),
        sigma_mm=_coef(config, "planos", plano, "suavizacao_sigma_mm"),
        rebaixar_mm_por_100ml=_coef(config, "imf", "rebaixar", "mm_por_100ml"),
        rebaixar_max_mm=_coef(config, "imf", "rebaixar", "maximo_mm"),
        espessura_ref_mm=_coef(config, "tecido_mole", "espessura_referencia_mm"),
        atenuacao_por_mm=_coef(config, "tecido_mole", "atenuacao_por_mm_pinca_fator"),
        ponto_max_anatomico=_coef(config, "implante", "forma_anatomica", "ponto_max_projecao_fator"),
        gama=mg["borda_implante_expoente"], imf_transicao_mm=mg["imf_transicao_mm"],
        mamilo_sigma_fator=mg["mamilo_sigma_fator"], rebaixar_sigma_lateral=mg["rebaixar_sigma_lateral_fator"],
        rebaixar_cranial=mg["rebaixar_decaimento_cranial_fator"],
        rebaixar_caudal=mg["rebaixar_decaimento_caudal_fator"],
        prof_sigma_mm=mg["profundidade_sigma_mm"], frente_prof_min_mm=mg["frente_profundidade_min_mm"],
        frente_prof_rampa_mm=mg["frente_profundidade_rampa_mm"], frente_normal_rampa=mg["frente_normal_rampa"],
        versao=str(config.get("versao", "?")),
    )


def _smooth(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------- forma do implante

def media_perfil(k: float, gama: float) -> float:
    """Media de (1 - rho^k)^gama sobre o disco unitario = (2/k) * B(2/k, gama + 1)."""
    return float(2.0 / k * fbeta(2.0 / k, gama + 1.0))


@lru_cache(maxsize=1024)
def expoente_perfil(volume_ml: float, base_mm: float, altura_mm: float, projecao_mm: float,
                    gama: float) -> tuple[float, bool]:
    """k tal que o volume da forma = volume do catalogo. Devolve (k, ajustado_no_limite)."""
    area = np.pi * base_mm * altura_mm / 4.0
    alvo = volume_ml * 1000.0 / (projecao_mm * area)
    kmin, kmax = 0.3, 200.0
    lo, hi = media_perfil(kmin, gama), media_perfil(kmax, gama)
    if alvo <= lo:
        return kmin, True
    if alvo >= hi:
        return kmax, True
    return float(brentq(lambda k: media_perfil(k, gama) - alvo, kmin, kmax, xtol=1e-9)), False


def perfil_implante(implante: dict, x: np.ndarray, y: np.ndarray, c: Coefs, escala: float = 1.0) -> np.ndarray:
    """Altura do implante (mm) sobre a pegada, com o apice em (0, 0); x lateral, y cranial.
    `escala` alarga a pegada (a projecao nao muda)."""
    B, H, P = float(implante["base_mm"]), float(implante["altura_mm"]), float(implante["projecao_mm"])
    k, _ = expoente_perfil(float(implante["volume_ml"]), B, H, P, c.gama)
    if implante["forma"] == "anatomica":
        sup, inf = c.ponto_max_anatomico * H, (1 - c.ponto_max_anatomico) * H
    else:
        sup = inf = H / 2
    ay = np.where(y > 0, sup, inf) * escala
    ax = B / 2 * escala
    rho = np.sqrt((x / ax) ** 2 + (y / ay) ** 2)
    return np.where(rho < 1, P * np.power(np.clip(1 - rho**k, 0, 1), c.gama), 0.0)


def extensoes(implante: dict, c: Coefs) -> tuple[float, float]:
    """(extensao acima do apice, abaixo do apice) em mm, sem alargamento."""
    H = float(implante["altura_mm"])
    if implante["forma"] == "anatomica":
        return c.ponto_max_anatomico * H, (1 - c.ponto_max_anatomico) * H
    return H / 2, H / 2


# ----------------------------------------------------------------------------- campo por lado

@dataclass
class CampoLado:
    lado: str
    q: QuadroBase
    d_ant: np.ndarray
    cranial: np.ndarray
    sulco: np.ndarray
    mamilo: np.ndarray
    delta_imf_mm: float
    interp: RegularGridInterpolator
    beta_mm: float
    cranial_mm: float
    sigma_mamilo: float
    sx_imf: float
    sy_cran: float
    sy_caud: float
    transicao: float
    prof_sigma_mm: float
    frente_prof_min_mm: float
    frente_prof_rampa_mm: float
    frente_normal_rampa: float
    aviso: str | None = None

    def _mascara_imf(self, P: np.ndarray) -> np.ndarray:
        acima = (P - self.sulco) @ self.cranial + self.delta_imf_mm
        return _smooth(acima / self.transicao)

    def _frente(self, N: np.ndarray, h: np.ndarray) -> np.ndarray:
        """Peso da pele anterior: normal voltada para frente E nao muito atras do plano da base
        (exclui flanco e costas, cujas normais podem ter componente em n)."""
        return (_smooth((N @ self.q.n) / self.frente_normal_rampa)
                * _smooth((h - self.frente_prof_min_mm) / self.frente_prof_rampa_mm))

    def deslocamento(self, P: np.ndarray, N: np.ndarray) -> np.ndarray:
        x, y, h = self.q.coords(P)
        A = self.interp(np.column_stack([x, y]))
        fr = self._frente(N, h)
        m = self._mascara_imf(P) * fr
        # ajuste do mamilo (nucleo compacto no plano da base, com decaimento em profundidade)
        xm, ym, hm = self.q.coords(self.mamilo[None, :])
        r2 = (x - xm[0]) ** 2 + (y - ym[0]) ** 2
        g = _nucleo(r2, self.sigma_mamilo) * _nucleo((h - hm[0]) ** 2, self.prof_sigma_mm)
        # o termo cranial usa a mascara do sulco ORIGINAL: o sulco so se move pelo rebaixamento
        m_orig = _smooth(((P - self.sulco) @ self.cranial) / self.transicao) * fr
        D = (((A + self.beta_mm * g) * m)[:, None] * self.d_ant
             + (self.cranial_mm * g * m_orig)[:, None] * self.cranial)
        if self.delta_imf_mm > 0:
            rel = P - self.sulco
            xs = rel @ self.q.e1
            ys = rel @ self.cranial
            hs = rel @ self.q.n
            sy = np.where(ys >= 0, self.sy_cran, self.sy_caud)
            gi = _nucleo(xs**2, self.sx_imf) * _nucleo(ys**2, sy) * _nucleo(hs**2, self.prof_sigma_mm)
            D = D - (self.delta_imf_mm * gi)[:, None] * self.cranial
        return D


def montar_campo(lm: dict, lado: str, implante: dict, plano: str, imf: str, config: dict,
                 pinca_mm: float | None = None) -> CampoLado:
    c = coeficientes(config, plano)
    q = quadro_base(lm, lado)
    mamilo, sulco = _pos(lm, f"mamilo_{lado}"), _pos(lm, f"sulco_{lado}")
    if q is None or mamilo is None or sulco is None:
        raise ErroSimulacao("landmarks_da_base_ausentes")
    cranial = q.cranial
    d_ant = q.n - (q.n @ cranial) * cranial
    d_ant /= np.linalg.norm(d_ant)
    V_ml = float(implante["volume_ml"])
    delta = min(c.rebaixar_mm_por_100ml * V_ml / 100.0, c.rebaixar_max_mm) if imf == "rebaixar" else 0.0
    if imf not in ("manter", "rebaixar"):
        raise ErroSimulacao(f"imf desconhecido: {imf}")
    f_tec = 1.0
    if pinca_mm is not None:
        f_tec = float(np.clip(1.0 - c.atenuacao_por_mm * (pinca_mm - c.espessura_ref_mm), 0.5, 1.2))
    P_ef = float(implante["projecao_mm"]) * c.transmissao * f_tec

    # pegada: centro medial-lateral na base; borda inferior no sulco (novo)
    sulco_novo = sulco - delta * cranial
    y_sulco_novo = float((sulco_novo - q.c) @ q.e2)
    sup, inf = extensoes(implante, c)
    esc = c.alargamento
    y_apice = y_sulco_novo + inf * esc
    B = float(implante["base_mm"])
    margem = 4 * c.sigma_mm + 5
    xs = np.arange(-B / 2 * esc - margem, B / 2 * esc + margem + PASSO_GRADE_MM, PASSO_GRADE_MM)
    ys = np.arange(y_apice - inf * esc - margem, y_apice + sup * esc + margem + PASSO_GRADE_MM, PASSO_GRADE_MM)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    h = perfil_implante(implante, X, Y - y_apice, c, escala=esc) * c.transmissao * f_tec / esc**2
    w_sup = 1 - (1 - c.polo_superior) * _smooth((Y - y_apice) / (sup * esc))
    campo = gaussian_filter(h * w_sup, sigma=c.sigma_mm / PASSO_GRADE_MM, mode="constant")
    interp = RegularGridInterpolator((xs, ys), campo, bounds_error=False, fill_value=0.0)

    n_imf = float(np.linalg.norm(mamilo - sulco))
    cl = CampoLado(lado=lado, q=q, d_ant=d_ant, cranial=cranial, sulco=sulco, mamilo=mamilo, delta_imf_mm=delta,
                   interp=interp, beta_mm=0.0, cranial_mm=0.0, sigma_mamilo=c.mamilo_sigma_fator * B,
                   sx_imf=c.rebaixar_sigma_lateral * B, sy_cran=c.rebaixar_cranial * n_imf,
                   sy_caud=c.rebaixar_caudal * n_imf, transicao=c.imf_transicao_mm, prof_sigma_mm=c.prof_sigma_mm,
                   frente_prof_min_mm=c.frente_prof_min_mm, frente_prof_rampa_mm=c.frente_prof_rampa_mm,
                   frente_normal_rampa=c.frente_normal_rampa)
    # ajuste do mamilo: alvo anterior e cranial (a normal no mamilo e tomada como d_ant: frente = 1)
    xm, ym, _ = q.coords(mamilo[None, :])
    a_n = float(interp(np.array([[xm[0], ym[0]]]))[0])
    m_n = float(cl._mascara_imf(mamilo[None, :])[0])
    m_o = float(_smooth(((mamilo - sulco) @ cranial) / c.imf_transicao_mm))
    cl.beta_mm = c.mamilo_anterior * P_ef / m_n - a_n if m_n > 1e-6 else 0.0
    cl.cranial_mm = c.mamilo_cranial * P_ef / m_o if m_o > 1e-6 else 0.0
    return cl


class SimuladorGeometrico:
    """Implementa `SimuladorDeformacao` (contratos §12.1)."""

    modelo = MODELO

    def campos(self, landmarks: dict, implante: dict, plano: str, imf: str, lado: str, config: dict,
               pinca: dict | None = None) -> list[CampoLado]:
        lados = ("dir", "esq") if lado == "ambos" else (lado,)
        return [montar_campo(landmarks, s, implante, plano, imf, config,
                             None if not pinca else pinca.get(s)) for s in lados]

    def simular(self, vertices_mm: np.ndarray, faces: np.ndarray, landmarks: dict, implante: Implante,
                plano: str, imf: str, lado: str, config: dict | None = None,
                normais: np.ndarray | None = None, pinca: dict | None = None) -> ResultadoSimulacao:
        from mesh.malha.geometria import normais_vertices

        config = config or esquemas.config_simulacao()
        V = np.asarray(vertices_mm, dtype=np.float64)
        N = normais if normais is not None else normais_vertices(V, np.asarray(faces))
        campos = self.campos(landmarks, dict(implante), plano, imf, lado, config, pinca)
        D = np.zeros_like(V)
        for cl in campos:
            D += cl.deslocamento(V, N)
        return {"deltas_mm": D.astype(np.float32), "previsto": previsto(campos, landmarks),
                "modelo": MODELO, "nao_calibrado": True}


def previsto(campos: list[CampoLado], lm: dict) -> dict:
    """contratos §10.4: deslocamento anterior do mamilo e deslocamentos em Y (cranial anatomico) de
    mamilo e sulco, por lado, avaliados nas posicoes exatas dos landmarks (normal = n da base; o campo
    do lado oposto e desprezivel a essa distancia e nao entra)."""
    out = {"delta_projecao_mamilo_mm": {"dir": 0.0, "esq": 0.0}, "delta_y_sulco_mm": {"dir": 0.0, "esq": 0.0},
           "delta_y_mamilo_mm": {"dir": 0.0, "esq": 0.0}}
    for lado in ("dir", "esq"):
        mam, sul = _pos(lm, f"mamilo_{lado}"), _pos(lm, f"sulco_{lado}")
        if mam is None or sul is None:
            continue
        ref = next((cl for cl in campos if cl.lado == lado), None)
        if ref is None:
            continue
        D = ref.deslocamento(np.vstack([mam, sul]), np.tile(ref.q.n, (2, 1)))
        out["delta_projecao_mamilo_mm"][lado] = round(float(D[0] @ ref.d_ant), 2)
        out["delta_y_mamilo_mm"][lado] = round(float(D[0] @ ref.cranial), 2)
        out["delta_y_sulco_mm"][lado] = round(float(D[1] @ ref.cranial), 2)
    return out
