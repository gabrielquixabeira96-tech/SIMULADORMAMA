"""Camera pinhole e PnP (criterio 3 do P1): pose exata sem ruido; ruido de 2 px em 10 pontos com 100
sementes -> mediana rot < 1 grau, t < 5 mm, rms <= 1,3 x ruido; 1 ponto deslocado 30 px fica isolado;
5 pontos -> landmarks_2d_incompletos."""

from __future__ import annotations

import numpy as np
import pytest

from mesh import esquemas
from mesh.foto import camera as cam
from mesh.foto import template as tpl
from mesh.foto.sintetica import cameras_clinicas


@pytest.fixture(scope="module")
def cena():
    t = tpl.torso_rapido(esquemas.completar_parametros(esquemas.presets_torso()["t01_simetrico_300"]))
    L = tpl.landmarks_do_template(t)
    X = np.array([L[k] for k in tpl.LANDMARKS])
    return L, X, cameras_clinicas(L, 2000, 1500)


def test_matriz_k_e_focal():
    K = cam.matriz_k(4000, 3000, 26.0)
    assert K[0, 0] == pytest.approx(4000 * 26 / 36) and K[0, 2] == 2000 and K[1, 2] == 1500
    assert cam.focal_35mm_de_k(K, 4000, 3000) == pytest.approx(26.0)
    K = cam.matriz_k(3000, 4000, 26.0)  # retrato: o lado maior e a altura
    assert K[0, 0] == pytest.approx(4000 * 26 / 36)
    with pytest.raises(cam.ErroCamera) as e:
        cam.matriz_k(4000, 3000, 13.0)
    assert e.value.codigo == "lente_grande_angular"


def test_coluna_major_ida_e_volta():
    M = np.arange(9.0).reshape(3, 3)
    v = cam.coluna_major(M)
    assert v[:3] == [0.0, 3.0, 6.0]
    assert np.array_equal(cam.de_coluna_major(v), M)


def test_olhar_para_convencao_opencv():
    R, t = cam.olhar_para([0, 0, 1000], [0, 0, 0])
    uv = cam.projetar(np.array([[10.0, 10.0, 0.0]]), np.array([[1000, 0, 500], [0, 1000, 500], [0, 0, 1]]), R, t)
    # +x do mundo (esquerda da paciente) aparece a direita da imagem; +y (cranial) para cima (v menor)
    assert uv[0, 0] > 500 and uv[0, 1] < 500


@pytest.mark.parametrize("vista", ["frente", "obliqua_dir", "perfil_dir"])
def test_pnp_sem_ruido_exato(cena, vista):
    _, X, cams = cena
    K, R, t = cams[vista]
    uv = cam.projetar(X, K, R, t)
    r = cam.resolver_pnp(X, uv, K)
    assert cam.angulo_entre_rotacoes_graus(r.R, R) < 0.01
    assert np.linalg.norm(r.t - t) < 0.1
    assert r.rms_px < 1e-3


@pytest.mark.parametrize("vista", ["frente", "obliqua_dir"])
def test_pnp_ruido_2px_100_sementes(cena, vista):
    _, X, cams = cena
    K, R, t = cams[vista]
    uv = cam.projetar(X, K, R, t)
    rot, tr, rms = [], [], []
    for s in range(100):
        rng = np.random.default_rng(s)
        r = cam.resolver_pnp(X, uv + rng.normal(0.0, 2.0, uv.shape), K)
        rot.append(cam.angulo_entre_rotacoes_graus(r.R, R))
        tr.append(np.linalg.norm(r.t - t))
        rms.append(r.rms_px)
    assert np.median(rot) < 1.0
    assert np.median(tr) < 5.0
    assert np.median(rms) <= 1.3 * 2.0


def test_pnp_ponto_deslocado_30px_fica_isolado(cena):
    _, X, cams = cena
    K, R, t = cams["frente"]
    uv = cam.projetar(X, K, R, t)
    rot_ref, rot_out = [], []
    for s in range(30):
        rng = np.random.default_rng(1000 + s)
        ruido = uv + rng.normal(0.0, 2.0, uv.shape)
        r0 = cam.resolver_pnp(X, ruido, K)
        ruim = ruido.copy()
        ruim[3] += [30.0, 0.0]
        r1 = cam.resolver_pnp(X, ruim, K)
        assert int(np.argmax(r1.residuos_px)) == 3
        assert r1.residuos_px[3] > 20.0
        rot_ref.append(cam.angulo_entre_rotacoes_graus(r0.R, R))
        rot_out.append(cam.angulo_entre_rotacoes_graus(r1.R, R))
    assert np.median(rot_out) < 2.0 * max(np.median(rot_ref), 0.25)


def test_pnp_com_5_pontos_recusa(cena):
    _, X, cams = cena
    K, R, t = cams["frente"]
    uv = cam.projetar(X, K, R, t)
    with pytest.raises(cam.ErroCamera) as e:
        cam.resolver_pnp(X[:5], uv[:5], K)
    assert e.value.codigo == "landmarks_2d_incompletos"


def test_pnp_pontos_colineares(cena):
    _, _, cams = cena
    K, R, t = cams["frente"]
    X = np.stack([np.linspace(-100, 100, 8), np.zeros(8), np.zeros(8)], 1)
    with pytest.raises(cam.ErroCamera) as e:
        cam.resolver_pnp(X, cam.projetar(X, K, R, t), K)
    assert e.value.codigo == "pontos_colineares"
