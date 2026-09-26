"""Fixtures compartilhadas. Os 3 torsos presets sao gerados uma vez por sessao em diretorio temporario
(nada vai para data/ nem para o git)."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

from mesh import esquemas
from mesh.malha.io import MalhaRender

PRESETS = ("t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose")


@pytest.fixture(scope="session")
def dir_sinteticos(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("sinteticos")


@pytest.fixture(scope="session")
def torsos(dir_sinteticos) -> dict[str, dict]:
    """nome -> gabarito (com chaves internas `_duracao_s`, `_amplitudes_mm`)."""
    from mesh.sintetico.gerador import gerar_torso

    presets = esquemas.presets_torso()
    return {n: gerar_torso(presets[n], dir_sinteticos) for n in PRESETS}


@pytest.fixture(scope="session")
def cenarios(torsos, dir_sinteticos) -> dict[str, dict]:
    """nome -> resultado de validacao.medir_cenarios (decimada, processar_denso_m, reescala_regua)."""
    from mesh.validacao import medir_cenarios

    return {n: medir_cenarios(dir_sinteticos / n) for n in torsos}


@pytest.fixture()
def data_dir(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setenv("DATA_DIR", str(d))
    return d


def tubo(perfil, y0: float, y1: float, n_ang: int = 120, n_y: int = 200, prof_fator: float = 0.7) -> MalhaRender:
    """Tubo aberto de secao eliptica com largura(y) = perfil(y). Faces anti-horarias vistas de fora."""
    th = np.linspace(0, 2 * np.pi, n_ang, endpoint=False)
    ys = np.linspace(y0, y1, n_y)
    T, Y = np.meshgrid(th, ys, indexing="ij")
    W = np.vectorize(perfil)(Y)
    X = 0.5 * W * np.sin(T)
    Z = 0.5 * prof_fator * W * np.cos(T)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    idx = np.arange(n_ang * n_y).reshape(n_ang, n_y)
    a, b = idx, np.roll(idx, -1, 0)
    a, b, c, d = a[:, :-1], b[:, :-1], b[:, 1:], a[:, 1:]
    F = np.concatenate([np.stack([a, b, c], -1).reshape(-1, 3), np.stack([a, c, d], -1).reshape(-1, 3)])
    return MalhaRender(V=V, F=F)


os.environ.setdefault("PYTHONHASHSEED", "0")
