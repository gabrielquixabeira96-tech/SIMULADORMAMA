"""Template parametrico do torso para o ajuste a fotos (torso_parametros/1.1; contrato C2).

- `ESPEC`: os parametros livres do ajuste (caminho no dict 1.1, media e desvio do prior fraco,
  limites do esquema, escala tipica). O que nao esta aqui fica no valor de `BASE` (altura do torso,
  semente, resolucao, textura).
- `torso_rapido(p)`: `superficie.Torso` com a secao tabelada em 20 001 amostras (o gerador usa 400 001) e
  as amplitudes das mamas resolvidas pelo volume **exato do poliedro numa grade local da pegada**: com
  os vertices V = A + H B (A = parede + incisura + mamilo, B = forma x normal), o volume adicionado e
  um polinomio cubico em H (divergencia; os termos fora da pegada se cancelam), resolvido por Newton.
  Uma avaliacao custa ~ms (o gerador resolve H por Brent na malha densa inteira, ~s).
- `landmarks_do_template(torso)`: os 10 landmarks exatos da superficie (como o gabarito).
- `malha_do_template(p)`: a malha de desenho pelo mesmo caminho do `gerar_torso` (grade densa ->
  limpeza -> decimacao por quadricas 30-50 mil vertices -> atributos), com UV cilindrica da `Grade`.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from mesh.sintetico.superficie import INCISURA_PROF_MM, MAMILO_SIGMA_MM, Secao, Torso, parede_parametros

ESQUEMA = "torso_parametros/1.1"
LANDMARKS = ("furcula", "mamilo_dir", "mamilo_esq", "sulco_dir", "sulco_esq", "linha_media_inferior",
             "base_medial_dir", "base_lateral_dir", "base_medial_esq", "base_lateral_esq")


@dataclass(frozen=True)
class Param:
    caminho: str
    media: float
    sigma: float
    lo: float
    hi: float
    escala: float


_FORMA = (("base_fator", 1.0, 0.2, 0.6, 1.6, 0.05), ("apice_fator", 0.0, 0.2, -0.4, 0.6, 0.05),
          ("polo_superior_fator", 1.0, 0.25, 0.5, 1.8, 0.05), ("polo_inferior_fator", 1.0, 0.4, 0.0, 2.2, 0.1),
          ("largura_pegada_fator", 1.0, 0.2, 0.6, 1.6, 0.05), ("projecao_fator", 1.0, 0.25, 0.5, 2.0, 0.05))

ESPEC: tuple[Param, ...] = (
    Param("largura_toracica_mm", 300.0, 40.0, 220.0, 420.0, 10.0),
    Param("profundidade_toracica_mm", 200.0, 30.0, 140.0, 300.0, 10.0),
    Param("parede.expoente_secao", 3.0, 0.3, 2.2, 6.0, 0.1),
    Param("parede.achatamento_anterior", 0.0, 0.1, -0.5, 0.8, 0.05),
    Param("volume_ml.dir", 300.0, 250.0, 20.0, 1200.0, 20.0),
    Param("volume_ml.esq", 300.0, 250.0, 20.0, 1200.0, 20.0),
    Param("ptose.dir", 0.3, 0.5, 0.0, 1.0, 0.05),
    Param("ptose.esq", 0.3, 0.5, 0.0, 1.0, 0.05),
    Param("n_imf_mm.dir", 75.0, 25.0, 40.0, 140.0, 5.0),
    Param("n_imf_mm.esq", 75.0, 25.0, 40.0, 140.0, 5.0),
    Param("assimetria.delta_altura_mamilo_mm", 0.0, 15.0, -40.0, 40.0, 2.0),
    Param("assimetria.delta_lateral_mamilo_mm", 0.0, 15.0, -40.0, 40.0, 2.0),
    *(Param(f"forma.{lado}.{n}", m, s, lo, hi, e) for lado in ("dir", "esq") for (n, m, s, lo, hi, e) in _FORMA),
)
N_PARAMS = len(ESPEC)

BASE = {
    "esquema": ESQUEMA,
    "nome": "reconstrucao_foto",
    "semente": 0,
    "largura_toracica_mm": 300.0,
    "altura_torso_mm": 450.0,
    "profundidade_toracica_mm": 200.0,
    "volume_ml": {"dir": 300.0, "esq": 300.0},
    "ptose": {"dir": 0.3, "esq": 0.3},
    "n_imf_mm": {"dir": 75.0, "esq": 75.0},
    "assimetria": {"delta_altura_mamilo_mm": 0.0, "delta_lateral_mamilo_mm": 0.0},
    "resolucao": {"densa_faces": 300000, "decimada_vertices": 40000},
    "textura": {"realismo": "fotografico", "fototipo": "III"},
    "forma": {"dir": {}, "esq": {}},
    "parede": {},
}


def _get(d: dict, caminho: str):
    for k in caminho.split("."):
        d = d.get(k, {}) if isinstance(d, dict) else {}
    return d


def _set(d: dict, caminho: str, v: float) -> None:
    ks = caminho.split(".")
    for k in ks[:-1]:
        d = d.setdefault(k, {})
    d[ks[-1]] = float(v)


def vetor_media() -> np.ndarray:
    return np.array([p.media for p in ESPEC])


def vetor_de_parametros(p: dict) -> np.ndarray:
    out = []
    for e in ESPEC:
        v = _get(p, e.caminho)
        out.append(float(v) if isinstance(v, int | float) else e.media)
    return np.array(out)


def parametros_de_vetor(theta: np.ndarray, base: dict | None = None) -> dict:
    p = copy.deepcopy(BASE if base is None else base)
    for e, v in zip(ESPEC, theta, strict=True):
        _set(p, e.caminho, float(np.clip(v, e.lo, e.hi)))
    p["esquema"] = ESQUEMA
    return p


def limites() -> tuple[np.ndarray, np.ndarray]:
    return np.array([p.lo for p in ESPEC]), np.array([p.hi for p in ESPEC])


# ----------------------------------------------------------------------------- amplitudes (volume exato)

def _caixa_mama(mama) -> tuple[float, float, float, float]:
    sm, ym = mama.param_mamilo()
    su = sorted((mama.lado * (mama.s_mamilo - mama.e_med), mama.lado * (mama.s_mamilo + mama.e_lat)))
    return (min(su[0], sm - 6 * MAMILO_SIGMA_MM) - 1.0, max(su[1], sm + 6 * MAMILO_SIGMA_MM) + 1.0,
            min(mama.y_apice - mama.e_inf, ym - 6 * MAMILO_SIGMA_MM) - 1.0,
            max(mama.y_apice + mama.e_sup, ym + 6 * MAMILO_SIGMA_MM) + 1.0)


def _det(a, b, c) -> np.ndarray:
    return (a[:, 0] * (b[:, 1] * c[:, 2] - b[:, 2] * c[:, 1]) + a[:, 1] * (b[:, 2] * c[:, 0] - b[:, 0] * c[:, 2])
            + a[:, 2] * (b[:, 0] * c[:, 1] - b[:, 1] * c[:, 0]))


def coeficientes_volume(torso: Torso, mama, passo_mm: float = 2.0) -> np.ndarray:
    """Coeficientes (c0, c1, c2, c3) em mm^3 de V_adicionado(H) = c0 + c1 H + c2 H^2 + c3 H^3."""
    s0, s1, y0, y1 = _caixa_mama(mama)
    ns = max(8, int(np.ceil((s1 - s0) / passo_mm)) + 1)
    ny = max(8, int(np.ceil((y1 - y0) / passo_mm)) + 1)
    S, Y = np.meshgrid(np.linspace(s0, s1, ns), np.linspace(y0, y1, ny), indexing="ij")
    P, n = torso.parede(S, Y)
    outra = torso.mama_esq if mama is torso.mama_dir else torso.mama_dir
    h_sem = torso.incisura(S, Y) + outra.altura(S, Y)
    A_sem = P + h_sem[..., None] * n
    A = A_sem + mama.relevo_mamilo(S, Y)[..., None] * n
    B = mama.forma(S, Y)[..., None] * n
    for X in (A_sem, A):
        X[..., 2] += INCISURA_PROF_MM
    idx = np.arange(ns * ny).reshape(ns, ny)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)])
    A_sem, A, B = A_sem.reshape(-1, 3), A.reshape(-1, 3), B.reshape(-1, 3)
    a1, a2, a3 = A[F[:, 0]], A[F[:, 1]], A[F[:, 2]]
    b1, b2, b3 = B[F[:, 0]], B[F[:, 1]], B[F[:, 2]]
    c0 = _det(a1, a2, a3).sum() - _det(A_sem[F[:, 0]], A_sem[F[:, 1]], A_sem[F[:, 2]]).sum()
    c1 = (_det(b1, a2, a3) + _det(a1, b2, a3) + _det(a1, a2, b3)).sum()
    c2 = (_det(a1, b2, b3) + _det(b1, a2, b3) + _det(b1, b2, a3)).sum()
    c3 = _det(b1, b2, b3).sum()
    return np.array([c0, c1, c2, c3]) / 6.0


def resolver_amplitudes(torso: Torso, passo_mm: float = 2.0) -> dict[str, float]:
    """Resolve H de cada mama para o volume pedido (cubica exata na grade local). Devolve os volumes (mL)."""
    volumes = {}
    for mama, chave in ((torso.mama_dir, "dir"), (torso.mama_esq, "esq")):
        alvo = mama.volume_ml * 1000.0
        if alvo <= 0:
            mama.H = 0.0
            volumes[chave] = 0.0
            continue
        c = coeficientes_volume(torso, mama, passo_mm)
        H = max((alvo - c[0]) / max(c[1], 1e-9), 0.0)
        for _ in range(30):
            f = c[0] + H * (c[1] + H * (c[2] + H * c[3])) - alvo
            df = c[1] + H * (2 * c[2] + 3 * H * c[3])
            passo = f / df if df > 0 else 0.0
            H = max(H - passo, 0.0)
            if abs(passo) < 1e-10:
                break
        mama.H = float(H)
        volumes[chave] = float(c[0] + H * (c[1] + H * (c[2] + H * c[3]))) / 1000.0
    return volumes


@lru_cache(maxsize=64)
def _secao(a: float, b: float, q: float, amostras: int, achatamento: float) -> Secao:
    return Secao(a, b, q, amostras, achatamento)


def torso_rapido(p: dict, amostras_secao: int = 20001, passo_mm: float = 3.0) -> Torso:
    pa = parede_parametros(p)
    sec = _secao(float(p["largura_toracica_mm"]) / 2, float(p.get("profundidade_toracica_mm", 200)) / 2,
                 pa["expoente_secao"], amostras_secao, pa["achatamento_anterior"])
    torso = Torso(p, secao=sec)
    resolver_amplitudes(torso, passo_mm)
    return torso


def torso_final(p: dict) -> Torso:
    torso = Torso(p)
    resolver_amplitudes(torso, 0.5)
    return torso


# ----------------------------------------------------------------------------- landmarks

def parametros_landmarks(torso: Torso) -> dict[str, tuple[float, float]]:
    from mesh.sintetico.gerador import _landmarks_parametricos

    return _landmarks_parametricos(torso)


def landmarks_do_template(torso: Torso) -> dict[str, np.ndarray]:
    params = parametros_landmarks(torso)
    nomes = list(params)
    st = np.array([params[k] for k in nomes])
    P = torso.avaliar(st[:, 0], st[:, 1])
    out = {k: P[i] for i, k in enumerate(nomes)}
    out["furcula"] = np.zeros(3)
    return out


# ----------------------------------------------------------------------------- malha

def malha_do_template(p: dict, textura=None, torso: Torso | None = None, alvo_vertices: int = 40000):
    """(MalhaRender decimada com UV [+ textura], torso, malha densa soldada (V, F)) — o caminho do
    gerar_torso sem o gabarito."""
    from mesh.malha.io import MalhaRender
    from mesh.processar.pipeline import decimar, limpar, transferir_atributos
    from mesh.sintetico.gerador import Grade

    torso = torso_final(p) if torso is None else torso
    grade = Grade(torso, int(p.get("resolucao", {}).get("densa_faces", 300000)))
    Vd = torso.avaliar(grade.S, grade.Y)
    densa = MalhaRender(V=Vd, F=grade.F, uv=grade.uv, textura=textura)
    Vw, Fw = grade.soldar(Vd), grade.Fw
    Vc, Fc, _ = limpar(Vw, Fw)
    Vdec, Fdec = decimar(Vc, Fc, alvo_vertices, 30000, 50000)
    return transferir_atributos(densa, Vdec, Fdec), torso, (Vw, Fw)
