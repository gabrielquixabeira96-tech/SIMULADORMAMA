"""T11 — iluminacao SH9 (contratos §10.6; contrato C1 do ADR 0020): base, luz padrao, ajuste robusto
da luz assada na textura e `asset.extras.iluminacao` nos .glb de morph."""

from __future__ import annotations

import json
import math
import shutil
import uuid

import numpy as np
import pytest
from PIL import Image

from mesh.malha.geometria import normais_vertices, soldar
from mesh.malha.glb import ler_json_glb
from mesh.malha.io import ler_malha
from mesh.simulacao import iluminacao as il
from mesh.sintetico import textura_pele as tp

T01 = "t01_simetrico_300"


def _esfera(n: int = 20000) -> np.ndarray:
    """Pontos quase uniformes na esfera (espiral de Fibonacci)."""
    i = np.arange(n) + 0.5
    z = 1.0 - 2.0 * i / n
    r = np.sqrt(1.0 - z * z)
    fi = np.pi * (1.0 + 5**0.5) * i
    return np.stack([r * np.cos(fi), r * np.sin(fi), z], axis=1)


def _malha_t01(dir_sinteticos):
    m = ler_malha(dir_sinteticos / T01 / "torso.obj")
    Vw, Fw, mapa = soldar(m.V, m.F)
    return m, normais_vertices(Vw, Fw)[mapa]


# ----------------------------------------------------------------------------- base e luz

def test_base_sh9_convencao_c1():
    """Ordem (l, m) com m = -l..l, sem fase de Condon-Shortley, constantes de Ramamoorthi-Hanrahan."""
    n = _esfera(50)
    B = il.BASE_SH9(n)
    x, y, z = n.T
    esperado = np.stack([np.full_like(x, 0.282095), 0.488603 * y, 0.488603 * z, 0.488603 * x,
                         1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z,
                         0.546274 * (x * x - y * y)], 1)
    assert np.allclose(B, esperado)
    # base ortonormal na esfera (integral de Y_i Y_j = delta_ij), por quadratura de Fibonacci
    G = il.BASE_SH9(_esfera(200000))
    assert np.allclose(G.T @ G * (4 * np.pi / len(G)), np.eye(9), atol=2e-3)
    # avaliacao por componente == produto com a base (para (k, 3) e para grades (H, W, 3))
    sh = np.arange(1, 10) / 10.0
    assert np.allclose(il.irradiancia_sh9(n, sh), B @ sh)
    assert np.allclose(il.irradiancia_sh9(n.reshape(5, 10, 3), sh), (B @ sh).reshape(5, 10))


def test_luz_direcional_e_a_projecao_sh_do_cosseno_truncado():
    """sh9_de_luz(0, 1, L) = projecao por minimos quadrados (L2 na esfera) de max(0, n.L) na base:
    confere os fatores A0 = pi, A1 = 2pi/3, A2 = pi/4 (Funk-Hecke)."""
    L = np.array([0.3, -0.5, 0.8])
    L /= np.linalg.norm(L)
    n = _esfera(200000)
    B = il.BASE_SH9(n)
    proj = B.T @ np.maximum(n @ L, 0.0) * (4 * np.pi / len(n))
    assert np.allclose(il.sh9_de_luz(0.0, 1.0, L), proj, atol=2e-3)
    # ambiente puro: E = ambiente em toda direcao
    assert np.allclose(il.irradiancia_sh9(n[:100], il.sh9_de_luz(0.7, 0.0, L)), 0.7)
    # no eixo da luz: 1,0625 x (truncamento de ordem 2)
    assert il.irradiancia_sh9(L[None, :], il.sh9_de_luz(0.0, 1.0, L))[0] == pytest.approx(1.0625, abs=1e-5)


def test_luz_padrao_finita_positiva_e_rotacionada():
    sh = il.sh9_padrao()
    assert len(sh) == 9 and np.all(np.isfinite(sh))
    n = _esfera(50000)
    E = il.irradiancia_sh9(n, sh)
    assert E.min() > 0.4  # E(n) > 0 para todo n (minimo ~0,43)
    L = il.DIRECAO_PADRAO_ANATOMICA
    assert il.irradiancia_sh9(L[None, :], sh)[0] == pytest.approx(0.45 + 0.55 * 1.0625, abs=1e-5)
    # rotacao: com eixos R (anatomico -> objeto), E_obj(R n) == E_anat(n)
    a = math.radians(30)
    R = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
    assert np.allclose(il.irradiancia_sh9(n @ R.T, il.sh9_padrao(R)), E, atol=1e-9)


def test_razao_com_a_mesma_normal_e_1():
    n = _esfera(1000)
    for sh in (il.sh9_padrao(), tp.sh9_gravada()):
        E = il.irradiancia_sh9(n, sh)
        assert np.all(E > 0) and np.all(il.irradiancia_sh9(n, sh) / E == 1.0)


def test_eixos_anatomicos_dos_landmarks(torsos):
    R = il.eixos_anatomicos(torsos[T01]["landmarks"])
    # quadro_anatomico serializa os eixos com 6 casas: ortonormal a 1e-5
    assert np.allclose(R.T @ R, np.eye(3), atol=1e-5) and np.linalg.det(R) == pytest.approx(1.0, abs=1e-5)
    assert np.allclose(R, np.eye(3), atol=0.03)  # torso sintetico: quadro do objeto = anatomico
    assert il.eixos_anatomicos({}) is None


# ----------------------------------------------------------------------------- ajuste

def test_ajuste_recupera_a_luz_gravada_no_t01(torsos, dir_sinteticos, capsys):
    """T11: no t01 fotografico, E ajustada ~ E gravada (a menos da escala do albedo): RMS <= 5 % da media
    sobre os vertices amostrados; R^2 >= 0,9."""
    g = torsos[T01]
    m, N = _malha_t01(dir_sinteticos)
    res, info = il.ajustar_sh9(m.textura, m.uv, N, eixos=il.eixos_anatomicos(g["landmarks"]), detalhes=True)
    assert res["origem"] == "ajuste" and res["esquema"] == "iluminacao_sh9/1.0"
    idx = info["indices"]
    Ef = il.irradiancia_sh9(N[idx], res["sh9"])
    Eg = il.irradiancia_sh9(N[idx], g["textura"]["sh9"])
    a, b = Ef / Ef.mean(), Eg / Eg.mean()
    rms = float(np.sqrt(np.mean((a - b) ** 2)))
    with capsys.disabled():
        print(f"\n[T11] t01: {info['n_amostras']} vertices, R2 = {res['r2']:.4f}, RMS(E_ajuste - E_gravada) = "
              f"{100 * rms:.2f} % da media, max = {100 * float(np.abs(a - b).max()):.2f} %, "
              f"escala (albedo medio) = {float(Ef.mean() / Eg.mean()):.3f}")
    assert rms <= 0.05
    assert res["r2"] >= 0.9
    assert info["n_amostras"] >= il.AMOSTRAS_MINIMAS


def test_textura_de_ruido_uniforme_cai_no_padrao(dir_sinteticos):
    m, N = _malha_t01(dir_sinteticos)
    rng = np.random.default_rng(3)
    ruido = Image.fromarray(rng.integers(0, 256, (512, 1024, 3), dtype=np.uint8))
    res, info = il.ajustar_sh9(ruido, m.uv, N, detalhes=True)
    assert res["origem"] == "padrao" and info["motivo"] == "r2_baixo" and res["r2"] < il.R2_MINIMO
    assert np.allclose(res["sh9"], np.round(il.sh9_padrao(), 6))


def test_sem_textura_ou_poucas_amostras_cai_no_padrao(dir_sinteticos):
    m, N = _malha_t01(dir_sinteticos)
    R = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=float)  # quadro girado: padrao acompanha
    res = il.ajustar_sh9(None, None, N, eixos=R)
    assert (res["origem"], res["r2"]) == ("padrao", 0.0)
    assert np.allclose(res["sh9"], np.round(il.sh9_padrao(R), 6))
    poucos = np.zeros(len(N), dtype=bool)
    poucos[:400] = True
    res, info = il.ajustar_sh9(m.textura, m.uv, N, mascara=poucos, detalhes=True)
    assert res["origem"] == "padrao" and info["motivo"] == "poucas_amostras"


def test_ajuste_exato_com_luz_conhecida():
    """Luminancia = albedo constante x E_sh(N): o ajuste devolve albedo x sh (R^2 ~ 1)."""
    N = _esfera(4000)
    N = N[N[:, 2] > -0.2]
    sh = il.sh9_de_luz(0.3, 0.6, (0.2, 0.5, 0.84))
    y = 0.42 * il.irradiancia_sh9(N, sh)
    c, w, r2 = il.ajuste_robusto(il.BASE_SH9(N), y)
    assert np.allclose(c, 0.42 * sh, atol=1e-8) and r2 > 0.999999


# ----------------------------------------------------------------------------- contrato C1 nos .glb

def test_glb_de_morph_tem_iluminacao_c1(morphs_gerados, dir_sinteticos):
    """C1: todo morphs/*.glb do t01 tem asset.extras.iluminacao (esquema, 9 floats finitos, origem)."""
    arquivos = sorted((dir_sinteticos / T01 / "morphs").glob("*.glb"))
    assert len(arquivos) == 4
    vistos = []
    for arq in arquivos:
        ilum = ler_json_glb(arq)["asset"]["extras"]["iluminacao"]
        assert set(ilum) == {"esquema", "sh9", "r2", "origem"}
        assert ilum["esquema"] == "iluminacao_sh9/1.0" and ilum["origem"] in ("ajuste", "padrao")
        assert len(ilum["sh9"]) == 9 and all(isinstance(v, float) and math.isfinite(v) for v in ilum["sh9"])
        assert isinstance(ilum["r2"], float) and math.isfinite(ilum["r2"])
        vistos.append(ilum)
    assert all(v == vistos[0] for v in vistos)  # a mesma luz nos 4 (mesma malha e textura)
    assert vistos[0]["origem"] == "ajuste"      # t01 fotografico: ha luz assada para ajustar
    assert morphs_gerados[T01]["_iluminacao"] == vistos[0]
    for nome in ("t02_assimetrico", "t03_pequeno_ptose"):
        assert morphs_gerados[nome]["_iluminacao"]["origem"] == "ajuste", nome


def test_morph_sem_textura_grava_luz_padrao(torsos, dir_sinteticos, implantes_teste, tmp_path):
    from mesh.simulacao.morphs import gerar_morphs

    origem = dir_sinteticos / T01
    shutil.copy(origem / "torso.obj", tmp_path / "torso.obj")  # sem .mtl: o trimesh poe um 2x2 cinza liso
    shutil.copy(origem / "torso.glb", tmp_path / "torso.glb")
    gab = json.loads((origem / "gabarito.json").read_text(encoding="utf-8"))
    man = gerar_morphs(tmp_path, gab["landmarks"], [implantes_teste["teste-redondo-moderado-300"]],
                       planos=("dual_plane",), imfs=("manter",), lados="ambos", arquivo_obj="torso.obj",
                       arquivo_glb="torso.glb", quadro="anatomico",
                       malha_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "teste-sem-textura")))
    ilum = ler_json_glb(tmp_path / "morphs" / "dual_plane__manter.glb")["asset"]["extras"]["iluminacao"]
    assert ilum == man["_iluminacao"]
    assert (ilum["origem"], ilum["r2"]) == ("padrao", 0.0)
    R = il.eixos_anatomicos(gab["landmarks"])
    assert np.allclose(ilum["sh9"], np.round(il.sh9_padrao(R), 6))
