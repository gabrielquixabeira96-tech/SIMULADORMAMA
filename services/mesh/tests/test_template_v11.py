"""C2 (torso_parametros/1.1): fatores de forma e parede opcionais, retrocompativeis byte a byte, e o
template rapido do ajuste (volume cubico exato na pegada)."""

from __future__ import annotations

import copy

import numpy as np
import pytest

from mesh import esquemas
from mesh.foto import template as tpl
from mesh.sintetico.superficie import FORMA_PADRAO, PAREDE_PADRAO, Torso

from .conftest import PRESETS


def _grade(torso):
    P = torso.secao.perimetro
    s = np.linspace(-P / 2, P / 2, 301)
    y = np.linspace(torso.y_base, torso.y_topo, 201)
    S, Y = np.meshgrid(s, y)
    return S, Y


@pytest.mark.parametrize("nome", PRESETS)
def test_padroes_explicitos_sao_bit_a_bit_iguais_a_ausentes(nome):
    """Ausentes = padrao explicito = v1.0, bit a bit (o que garante torso.obj/textura/gabarito iguais; a
    regeracao dos presets com sha256 identicos esta registrada no relatorio do P1)."""
    p = esquemas.completar_parametros(esquemas.presets_torso()[nome])
    q = copy.deepcopy(p)
    q["esquema"] = "torso_parametros/1.1"
    q["forma"] = {"dir": dict(FORMA_PADRAO), "esq": dict(FORMA_PADRAO)}
    q["parede"] = dict(PAREDE_PADRAO)
    esquemas.validar("torso_parametros", q)
    a, b = Torso(p, amostras_secao=40001), Torso(q, amostras_secao=40001)
    for m in (a.mama_dir, a.mama_esq, b.mama_dir, b.mama_esq):
        m.H = 50.0
    S, Y = _grade(a)
    assert np.array_equal(a.avaliar(S, Y), b.avaliar(S, Y))
    assert np.array_equal(a.secao.x, b.secao.x) and np.array_equal(a.secao.z, b.secao.z)


def test_presets_seguem_validos_e_completar_nao_acrescenta_forma():
    for p in esquemas.presets_torso().values():
        c = esquemas.completar_parametros(p)
        esquemas.validar("torso_parametros", c)
        assert "forma" not in c and "parede" not in c


def test_fatores_mudam_a_superficie_e_o_esquema_limita():
    p = esquemas.completar_parametros(esquemas.presets_torso()["t01_simetrico_300"])
    base = tpl.torso_rapido(p)
    S, Y = _grade(base)
    P0 = base.avaliar(S, Y)
    for caminho, v in (("forma.dir.projecao_fator", 1.4), ("forma.esq.polo_inferior_fator", 1.6),
                       ("forma.dir.base_fator", 1.2), ("parede.achatamento_anterior", 0.3),
                       ("parede.expoente_secao", 4.0), ("forma.esq.apice_fator", 0.2)):
        q = copy.deepcopy(p)
        q["esquema"] = "torso_parametros/1.1"
        tpl._set(q, caminho, v)
        esquemas.validar("torso_parametros", q)
        t = tpl.torso_rapido(q)
        assert np.abs(t.avaliar(S, Y) - P0).max() > 1.0, caminho
    q = copy.deepcopy(p)
    q["forma"] = {"dir": {"projecao_fator": 5.0}}
    with pytest.raises(esquemas.ErroContrato):
        esquemas.validar("torso_parametros", q)


@pytest.mark.parametrize("nome", PRESETS)
def test_template_rapido_reproduz_o_gabarito(nome, torsos):
    """O volume cubico na pegada resolve H como o Brent na malha densa: landmarks a < 0,05 mm."""
    g = torsos[nome]
    t = tpl.torso_rapido(esquemas.completar_parametros(esquemas.presets_torso()[nome]))
    L = tpl.landmarks_do_template(t)
    erro = max(np.linalg.norm(L[k] - np.asarray(g["landmarks"][k]["posicao"])) for k in L)
    assert erro < 0.05
    assert abs(t.mama_dir.H - g["_amplitudes_mm"]["dir"]) / g["_amplitudes_mm"]["dir"] < 2e-3


def test_volume_do_template_com_fatores_e_o_pedido():
    p = esquemas.completar_parametros(esquemas.presets_torso()["t02_assimetrico"])
    p["forma"] = {"dir": {"projecao_fator": 1.3, "polo_inferior_fator": 1.5}, "esq": {"base_fator": 0.8}}
    t = tpl.torso_final(p)
    for mama in t.mamas:
        c = tpl.coeficientes_volume(t, mama, 0.5)
        v = c[0] + mama.H * (c[1] + mama.H * (c[2] + mama.H * c[3]))
        assert abs(v / 1000.0 - mama.volume_ml) < 0.05


def test_vetor_de_parametros_ida_e_volta():
    p = tpl.parametros_de_vetor(tpl.vetor_media())
    esquemas.validar("torso_parametros", esquemas.completar_parametros(p))
    assert np.allclose(tpl.vetor_de_parametros(p), tpl.vetor_media())
