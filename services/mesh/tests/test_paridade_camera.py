"""Paridade da camera do C1 (reconstrucao/1.0) entre os tres lados do plano foto3d.

A fixture `apps/web/tests/fixtures/foto3d/paridade_camera.json` tem as cameras (K, R, t coluna-major) e os
landmarks 3D de uma reconstrucao real do pipeline (t01, 3 fotos) e os pixels que o `camera.projetar` do P1
dava quando ela foi gravada. Aqui: P1 (`camera.projetar`) e P2 (`projetar.Camera`) reproduzem esses pixels;
o mesmo arquivo e conferido no web por `apps/web/tests/unit/cameraParidade.test.ts` (`cameraDaFoto`, P3).
Se um lado mudar a convencao (meio pixel, linha/coluna-major, sinal de y), um dos dois testes quebra.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from mesh.foto import camera as cam
from mesh.foto.projetar import Camera

FIXTURE = Path(__file__).resolve().parents[3] / "apps/web/tests/fixtures/foto3d/paridade_camera.json"
TOL_PX = 0.5


def _dados():
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    ids = list(fx["landmarks_3d"])
    P = np.asarray([fx["landmarks_3d"][k] for k in ids], dtype=np.float64)
    return fx, ids, P


def test_p1_e_p2_reproduzem_os_pixels_da_fixture():
    fx, ids, P = _dados()
    assert len(fx["fotos"]) == 3 and len(ids) == 10
    pior = 0.0
    for f in fx["fotos"]:
        esperado = np.asarray([f["pixels"][k] for k in ids])
        K = np.asarray(f["K"]).reshape(3, 3, order="F")
        R = np.asarray(f["R"]).reshape(3, 3, order="F")
        uv1 = cam.projetar(P, K, R, np.asarray(f["t"]), f["k1"])
        uv2, z = Camera.de_contrato(f).projetar(P)
        assert np.all(z > 0)
        pior = max(pior, float(np.abs(uv1 - esperado).max()), float(np.abs(uv2 - esperado).max()),
                   float(np.abs(uv1 - uv2).max()))
        # K do C1: coluna-major, ponto principal no centro da imagem (coordenada continua, origem no canto)
        assert K[0, 2] == f["largura_px"] / 2 and K[1, 2] == f["altura_px"] / 2
        assert cam.coluna_major(K) == f["K"]
    print(f"\n[paridade camera] P1 x P2 x fixture: max {pior:.2e} px")
    assert pior < 1e-3 < TOL_PX


def test_centro_do_pixel_em_i_mais_meio():
    """Um ponto no eixo optico cai em (W/2, H/2): a fronteira entre os pixels W/2-1 e W/2 (imagem par)."""
    fx, _, _ = _dados()
    f = fx["fotos"][0]
    c = Camera.de_contrato(f)
    X = c.centro + c.R.T @ np.array([0.0, 0.0, 1000.0])
    uv, _ = c.projetar(X[None])
    assert np.allclose(uv[0], [f["largura_px"] / 2, f["altura_px"] / 2], atol=1e-6)
