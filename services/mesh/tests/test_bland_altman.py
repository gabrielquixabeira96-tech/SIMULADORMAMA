"""Modulo Bland-Altman reutilizavel."""

from __future__ import annotations

import numpy as np
import pytest

from mesh.medir.bland_altman import bland_altman


def test_valores_conhecidos():
    ref = np.array([100.0, 150.0, 200.0, 250.0, 300.0, 120.0])
    dif = np.array([0.3, -0.2, 0.5, 0.1, -0.4, 0.2])
    pares = [{"medida": "m1" if i % 2 else "m2", "referencia_mm": r, "medido_mm": r + d}
             for i, (r, d) in enumerate(zip(ref, dif, strict=True))]
    ba = bland_altman(pares)
    vies, dp = dif.mean(), dif.std(ddof=1)
    assert ba["n"] == 6
    assert ba["vies_mm"] == pytest.approx(vies, abs=1e-4)
    assert ba["dp_mm"] == pytest.approx(dp, abs=1e-4)
    assert ba["loa_inferior_mm"] == pytest.approx(vies - 1.96 * dp, abs=1e-3)
    assert ba["loa_superior_mm"] == pytest.approx(vies + 1.96 * dp, abs=1e-3)
    assert ba["dentro_de_2mm"] is True
    assert set(ba["por_medida"]) == {"m1", "m2"} and ba["por_medida"]["m1"]["n"] == 3


def test_fora_de_2mm_e_n_pequeno():
    ba = bland_altman([{"medida": "x", "referencia_mm": 0, "medido_mm": d} for d in (3.0, -3.0, 2.5)])
    assert ba["dentro_de_2mm"] is False
    um = bland_altman([{"medida": "x", "referencia_mm": 0, "medido_mm": 0.5}])
    assert um["n"] == 1 and um["dp_mm"] is None and um["dentro_de_2mm"] is None
