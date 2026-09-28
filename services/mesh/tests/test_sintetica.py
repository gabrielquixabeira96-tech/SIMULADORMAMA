"""Fotos sinteticas e rasterizador (criterio 9 do P1): determinismo (sha256 estavel), landmarks 2D do
registro reprojetam os do gabarito (< 0,5 px), pintor = z-buffer em >= 99,5 % dos pixels a 400 px, recorte
do topo (furcula perto do topo) e nada de EXIF."""

from __future__ import annotations

import hashlib
import json
import shutil

import numpy as np
import pytest
from PIL import Image

from mesh.foto import camera as cam
from mesh.foto import raster
from mesh.foto.sintetica import cameras_clinicas, foto_sintetica
from mesh.malha.io import ler_malha

from .conftest import PRESETS
from .foto_util import VISTAS_3, garantir_fotos


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


@pytest.mark.parametrize("nome", PRESETS)
def test_registro_reprojeta_o_gabarito_e_recorta_o_rosto(nome, torsos, dir_sinteticos):
    pasta = dir_sinteticos / nome
    regs = garantir_fotos(pasta)
    g = torsos[nome]
    for v in VISTAS_3:
        r = regs[v]
        K, R = cam.de_coluna_major(r["K"]), cam.de_coluna_major(r["R"])
        t = np.asarray(r["t"])
        X = np.array([g["landmarks"][k]["posicao"] for k in r["landmarks_2d"]])
        uv = np.array(list(r["landmarks_2d"].values()))
        assert np.sqrt(np.mean(np.sum((cam.projetar(X, K, R, t) - uv) ** 2, 1))) < 0.5
        assert cam.focal_35mm_de_k(K, r["largura_px"], r["altura_px"]) == pytest.approx(r["focal_35mm"])
        img = Image.open(pasta / r["arquivo"])
        assert img.size == (r["largura_px"], r["altura_px"]) and img.mode == "RGB"
        assert "exif" not in img.info and not img.getexif()
        m = np.asarray(Image.open(pasta / r["mascara"])) > 127
        assert m.shape == (r["altura_px"], r["largura_px"]) and 0.1 < m.mean() < 0.8
        if v != "perfil_dir":  # furcula visivel e perto do topo (recorte do rosto)
            assert "furcula" in r["visiveis"]
            assert r["landmarks_2d"]["furcula"][1] < 0.12 * r["altura_px"]
    assert set(regs["perfil_dir"]["visiveis"]) <= {"mamilo_dir", "sulco_dir", "base_lateral_dir", "furcula",
                                                   "linha_media_inferior"}


def test_foto_sintetica_deterministica(torsos, dir_sinteticos, tmp_path):
    pasta = dir_sinteticos / "t01_simetrico_300"
    garantir_fotos(pasta)
    copia = tmp_path / "t01"
    copia.mkdir()
    for a in ("gabarito.json", "torso.obj", "torso.mtl", "textura.png"):
        shutil.copy(pasta / a, copia / a)
    foto_sintetica(copia, "obliqua_dir")
    for a in ("foto_obliqua_dir.jpg", "mascara_obliqua_dir.png", "registro_obliqua_dir.json"):
        assert _sha(copia / "fotos" / a) == _sha(pasta / "fotos" / a), a


@pytest.mark.parametrize(("vista", "largura"), [(v, 400) for v in VISTAS_3] + [("frente", 2000)])
def test_pintor_igual_ao_zbuffer(vista, largura, torsos, dir_sinteticos):
    pasta = dir_sinteticos / "t01_simetrico_300"
    malha = ler_malha(pasta / "torso.obj")
    lm = {k: np.asarray(v["posicao"]) for k, v in torsos["t01_simetrico_300"]["landmarks"].items()}
    altura = largura * 3 // 4
    K, R, t = cameras_clinicas(lm, largura, altura)[vista]
    S = raster.tela(malha.V, K, R, t)
    a = raster.pintor(S, malha.F, largura, altura)
    b, prof_b = raster.zbuffer(S, malha.F, largura, altura, devolver_profundidade=True)
    # cobertura (torso x fundo: a mascara) igual em >= 99,5 % dos pixels
    assert ((a >= 0) == (b >= 0)).mean() >= 0.995
    cob = (a >= 0) | (b >= 0)
    assert ((a >= 0) == (b >= 0))[cob].mean() >= 0.99
    if largura < 2000:
        # a 400 px (1,6 mm/px) o pixel toca varias faces nas faixas rasantes dos flancos; o pintor (face que
        # toca o pixel, a mais proxima por ultimo) e o z-buffer (face que contem o centro) escolhem faces
        # diferentes ali (~2 % dos pixels com > 2 mm de profundidade): a superficie e comparada a 2000 px
        return
    jj, ii, f, lam = raster.baricentricas(S, malha.F, a)
    prof_a = np.full(a.shape, np.inf)
    prof_a[jj, ii] = 1.0 / (lam / S[malha.F[f], 2]).sum(1)
    Xc = cam.para_camera(malha.V, R, t)
    Fb = malha.F[b[(a >= 0) & (b >= 0)]]
    n = np.cross(Xc[Fb[:, 1]] - Xc[Fb[:, 0]], Xc[Fb[:, 2]] - Xc[Fb[:, 0]])
    c = Xc[Fb].mean(1)
    cos = np.abs(np.einsum("ij,ij->i", n, c)) / (np.linalg.norm(n, axis=1) * np.linalg.norm(c, axis=1))
    d = np.abs(prof_a - prof_b)[(a >= 0) & (b >= 0)]
    assert (d[cos > 0.3] < 2.0).mean() >= 0.995
    assert (d < 2.0).mean() >= 0.99


def test_zbuffer_triangulo_simples():
    S = np.array([[10.0, 10.0, 100.0], [10.0, 90.0, 100.0], [90.0, 10.0, 100.0]])
    F = np.array([[0, 1, 2]])  # anti-horario visto de fora = area assinada < 0 na tela (v para baixo)
    face = raster.zbuffer(S, F, 100, 100)
    area = int((face >= 0).sum())
    assert abs(area - 0.5 * 80 * 80) < 90
    assert abs(int((raster.pintor(S, F, 100, 100) >= 0).sum()) - area) < 90
    assert (raster.zbuffer(S, F[:, ::-1], 100, 100) < 0).all()  # de costas: descartada


def test_registro_json_legivel(dir_sinteticos, torsos):
    pasta = dir_sinteticos / "t02_assimetrico"
    garantir_fotos(pasta)
    r = json.loads((pasta / "fotos" / "registro_frente.json").read_text(encoding="utf-8"))
    assert r["esquema"] == "registro_foto_sintetica/1.0" and len(r["K"]) == 9 and len(r["R"]) == 9
    assert set(r["landmarks_2d"]) == set(torsos["t02_assimetrico"]["landmarks"])
