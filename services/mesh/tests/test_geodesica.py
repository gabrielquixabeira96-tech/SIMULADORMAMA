"""Geodesica MMP com insercao de pontos exatos: casos analiticos (plano e cilindro)."""

from __future__ import annotations

import numpy as np
import pytest

from mesh.medir.geodesica import geodesicas_entre_pontos

from .conftest import tubo


def test_plano_geodesica_igual_a_euclidiana():
    xs = np.linspace(-100, 100, 81)
    X, Y = np.meshgrid(xs, xs, indexing="ij")
    V = np.stack([X.ravel(), Y.ravel(), np.zeros(X.size)], 1)
    idx = np.arange(X.size).reshape(X.shape)
    a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    F = np.concatenate([np.stack([a, b, c], -1).reshape(-1, 3), np.stack([a, c, d], -1).reshape(-1, 3)])
    pts = {"a": np.array([-71.3, 12.7, 0.0]), "b": np.array([64.9, -33.1, 0.0]), "c": np.array([0.6, 88.2, 0.0])}
    d = geodesicas_entre_pontos(V, F, pts, {"ab": ("a", "b"), "bc": ("b", "c")})
    assert d["ab"] == pytest.approx(np.linalg.norm(pts["a"] - pts["b"]), abs=1e-3)
    assert d["bc"] == pytest.approx(np.linalg.norm(pts["b"] - pts["c"]), abs=1e-3)


def test_cilindro_helice():
    r = 100.0
    m = tubo(lambda y: 2 * r, -200, 200, n_ang=720, n_y=401, prof_fator=1.0)
    th1, th2, y1, y2 = 0.1, 1.3, -120.0, 90.0
    p1 = np.array([r * np.sin(th1), y1, r * np.cos(th1)])
    p2 = np.array([r * np.sin(th2), y2, r * np.cos(th2)])
    d = geodesicas_entre_pontos(m.V, m.F, {"a": p1, "b": p2}, {"ab": ("a", "b")})
    analitico = np.hypot(r * (th2 - th1), y2 - y1)  # geodesica no cilindro liso
    assert d["ab"] == pytest.approx(analitico, rel=2e-3)
