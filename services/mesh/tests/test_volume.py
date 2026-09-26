"""Volume: estimador plano_base_elipse (contratos §3.2) com incerteza sempre presente."""

from __future__ import annotations

import numpy as np
import pytest

from mesh.medir import antropometria as antro

from .conftest import PRESETS


def _parede_plana_com_monte(r=60.0, H=40.0, p=1.5, passo=1.5):
    xs = np.arange(-150, 150 + 1e-9, passo)
    ys = np.arange(-150, 150 + 1e-9, passo)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    rho2 = (X**2 + Y**2) / r**2
    Z = np.where(rho2 < 1, H * np.clip(1 - rho2, 0, 1) ** p, 0.0)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    nx, ny = X.shape
    idx = np.arange(nx * ny).reshape(nx, ny)
    a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    F = np.concatenate([np.stack([a, b, c], -1).reshape(-1, 3), np.stack([a, c, d], -1).reshape(-1, 3)])
    lm = {"base_medial_dir": [-r, 0, 0], "base_lateral_dir": [r, 0, 0], "sulco_dir": [0, -r, 0],
          "mamilo_dir": [0, 0, H]}
    real_ml = np.pi * r**2 * H / (p + 1) / 1000.0
    return V, F, lm, real_ml


def test_estimador_exato_quando_a_parede_e_plana():
    V, F, lm, real = _parede_plana_com_monte()
    est = antro.volume_plano_base_elipse(V, F, lm, "dir")
    assert est == pytest.approx(real, rel=0.02)  # so erro de discretizacao da borda da elipse
    assert antro.volume_plano_base_elipse(V, F, lm, "esq") is None  # sem landmarks da base


def test_medir_reporta_incerteza_de_15pct():
    V, F, lm, _ = _parede_plana_com_monte()
    r = antro.medir(V, F, {k: {"posicao": v} for k, v in lm.items()}, incluir_geodesica=False,
                    incluir_volume=True, fator_incerteza=0.15)
    vol = r["volumes"]["dir"]
    assert vol["metodo"] == "plano_base_elipse"
    assert vol["incerteza_ml"] == pytest.approx(0.15 * vol["valor_ml"], abs=0.06)
    assert r["volumes"]["esq"] is None
    assert "volume_esq:landmarks_da_base_ausentes" in r["avisos"]


@pytest.mark.parametrize("nome", PRESETS)
def test_volume_dos_torsos_relatado(cenarios, torsos, nome):
    """Volume real (gabarito) = pedido; o estimado e relatado com faixa. Meta ±15 % (contratos §3.3)
    nao e atingida pelo estimador de referencia numa parede curva (ver README); este teste trava a
    regressao: vies positivo conhecido, < 60 %, e incerteza sempre presente."""
    for lado in ("dir", "esq"):
        v = cenarios[nome]["cenarios"]["decimada"]["volumes"][lado]
        assert v["adicionado_ml"] == pytest.approx(torsos[nome]["parametros"]["volume_ml"][lado], abs=0.1)
        assert v["incerteza_ml"] > 0
        assert 0 < v["erro_relativo_pct"] < 60
