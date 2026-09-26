"""Antropometria de referencia (contratos §1.1, §2, §3; ADR 0011): distancias euclidianas e
geodesicas (MMP), volume `plano_base_elipse` com incerteza e quadro anatomico.
"""

from __future__ import annotations

import numpy as np

from mesh.malha.geometria import Proximidade
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


def volume_plano_base_elipse(V: np.ndarray, F: np.ndarray, lm: dict, lado: str) -> float | None:
    """Estimador de referencia do contratos §3.2, em mL. None se faltar landmark da base.

    Plano pela base medial, base lateral e sulco do lado; regiao = vertices cuja projecao cai na
    elipse (a = base/2 na direcao medial-lateral; b = componente de (sulco - centro) perpendicular,
    no plano); volume = soma, nas faces com os 3 vertices na regiao, de area projetada x altura media
    (alturas negativas contam zero). A normal do plano aponta para o mamilo do mesmo lado.
    """
    bm, bl, su, mam = (_pos(lm, f"{n}_{lado}") for n in ("base_medial", "base_lateral", "sulco", "mamilo"))
    if bm is None or bl is None or su is None:
        return None
    e1 = _normalizar(bl - bm)
    n = _normalizar(np.cross(bl - bm, su - bm))
    ref = mam if mam is not None else (bm + bl) / 2 + np.array([0.0, 0.0, 1.0])
    if np.dot(ref - bm, n) < 0:
        n = -n
    e2 = np.cross(n, e1)
    c = (bm + bl) / 2
    a = float(np.linalg.norm(bl - bm) / 2)
    b = float(abs(np.dot(su - c, e2)))
    if a < 1e-6 or b < 1e-6:
        return 0.0
    d = V - c
    x, y, h = d @ e1, d @ e2, d @ n
    dentro = (x / a) ** 2 + (y / b) ** 2 <= 1.0
    fs = dentro[F].all(axis=1)
    Ff = F[fs]
    if len(Ff) == 0:
        return 0.0
    x0, x1, x2 = x[Ff[:, 0]], x[Ff[:, 1]], x[Ff[:, 2]]
    y0, y1, y2 = y[Ff[:, 0]], y[Ff[:, 1]], y[Ff[:, 2]]
    area = 0.5 * np.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0))
    hm = np.maximum(h[Ff], 0.0).mean(axis=1)
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
            v = volume_plano_base_elipse(Vw, Fw, lm, lado)
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
