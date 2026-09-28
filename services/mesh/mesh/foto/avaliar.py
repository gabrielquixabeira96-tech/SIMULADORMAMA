"""Avaliacao de uma reconstrucao por fotos contra o gabarito de um torso sintetico
(`avaliacao_reconstrucao/1.0`; plano foto3d, P4-lite). So para torsos sinteticos: a verdade e a
superficie parametrica do gabarito (`gabarito.parametros`) e as fotos sinteticas (`fotos/registro_*.json`,
landmarks 2D exatos). Nada disto existe para uma paciente real.

Metricas (gravadas em `avaliacao.json` na pasta da malha reconstruida):
- `rms_mm {x, y, z, total}`: RMS ponto-superficie por eixo na regiao das mamas (pegadas do gabarito
  dilatadas 20 mm, amostradas a cada 2 mm na superficie verdadeira), da verdade para a malha
  reconstruida (`processada.obj`, a malha que o web recebe);
- `volume_erro_pct {dir, esq}`: volume adicionado estimado (`reconstrucao.estimado.volumes`) contra o do
  gabarito, em % com sinal;
- `landmarks_erro_mm {medio, max, por_landmark}`: distancia 3D entre os 10 landmarks levantados pelo
  ajuste e os do gabarito;
- `reprojecao_rms_px`: os landmarks 3D reconstruidos projetados pelas cameras estimadas contra os 2D
  exatos das fotos sinteticas (so os visiveis), RMS sobre todas as fotos;
- `pose_erro_mm`: distancia entre o centro optico estimado e o verdadeiro, por foto.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from mesh import esquemas
from mesh.foto import template as tpl
from mesh.foto.camera import projetar
from mesh.malha.geometria import Proximidade
from mesh.malha.io import ler_malha
from mesh.versao import VERSAO_SOFTWARE

ESQUEMA = "avaliacao_reconstrucao/1.0"
DILATACAO_MM = 20.0
PASSO_MM = 2.0


def pontos_regiao_mamas(torso, dilatacao_mm: float = DILATACAO_MM, passo_mm: float = PASSO_MM) -> np.ndarray:
    """Pontos da superficie `torso` nas pegadas das mamas dilatadas `dilatacao_mm`, a cada `passo_mm`."""
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


def rms_por_eixo(pontos_verdade: np.ndarray, V_rec: np.ndarray, F_rec: np.ndarray) -> dict:
    """RMS por eixo (e total) do ponto mais proximo da malha (V_rec, F_rec) a cada ponto verdadeiro."""
    q, _, _, d = Proximidade(V_rec, F_rec).consultar(pontos_verdade)
    e = q - pontos_verdade
    out = {ax: float(np.sqrt(np.mean(e[:, i] ** 2))) for i, ax in enumerate("xyz")}
    out["total"] = float(np.sqrt(np.mean(d ** 2)))
    return out


def _matriz(v9) -> np.ndarray:
    return np.asarray(v9, dtype=np.float64).reshape(3, 3, order="F")


def sha256_gabarito(pasta_torso: Path) -> str:
    return hashlib.sha256((Path(pasta_torso) / "gabarito.json").read_bytes()).hexdigest()


def avaliar_reconstrucao(malha_dir: Path, pasta_torso: Path, gravar: bool = True) -> dict:
    """Compara a reconstrucao em `malha_dir` (reconstrucao.json + processada.obj) com o gabarito do torso
    sintetico em `pasta_torso`; grava `malha_dir/avaliacao.json` (com `gravar`) e devolve o dict."""
    malha_dir, pasta_torso = Path(malha_dir), Path(pasta_torso)
    rec = json.loads((malha_dir / "reconstrucao.json").read_text(encoding="utf-8"))
    g = json.loads((pasta_torso / "gabarito.json").read_text(encoding="utf-8"))

    malha = ler_malha(malha_dir / "processada.obj")
    pts = pontos_regiao_mamas(tpl.torso_final(g["parametros"]))
    rms = rms_por_eixo(pts, np.asarray(malha.V, dtype=np.float64), np.asarray(malha.F, dtype=np.int64))

    lm_rec = {k: np.asarray(v["posicao"], dtype=np.float64) for k, v in rec["landmarks"].items()}
    lm_gab = {k: np.asarray(v["posicao"], dtype=np.float64) for k, v in g["landmarks"].items()}
    por_lm = {k: round(float(np.linalg.norm(lm_rec[k] - lm_gab[k])), 3) for k in tpl.LANDMARKS if k in lm_rec}

    vols = (rec.get("estimado") or {}).get("volumes") or {}
    volume = {}
    for lado in ("dir", "esq"):
        v_rec = (vols.get(lado) or {}).get("adicionado_ml")
        v_gab = g["volumes"][lado]["adicionado_ml"]
        volume[lado] = None if v_rec is None else round((float(v_rec) - v_gab) / v_gab * 100.0, 2)

    erros2, pose = [], {}
    for f in rec["fotos"]:
        reg_p = pasta_torso / "fotos" / f"registro_{f['vista']}.json"
        if not reg_p.is_file():
            continue
        reg = json.loads(reg_p.read_text(encoding="utf-8"))
        K, R, t = _matriz(f["K"]), _matriz(f["R"]), np.asarray(f["t"], dtype=np.float64)
        ids = [k for k in reg["visiveis"] if k in lm_rec]
        if ids:
            uv = projetar(np.stack([lm_rec[k] for k in ids]), K, R, t, float(f.get("k1") or 0.0))
            verdade = np.asarray([reg["landmarks_2d"][k] for k in ids], dtype=np.float64)
            erros2.extend(np.sum((uv - verdade) ** 2, axis=1).tolist())
        Rv, tv = _matriz(reg["R"]), np.asarray(reg["t"], dtype=np.float64)
        pose[f["vista"]] = round(float(np.linalg.norm((-R.T @ t) - (-Rv.T @ tv))), 2)

    av = {
        "esquema": ESQUEMA,
        "torso": g.get("nome", pasta_torso.name),
        "n_fotos": len(rec["fotos"]),
        "vistas": [f["vista"] for f in rec["fotos"]],
        "rms_mm": {k: round(v, 3) for k, v in rms.items()},
        "regiao": {"descricao": "pegadas das mamas do gabarito dilatadas", "dilatacao_mm": DILATACAO_MM,
                   "passo_mm": PASSO_MM, "n_pontos": int(len(pts))},
        "volume_erro_pct": volume,
        "landmarks_erro_mm": {"medio": round(float(np.mean(list(por_lm.values()))), 3),
                              "max": round(float(max(por_lm.values())), 3), "por_landmark": por_lm},
        "reprojecao_rms_px": round(float(np.sqrt(np.mean(erros2))), 3) if erros2 else None,
        "pose_erro_mm": pose,
        "incerteza_por_eixo_mm": rec["incerteza_por_eixo_mm"],
        "profundidade_confiavel": bool(rec.get("profundidade_confiavel")),
        "gabarito_sha256": sha256_gabarito(pasta_torso),
        "versao_software": VERSAO_SOFTWARE,
        "gerado_em": datetime.now(UTC).astimezone().isoformat(timespec="seconds"),
    }
    esquemas.validar("avaliacao_reconstrucao", av)
    if gravar:
        (malha_dir / "avaliacao.json").write_text(json.dumps(av, ensure_ascii=False, indent=2) + "\n",
                                                  encoding="utf-8")
    return av
