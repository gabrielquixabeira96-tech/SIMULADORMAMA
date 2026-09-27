"""Bland-Altman (vies, DP, limites de concordancia 95 %) — contratos §7.7 e §15; Marco 1.

Diferenca = medido - referencia. LoA = vies +- 1,96 * DP (DP amostral, ddof = 1).
`dentro_de_Xmm` = ambos os LoA dentro de [-X, +X] (criterio do Marco 1: X = 2 mm).
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Iterable, Mapping

import numpy as np

Z_95 = 1.96


def _resumo(dif: np.ndarray) -> dict:
    n = int(len(dif))
    if n == 0:
        return {"n": 0, "vies_mm": None, "dp_mm": None, "loa_inferior_mm": None, "loa_superior_mm": None}
    vies = float(np.mean(dif))
    if n < 2:
        return {"n": n, "vies_mm": round(vies, 4), "dp_mm": None, "loa_inferior_mm": None, "loa_superior_mm": None}
    dp = float(np.std(dif, ddof=1))
    return {
        "n": n,
        "vies_mm": round(vies, 4),
        "dp_mm": round(dp, 4),
        "loa_inferior_mm": round(vies - Z_95 * dp, 4),
        "loa_superior_mm": round(vies + Z_95 * dp, 4),
    }


def bland_altman(pares: Iterable[Mapping], limite_mm: float = 2.0) -> dict:
    """`pares`: itens com `medida`, `referencia_mm`, `medido_mm` (outros campos sao ignorados)."""
    pares = list(pares)
    dif = np.array([float(p["medido_mm"]) - float(p["referencia_mm"]) for p in pares], dtype=np.float64)
    geral = _resumo(dif)
    por: dict[str, list[float]] = OrderedDict()
    for p, d in zip(pares, dif, strict=True):
        por.setdefault(str(p.get("medida", "?")), []).append(float(d))
    lo, hi = geral["loa_inferior_mm"], geral["loa_superior_mm"]
    dentro = None if lo is None else bool(lo >= -limite_mm and hi <= limite_mm)
    return {
        **geral,
        f"dentro_de_{limite_mm:g}mm": dentro,
        "dentro_de_2mm": dentro if limite_mm == 2.0 else (
            None if lo is None else bool(lo >= -2.0 and hi <= 2.0)),
        "erro_abs_max_mm": None if len(dif) == 0 else round(float(np.max(np.abs(dif))), 4),
        "por_medida": {k: _resumo(np.array(v)) for k, v in por.items()},
    }
