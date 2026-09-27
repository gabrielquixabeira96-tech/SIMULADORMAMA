"""Criterio do Marco 0: distancias medidas nos 3 torsos (apos decimacao e apos reescala) a ±1 mm do
gabarito — euclidianas e geodesicas MMP. Passa pela camada de servico usada pela API."""

from __future__ import annotations

import pytest

from mesh.medir import antropometria as antro
from mesh.validacao import ESCALA_ERRADA, TOL_MM

from .conftest import PRESETS

CENARIOS = ("decimada", "processar_denso_m", "reescala_regua")


@pytest.mark.parametrize("nome", PRESETS)
@pytest.mark.parametrize("cenario", CENARIOS)
def test_erro_contra_gabarito_ate_1mm(cenarios, nome, cenario):
    c = cenarios[nome]["cenarios"][cenario]
    assert set(c["erros_mm"]) == set(antro.DISTANCIAS)
    for medida, e in c["erros_mm"].items():
        assert abs(e["euclidiana_mm"]) <= TOL_MM, (nome, cenario, medida, e)
        assert abs(e["geodesica_mm"]) <= TOL_MM, (nome, cenario, medida, e)


@pytest.mark.parametrize("nome", PRESETS)
@pytest.mark.parametrize("cenario", CENARIOS)
def test_decimacao_na_faixa(cenarios, nome, cenario):
    assert 30000 <= cenarios[nome]["cenarios"][cenario]["n_vertices"] <= 50000


@pytest.mark.parametrize("nome", PRESETS)
def test_reescala_acumula_fator(cenarios, nome):
    c = cenarios[nome]["cenarios"]["reescala_regua"]
    assert c["fator_escala_acumulado"] == pytest.approx(1.0 / ESCALA_ERRADA, rel=1e-9)


def test_bland_altman_do_pipeline(cenarios):
    from mesh.medir.bland_altman import bland_altman

    pares = [p for r in cenarios.values() for p in r["pares"]]
    ba = bland_altman(pares)
    assert ba["n"] == 3 * 3 * 7 * 2 >= 30
    assert ba["dentro_de_2mm"] is True
    assert ba["erro_abs_max_mm"] <= TOL_MM
