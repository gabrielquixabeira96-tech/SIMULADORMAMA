"""Antropometria de referencia (contratos §1.1, §2, §3; ADR 0011): distancias euclidianas e
geodesicas (MMP), volume `plano_base_elipse` com incerteza e quadro anatomico.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from mesh.malha.geometria import Proximidade, normais_vertices
from mesh.medir import geodesica as geo

LANDMARKS = ("furcula", "mamilo_dir", "mamilo_esq", "sulco_dir", "sulco_esq", "linha_media_inferior",
             "base_medial_dir", "base_lateral_dir", "base_medial_esq", "base_lateral_esq")
OBRIGATORIOS = LANDMARKS[:6]

DISTANCIAS: dict[str, tuple[str, str]] = {
    "ssn_n_dir": ("furcula", "mamilo_dir"),
    "ssn_n_esq": ("furcula", "mamilo_esq"),
    "n_imf_dir": ("mamilo_dir", "sulco_dir"),
    "n_imf_esq": ("mamilo_esq", "sulco_esq"),
    "base_dir": ("base_medial_dir", "base_lateral_dir"),
    "base_esq": ("base_medial_esq", "base_lateral_esq"),
    "intermamilar": ("mamilo_dir", "mamilo_esq"),
}
METODO_VOLUME = "plano_base_elipse"


def _pos(lm: dict, nome: str) -> np.ndarray | None:
    item = lm.get(nome)
    if item is None:
        return None
    p = item["posicao"] if isinstance(item, dict) else item
    return np.asarray(p, dtype=np.float64)


def _normalizar(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise ValueError("vetor nulo ao montar quadro anatomico")
    return v / n


def quadro_anatomico(lm: dict) -> dict | None:
    """Formula de referencia do contratos §1.1 (os dois lados DEVEM implementa-la identicamente)."""
    f, me, md, lmi = (_pos(lm, n) for n in ("furcula", "mamilo_esq", "mamilo_dir", "linha_media_inferior"))
    if any(v is None for v in (f, me, md, lmi)):
        return None
    y0 = _normalizar(f - lmi)
    x0 = _normalizar(me - md)
    z = _normalizar(np.cross(x0, y0))
    x = np.cross(y0, z)
    y = y0
    R = np.column_stack([x, y, z])
    t = -R.T @ f
    M = np.eye(4)
    M[:3, :3] = R.T
    M[:3, 3] = t
    return {
        "origem": np.round(f, 4).tolist(),
        "x": np.round(x, 6).tolist(),
        "y": np.round(y, 6).tolist(),
        "z": np.round(z, 6).tolist(),
        "matriz": [float(round(v, 6)) for v in M.T.reshape(-1)],  # coluna-major
    }


def euclidianas(lm: dict) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for k, (a, b) in DISTANCIAS.items():
        pa, pb = _pos(lm, a), _pos(lm, b)
        out[k] = None if pa is None or pb is None else float(np.linalg.norm(pb - pa))
    return out


@dataclass
class QuadroBase:
    """Referencial da base mamaria de um lado (contratos §3.2).

    c = ponto medio base medial–lateral; e1 = medial -> lateral; n = normal do plano (base medial,
    base lateral, sulco) orientada para o mamilo; e2 = n x e1 re-orientado para ficar cranial
    (mesmo sentido do eixo Y anatomico), o que torna os quadros dir/esq imagens especulares.
    a = base/2; b = |(sulco - c) . e2|.
    """

    c: np.ndarray
    e1: np.ndarray
    e2: np.ndarray
    n: np.ndarray
    a: float
    b: float
    cranial: np.ndarray  # eixo Y anatomico (furcula - linha_media_inferior), ou e2 se faltar

    def coords(self, P: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        d = np.asarray(P, dtype=np.float64) - self.c
        return d @ self.e1, d @ self.e2, d @ self.n


def quadro_base(lm: dict, lado: str) -> QuadroBase | None:
    bm, bl, su, mam = (_pos(lm, f"{n}_{lado}") for n in ("base_medial", "base_lateral", "sulco", "mamilo"))
    if bm is None or bl is None or su is None:
        return None
    e1 = _normalizar(bl - bm)
    n = _normalizar(np.cross(bl - bm, su - bm))
    ref = mam if mam is not None else (bm + bl) / 2 + np.array([0.0, 0.0, 1.0])
    if np.dot(ref - bm, n) < 0:
        n = -n
    f, lmi = _pos(lm, "furcula"), _pos(lm, "linha_media_inferior")
    cranial = _normalizar(f - lmi) if f is not None and lmi is not None else None
    e2 = np.cross(n, e1)
    if cranial is not None and np.dot(e2, cranial) < 0:
        e2 = -e2
    if cranial is None:
        cranial = e2 if e2[1] >= 0 else -e2
    c = (bm + bl) / 2
    return QuadroBase(c=c, e1=e1, e2=e2, n=n, a=float(np.linalg.norm(bl - bm) / 2),
                      b=float(abs(np.dot(su - c, e2))), cranial=cranial)


# parametros do estimador v2 (ADR 0012); geometricos, nao clinicos
PAREDE_GRAU = 3                 # polinomio cubico em (x/a, y/b)
PAREDE_ANEL = (1.05, 1.30)      # anel periferico (raio eliptico normalizado) usado no ajuste
REGIAO_INTEGRACAO = 1.05        # raio eliptico normalizado da regiao integrada
PAREDE_MIN_PONTOS = 30


def _base_polinomial(x: np.ndarray, y: np.ndarray, grau: int) -> np.ndarray:
    cols = [np.ones_like(x)]
    for k in range(1, grau + 1):
        for i in range(k + 1):
            cols.append(x ** (k - i) * y ** i)
    return np.stack(cols, axis=1)


def parede_reconstruida(q: QuadroBase, x: np.ndarray, y: np.ndarray, h: np.ndarray, frente: np.ndarray):
    """Ajusta h_parede(x, y) (cubico) ao anel periferico da base, com rejeicao robusta de pontos
    acima da parede (tecido mamario que vaza para o anel) e de dobras. Devolve (funcao, dp_mm, n_pontos)
    ou None se o anel tiver pontos de menos."""
    xn, yn = x / q.a, y / q.b
    r = np.sqrt(xn**2 + yn**2)
    anel = (r >= PAREDE_ANEL[0]) & (r <= PAREDE_ANEL[1]) & frente
    if anel.sum() < PAREDE_MIN_PONTOS:
        return None
    A = _base_polinomial(xn[anel], yn[anel], PAREDE_GRAU)
    z = h[anel]
    usar = np.ones(len(z), dtype=bool)
    coef = np.zeros(A.shape[1])
    dp = 0.0
    for _ in range(8):
        if usar.sum() < A.shape[1] + 5:
            break
        coef, *_ = np.linalg.lstsq(A[usar], z[usar], rcond=None)
        res = z - A @ coef
        med = np.median(res[usar])
        dp = float(1.4826 * np.median(np.abs(res[usar] - med)) + 1e-3)
        novo = (res < med + 2.5 * dp) & (res > med - 4.0 * dp)
        if np.array_equal(novo, usar):
            break
        usar = novo

    def funcao(xx: np.ndarray, yy: np.ndarray) -> np.ndarray:
        return _base_polinomial(xx / q.a, yy / q.b, PAREDE_GRAU) @ coef

    return funcao, dp, int(usar.sum())


def volume_plano_base_elipse(V: np.ndarray, F: np.ndarray, lm: dict, lado: str,
                             parede: str = "reconstruida", diagnostico: dict | None = None) -> float | None:
    """Estimador de volume do contratos §3.2 (v2, ADR 0012), em mL. None se faltar landmark da base.

    Quadro: plano pela base medial, base lateral e sulco (QuadroBase); regiao = faces frontais cuja
    projecao cai na elipse da base ampliada 5 %. v2: a altura de referencia deixa de ser o plano
    (que corta a parede toracica curva e contava a "lente" de parede como mama, +35–45 % nos
    sinteticos) e passa a ser a **parede reconstruida** por um polinomio cubico ajustado ao anel
    periferico da base (1,05–1,30 do raio eliptico), com rejeicao robusta. Volume = soma de area
    projetada x altura media acima da parede (negativas = 0). `parede="plano"` reproduz o v1.
    """
    q = quadro_base(lm, lado)
    if q is None:
        return None
    if q.a < 1e-6 or q.b < 1e-6:
        return 0.0
    x, y, h = q.coords(V)
    N = normais_vertices(V, F)
    frente = (N @ q.n) > 0.2
    href = np.zeros_like(h)
    regiao = 1.0
    if parede == "reconstruida":
        ajuste = parede_reconstruida(q, x, y, h, frente)
        if ajuste is None:
            if diagnostico is not None:
                diagnostico["aviso"] = f"volume_{lado}:anel_insuficiente_parede_plana"
        else:
            funcao, dp, npts = ajuste
            href = funcao(x, y)
            regiao = REGIAO_INTEGRACAO
            if diagnostico is not None:
                diagnostico.update({"parede_dp_mm": dp, "parede_pontos": npts})
    dentro = (x / q.a) ** 2 + (y / q.b) ** 2 <= regiao**2
    fs = dentro[F].all(axis=1)
    if parede == "reconstruida":
        fs &= frente[F].all(axis=1)
    Ff = F[fs]
    if len(Ff) == 0:
        return 0.0
    x0, x1, x2 = x[Ff[:, 0]], x[Ff[:, 1]], x[Ff[:, 2]]
    y0, y1, y2 = y[Ff[:, 0]], y[Ff[:, 1]], y[Ff[:, 2]]
    area = 0.5 * np.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0))
    hm = np.maximum(h[Ff] - href[Ff], 0.0).mean(axis=1)
    return float((area * hm).sum() / 1000.0)


def medir(Vw: np.ndarray, Fw: np.ndarray, lm: dict, incluir_geodesica: bool = True,
          incluir_volume: bool = True, fator_incerteza: float = 0.15,
          prox: Proximidade | None = None) -> dict:
    """Calcula distancias (euclidiana + geodesica MMP), volumes e quadro anatomico na malha soldada."""
    avisos: list[str] = []
    eu = euclidianas(lm)
    pares = {k: DISTANCIAS[k] for k, v in eu.items() if v is not None}
    geod: dict[str, float] = {}
    if incluir_geodesica and pares:
        pontos = {n: _pos(lm, n) for par in pares.values() for n in par}
        geod = geo.geodesicas_entre_pontos(Vw, Fw, pontos, pares, prox=prox)
    distancias: dict = {}
    for k, v in eu.items():
        if v is None:
            distancias[k] = None
        else:
            g = geod.get(k)
            distancias[k] = {"euclidiana_mm": round(v, 2), "geodesica_mm": None if g is None else round(g, 2)}
    volumes = None
    if incluir_volume:
        volumes = {}
        for lado in ("dir", "esq"):
            diag: dict = {}
            v = volume_plano_base_elipse(Vw, Fw, lm, lado, diagnostico=diag)
            if "aviso" in diag:
                avisos.append(diag["aviso"])
            if v is None:
                volumes[lado] = None
                avisos.append(f"volume_{lado}:landmarks_da_base_ausentes")
            else:
                volumes[lado] = {"valor_ml": round(v, 1), "incerteza_ml": round(v * fator_incerteza, 1),
                                 "metodo": METODO_VOLUME}
    return {
        "distancias": distancias,
        "volumes": volumes,
        "quadro_anatomico": quadro_anatomico(lm),
        "avisos": avisos,
        "_geodesicas_brutas": geod,
        "_euclidianas_brutas": eu,
    }
