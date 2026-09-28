"""Paridade com a implementacao TypeScript da sessao de Bland-Altman (ADR 0017).

Os mesmos pares e os mesmos numeros esperados estao em
apps/web/tests/unit/validacaoEstatistica.test.ts: se um lado mudar a formula (ddof, 1,96,
arredondamento), um dos dois testes quebra.
"""

from __future__ import annotations

from mesh.medir.bland_altman import bland_altman

# Diferencas 1, 2, 3, 4, 5 -> vies 3; DP amostral sqrt(2,5); LoA 3 +- 3,0990
PARES_CONHECIDOS = [
    {"medida": "a", "referencia_mm": 100, "medido_mm": 101},
    {"medida": "a", "referencia_mm": 100, "medido_mm": 102},
    {"medida": "b", "referencia_mm": 50, "medido_mm": 53},
    {"medida": "b", "referencia_mm": 50, "medido_mm": 54},
    {"medida": "b", "referencia_mm": 10, "medido_mm": 15},
]


def test_mesmos_numeros_do_web():
    r = bland_altman(PARES_CONHECIDOS)
    assert r["n"] == 5
    assert r["vies_mm"] == 3.0
    assert r["dp_mm"] == 1.5811
    assert r["loa_inferior_mm"] == -0.099
    assert r["loa_superior_mm"] == 6.099
    assert r["erro_abs_max_mm"] == 5.0
    assert r["dentro_de_2mm"] is False
    assert r["por_medida"]["a"] == {"n": 2, "vies_mm": 1.5, "dp_mm": 0.7071,
                                    "loa_inferior_mm": 0.1141, "loa_superior_mm": 2.8859}


def test_limites_2mm_e_3mm_como_no_web():
    alternados = [{"medida": "m", "referencia_mm": 0, "medido_mm": x} for x in (1, -1, 1, -1)]
    r = bland_altman(alternados, limite_mm=3.0)
    assert r["vies_mm"] == 0.0
    assert r["loa_superior_mm"] == 2.2632
    assert r["dentro_de_3mm"] is True
    assert r["dentro_de_2mm"] is False
