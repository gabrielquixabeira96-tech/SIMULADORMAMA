"""Fixtures compartilhadas. Os 3 torsos presets sao gerados uma vez por sessao em diretorio temporario
(nada vai para data/ nem para o git)."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

from mesh import esquemas
from mesh.malha.io import MalhaRender
from tests.foto_render import cena_t01, reconstrucao_t01  # noqa: F401 (fixtures do P2: foto -> atlas)

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


CATALOGO_TESTE = Path(__file__).parent / "fixtures" / "catalogo_teste.json"


@pytest.fixture(scope="session")
def implantes_teste() -> dict[str, dict]:
    from mesh.simulacao import catalogo

    return catalogo.carregar([CATALOGO_TESTE])[0]


@pytest.fixture(scope="session")
def morphs_gerados(torsos, dir_sinteticos, implantes_teste) -> dict[str, dict]:
    """nome -> manifest (com `_duracao_s`, `_n_targets`, `_bytes`) dos morphs com o catalogo de teste."""
    import json
    import uuid

    from mesh.simulacao.morphs import gerar_morphs

    saida = {}
    for nome in torsos:
        pasta = dir_sinteticos / nome
        gab = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
        saida[nome] = gerar_morphs(pasta, gab["landmarks"], list(implantes_teste.values()),
                                   malha_id=str(uuid.uuid5(uuid.NAMESPACE_URL, nome)), arquivo_obj="torso.obj",
                                   arquivo_glb="torso.glb", quadro="anatomico")
    return saida
