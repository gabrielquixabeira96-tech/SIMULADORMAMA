"""Utilitarios dos testes da reconstrucao por fotos: entrada a partir das fotos sinteticas e metricas
contra o gabarito (RMS ponto-superficie por eixo na regiao das mamas). A avaliacao "oficial" com
relatorio e do pacote P4 (mesh/foto/avaliar.py); aqui fica so o necessario para os criterios do P1."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from mesh.foto import ajuste as aj
from mesh.foto import camera as cam
from mesh.foto import template as tpl
from mesh.malha.geometria import Proximidade


def carregar_fotos(pasta_torso: Path, vistas, ruido_px: float = 0.0, semente: int = 0, mascara_morf_px: int = 0,
                   so_visiveis_fora_da_frente: bool = True) -> list[aj.FotoAjuste]:
    from scipy.ndimage import binary_dilation, binary_erosion

    rng = np.random.default_rng(semente)
    fotos = []
    for v in vistas:
        reg = json.loads((pasta_torso / "fotos" / f"registro_{v}.json").read_text(encoding="utf-8"))
        ids = list(reg["landmarks_2d"]) if (v == "frente" or not so_visiveis_fora_da_frente) else reg["visiveis"]
        lm = {k: np.asarray(reg["landmarks_2d"][k], float) for k in ids}
        if ruido_px:
            lm = {k: p + rng.normal(0.0, ruido_px, 2) for k, p in lm.items()}
        m = np.asarray(Image.open(pasta_torso / reg["mascara"])) > 127
        if mascara_morf_px > 0:
            m = binary_dilation(m, iterations=mascara_morf_px)
        elif mascara_morf_px < 0:
            m = binary_erosion(m, iterations=-mascara_morf_px)
        K = cam.matriz_k(reg["largura_px"], reg["altura_px"], reg["focal_35mm"])
        fotos.append(aj.FotoAjuste(vista=v, K=K, largura=reg["largura_px"], altura=reg["altura_px"], landmarks_2d=lm,
                                   mascara=m))
    return fotos


def escala_ssn_n(pasta_torso: Path, lado: str = "dir") -> aj.EscalaAjuste:
    g = json.loads((pasta_torso / "gabarito.json").read_text(encoding="utf-8"))
    return aj.EscalaAjuste("ssn_n_fita", float(g["distancias"][f"ssn_n_{lado}"]["euclidiana_mm"]), lado)


def pontos_regiao_mamas(torso, dilatacao_mm: float = 20.0, passo_mm: float = 2.0) -> np.ndarray:
    pts = []
    for mama in torso.mamas:
        A_lat, A_med = mama.e_lat + dilatacao_mm, mama.e_med + dilatacao_mm
        B_sup, B_inf = mama.e_sup + dilatacao_mm, mama.e_inf + dilatacao_mm
        du = np.arange(-A_med, A_lat + 1e-9, passo_mm)
        dv = np.arange(-B_inf, B_sup + 1e-9, passo_mm)
        U, V = np.meshgrid(du, dv)
        un = np.where(U > 0, U / A_lat, U / A_med)
        vn = np.where(V > 0, V / B_sup, V / B_inf)
        d = un ** 2 + vn ** 2 < 1.0
        pts.append(torso.avaliar(mama.lado * (mama.s_mamilo + U[d]), mama.y_apice + V[d]))
    return np.concatenate(pts)


def superficie_densa(p: dict, faces: int = 200000):
    from mesh.sintetico.gerador import Grade

    torso = tpl.torso_final(p)
    grade = Grade(torso, faces)
    V = grade.soldar(torso.avaliar(grade.S, grade.Y))
    return torso, V, grade.Fw


def rms_por_eixo(pontos_verdade: np.ndarray, V_rec: np.ndarray, F_rec: np.ndarray) -> dict:
    q, _, _, d = Proximidade(V_rec, F_rec).consultar(pontos_verdade)
    e = q - pontos_verdade
    out = {ax: float(np.sqrt(np.mean(e[:, i] ** 2))) for i, ax in enumerate("xyz")}
    out["total"] = float(np.sqrt(np.mean(d ** 2)))
    return out


def avaliar(res: aj.ResultadoAjuste, pasta_torso: Path, torso_verdade=None) -> dict:
    """Metricas do P1 contra o gabarito: RMS por eixo (verdade -> reconstrucao) na regiao das mamas
    (pegadas dilatadas 20 mm), erro dos landmarks 3D e do volume."""
    g = json.loads((pasta_torso / "gabarito.json").read_text(encoding="utf-8"))
    if torso_verdade is None:
        torso_verdade = tpl.torso_final(g["parametros"])
    pts = pontos_regiao_mamas(torso_verdade)
    _, V, F = superficie_densa(res.parametros)
    rms = rms_por_eixo(pts, V, F)
    lm = {k: float(np.linalg.norm(res.landmarks_3d[k] - np.asarray(g["landmarks"][k]["posicao"])))
          for k in g["landmarks"]}
    vol = {lado: (res.parametros["volume_ml"][lado] - g["volumes"][lado]["adicionado_ml"])
           / g["volumes"][lado]["adicionado_ml"] * 100 for lado in ("dir", "esq")}
    return {"rms_mm": rms, "landmarks_mm": lm, "landmark_max_mm": max(lm.values()), "volume_pct": vol,
            "volume_max_pct": max(abs(v) for v in vol.values())}
