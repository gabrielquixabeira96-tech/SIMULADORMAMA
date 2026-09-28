"""Ajuste do template a fotos sinteticas dos torsos t01-t03 (criterios 4, 5 e determinismo do P1).

- 3 fotos (frente + oblíqua D + perfil D), landmarks exatos, mascara exata: RMS ponto-superficie contra
  a superficie verdadeira na regiao das mamas <= 2,0 mm por eixo; landmarks 3D <= 2 mm; volume +-10 %;
  reprojecao rms <= 3 px.
- So a frontal: x, y <= 2,5 mm; z e volume so relatados; incerteza z >= 12 mm e o aviso de ilustracao.
- Robustez: ruido de 2 px nos landmarks e mascara dilatada 3 px -> RMS <= 3,5 mm.
- Determinismo: a mesma entrada da o mesmo resultado, bit a bit.
Os numeros medidos vao para o log do pytest (-s) e para o relatorio do P1.
"""

from __future__ import annotations

import numpy as np
import pytest

from mesh.foto import ajuste as aj

from .conftest import PRESETS
from .foto_util import ajuste_avaliado, carregar_fotos, escala_ssn_n, garantir_fotos


def _log(rotulo, res, m, dt):
    rms = m["rms_mm"]
    print(f"\n[foto] {rotulo}: rms x/y/z {rms['x']:.2f}/{rms['y']:.2f}/{rms['z']:.2f} mm, landmarks max "
          f"{m['landmark_max_mm']:.2f} mm, volume dir/esq "
          f"{m['volume_pct']['dir']:+.1f}/{m['volume_pct']['esq']:+.1f} %, "
          f"reprojecao {res.reprojecao_rms_px:.2f} px, silhueta {res.residuo_silhueta_mm:.2f} mm, "
          f"incerteza {res.incerteza_por_eixo_mm} / vol {res.incerteza_volume_pct} %, {dt:.1f} s")


@pytest.mark.parametrize("nome", PRESETS)
def test_tres_fotos_exatas(nome, torsos, dir_sinteticos):
    res, m, dt = ajuste_avaliado(dir_sinteticos / nome)
    _log(f"{nome} 3 fotos", res, m, dt)
    for ax in "xyz":
        assert m["rms_mm"][ax] <= 2.0, ax
    assert m["landmark_max_mm"] <= 2.0
    assert m["volume_max_pct"] <= 10.0
    assert res.reprojecao_rms_px <= 3.0
    assert res.qualidade == "boa" and not res.forma_fora_do_modelo
    assert res.incerteza_por_eixo_mm["z"] >= aj.PISO_XY_MM
    assert "sem_perfil:profundidade_so_ilustracao" not in res.avisos
    assert dt <= 60.0


@pytest.mark.parametrize("nome", PRESETS)
def test_so_frontal_relata_z_e_volume(nome, torsos, dir_sinteticos):
    res, m, dt = ajuste_avaliado(dir_sinteticos / nome, ("frente",))
    _log(f"{nome} so frontal", res, m, dt)
    assert m["rms_mm"]["x"] <= 2.5 and m["rms_mm"]["y"] <= 2.5
    assert res.incerteza_por_eixo_mm["z"] >= 12.0
    assert res.incerteza_volume_pct >= 25.0
    assert "sem_perfil:profundidade_so_ilustracao" in res.avisos
    assert res.reprojecao_rms_px <= 3.0


def test_robustez_ruido_2px_e_mascara_dilatada(torsos, dir_sinteticos):
    nome = "t02_assimetrico"  # o caso assimetrico e o mais dificil
    res, m, dt = ajuste_avaliado(dir_sinteticos / nome, ruido_px=2.0, semente=7, mascara_morf_px=3)
    _log(f"{nome} ruido 2 px + mascara +3 px", res, m, dt)
    for ax in "xyz":
        assert m["rms_mm"][ax] <= 3.5, ax
    assert res.reprojecao_rms_px <= 4.0


def test_mascara_erodida(torsos, dir_sinteticos):
    nome = "t01_simetrico_300"
    res, m, dt = ajuste_avaliado(dir_sinteticos / nome, ruido_px=2.0, semente=3, mascara_morf_px=-3)
    _log(f"{nome} ruido 2 px + mascara -3 px", res, m, dt)
    for ax in "xyz":
        assert m["rms_mm"][ax] <= 3.5, ax


def test_deterministico(torsos, dir_sinteticos):
    pasta = dir_sinteticos / "t03_pequeno_ptose"
    garantir_fotos(pasta)
    a = aj.ajustar(carregar_fotos(pasta, ("frente",)), escala_ssn_n(pasta))
    b = aj.ajustar(carregar_fotos(pasta, ("frente",)), escala_ssn_n(pasta))
    assert np.array_equal(a.theta, b.theta)
    assert all(np.array_equal(ra, rb) and np.array_equal(ta, tb)
               for (ra, ta), (rb, tb) in zip(a.poses, b.poses, strict=True))
    assert a.incerteza_por_eixo_mm == b.incerteza_por_eixo_mm


def test_erros_de_entrada(torsos, dir_sinteticos):
    pasta = dir_sinteticos / "t01_simetrico_300"
    garantir_fotos(pasta)
    fotos = carregar_fotos(pasta, ("frente",))
    with pytest.raises(aj.ErroAjuste) as e:
        aj.ajustar(fotos, None)
    assert e.value.codigo == "escala_ausente"
    f = fotos[0]
    f.landmarks_2d = {k: v for k, v in list(f.landmarks_2d.items())[:5]}
    with pytest.raises(aj.ErroAjuste) as e:
        aj.ajustar(fotos, escala_ssn_n(pasta))
    assert e.value.codigo == "landmarks_2d_incompletos"
    with pytest.raises(aj.ErroAjuste) as e:
        aj.ajustar(carregar_fotos(pasta, ("obliqua_dir",)), escala_ssn_n(pasta))
    assert e.value.codigo == "landmarks_2d_incompletos"
