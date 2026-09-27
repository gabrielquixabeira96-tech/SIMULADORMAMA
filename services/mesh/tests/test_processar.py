"""Pre-processamento: unidade, recorte abaixo do pescoco, limpeza, decimacao, PLY com cor, caminhos."""

from __future__ import annotations

import numpy as np
import pytest

from mesh import caminhos
from mesh.malha.glb import ler_json_glb
from mesh.malha.io import MalhaRender
from mesh.processar.pipeline import detectar_corte_pescoco, inferir_unidade, limpar, processar_malha

from .conftest import tubo


def _perfil_com_pescoco(y):
    """Torax 300 mm ate y=25; transicao para pescoco de 110 mm (y 55..140); cabeca 160 mm acima."""
    if y <= 25:
        return 300.0
    if y <= 55:
        return 300.0 - (y - 25) / 30 * 190
    if y <= 140:
        return 110.0
    if y <= 170:
        return 110.0 + (y - 140) / 30 * 50
    return 160.0


def test_recorte_abaixo_do_pescoco():
    m = tubo(_perfil_com_pescoco, -300, 260, n_ang=160, n_y=281)
    y_corte = detectar_corte_pescoco(m.V)
    # pescoco (plato 55..140) -> centro ~97,5 mm; corte 30 mm abaixo
    assert y_corte == pytest.approx(97.5 - 30.0, abs=6.0)
    res = processar_malha(m, "mm", {"modo": "abaixo_do_pescoco"},
                          {"alvo_vertices": 20000, "min_vertices": 1000, "max_vertices": 50000})
    assert res.recorte_aplicado
    assert res.malha.V[:, 1].max() <= y_corte + 1e-6
    assert res.malha.V[:, 1].min() == pytest.approx(-300.0, abs=1e-6)  # torax preservado


def test_sem_pescoco_nao_recorta_e_avisa():
    m = tubo(lambda y: 300.0, -450, 25, n_ang=100, n_y=100)
    res = processar_malha(m, "mm", {"modo": "abaixo_do_pescoco"},
                          {"alvo_vertices": 5000, "min_vertices": 1000, "max_vertices": 50000})
    assert not res.recorte_aplicado and "pescoco_nao_detectado_sem_recorte" in res.avisos


def test_recorte_caixa():
    m = tubo(lambda y: 300.0, -450, 25, n_ang=100, n_y=100)
    res = processar_malha(m, "mm", {"modo": "caixa", "y_min_mm": -300, "y_max_mm": 0},
                          {"alvo_vertices": 5000, "min_vertices": 100, "max_vertices": 50000})
    assert res.malha.V[:, 1].min() >= -300 - 1e-9 and res.malha.V[:, 1].max() <= 1e-9


def test_decimacao_para_faixa_e_minimo():
    m = tubo(lambda y: 300.0, -450, 25, n_ang=400, n_y=300)  # 120 mil vertices
    res = processar_malha(m, "mm", {"modo": "nenhum"}, None)
    assert 30000 <= res.malha.n_vertices <= 50000
    pequeno = tubo(lambda y: 300.0, -450, 25, n_ang=60, n_y=60)
    res2 = processar_malha(pequeno, "mm", {"modo": "nenhum"}, None)
    assert res2.malha.n_vertices == 3600
    assert any(a.startswith("abaixo_do_minimo_sem_decimacao") for a in res2.avisos)


@pytest.mark.parametrize(("escala", "esperada"), [(0.001, "m"), (0.1, "cm"), (1.0, "mm")])
@pytest.mark.parametrize("altura", [250.0, 475.0, 625.0, 1400.0])
def test_unidade_inferida(escala, esperada, altura):
    # ADR 0013: um torso de 475 mm em mm deixou de ser classificado como cm
    m = tubo(lambda y: 300.0, -altura, 0.0, n_ang=40, n_y=40)
    assert inferir_unidade(m.V * escala) == esperada
    res = processar_malha(MalhaRender(V=m.V * escala, F=m.F), "desconhecida", {"modo": "nenhum"},
                          {"alvo_vertices": 1000, "min_vertices": 100, "max_vertices": 5000})
    assert res.unidade_inferida == esperada
    ext = res.malha.V.max(0) - res.malha.V.min(0)
    assert ext[0] == pytest.approx(300.0, rel=1e-6)  # de volta a mm


def test_limpeza_mantem_maior_componente():
    m = tubo(lambda y: 300.0, -450, 25, n_ang=40, n_y=40)
    ilha = tubo(lambda y: 20.0, 500, 520, n_ang=8, n_y=3)
    V = np.vstack([m.V, ilha.V])
    F = np.vstack([m.F, ilha.F + len(m.V), [[0, 0, 1]]])  # + face degenerada
    V2, F2, avisos = limpar(V, F)
    assert len(V2) == len(m.V) and len(F2) == len(m.F)
    assert any(a.startswith("componentes_menores_removidos") for a in avisos)


def test_ply_com_cor_vira_color_0(data_dir):
    import trimesh

    from mesh import servico

    m = tubo(lambda y: 300.0, -450, 25, n_ang=40, n_y=40)
    cores = np.tile(np.array([[200, 180, 170, 255]], dtype=np.uint8), (len(m.V), 1))
    pasta = data_dir / "pacientes/P-7K2M9Q/malhas/0b0e7a4e-2a57-4d1c-9a51-8f0f5a1d2c3e/original"
    pasta.mkdir(parents=True)
    trimesh.Trimesh(m.V / 1000.0, m.F, vertex_colors=cores, process=False).export(pasta / "scan.ply")
    meta = servico.processar({"malha_dir": "pacientes/P-7K2M9Q/malhas/0b0e7a4e-2a57-4d1c-9a51-8f0f5a1d2c3e",
                              "arquivo_original": "original/scan.ply", "unidade_origem": "m",
                              "recorte": {"modo": "nenhum"},
                              "decimacao": {"alvo_vertices": 1000, "min_vertices": 100, "max_vertices": 5000}})
    assert meta["malha_id"] == "0b0e7a4e-2a57-4d1c-9a51-8f0f5a1d2c3e"
    js = ler_json_glb(pasta.parent / "processada.glb")
    assert "COLOR_0" in js["meshes"][0]["primitives"][0]["attributes"]
    assert meta["processada"]["caixa_mm"]["max"][0] == pytest.approx(150.0, abs=0.01)


@pytest.mark.parametrize("ruim", ["../fora", "/etc/passwd", "a/../../b", "", "a\\b"])
def test_caminhos_fora_de_data_dir_recusados(data_dir, ruim):
    with pytest.raises(caminhos.CaminhoInvalido):
        caminhos.resolver(ruim)


def test_link_simbolico_para_fora_recusado(data_dir, tmp_path):
    fora = tmp_path / "fora"
    fora.mkdir()
    (data_dir / "atalho").symlink_to(fora)
    with pytest.raises(caminhos.CaminhoInvalido):
        caminhos.resolver("atalho/x.obj")
    assert caminhos.resolver("pacientes/x") == data_dir.resolve() / "pacientes/x"


def test_data_dir_relativo_resolve_pela_raiz_do_repo_nao_pelo_cwd(monkeypatch, tmp_path):
    """Revisao v0.1.1, item 18: DATA_DIR=./data (do .env) aponta para <raiz>/data no web E no Python,
    mesmo com o servico rodando de services/mesh (cwd)."""
    from mesh.versao import RAIZ_REPO

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_DIR", "./data")
    assert caminhos.data_dir() == (RAIZ_REPO / "data").resolve()
    monkeypatch.setenv("DATA_DIR", "outra/pasta")
    assert caminhos.data_dir() == (RAIZ_REPO / "outra/pasta").resolve()
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "abs"))
    assert caminhos.data_dir() == (tmp_path / "abs").resolve()
    monkeypatch.delenv("DATA_DIR")
    assert caminhos.data_dir() == (RAIZ_REPO / "data").resolve()
    monkeypatch.setenv("CONFIG_DIR", "config")
    assert caminhos.config_dir() == (RAIZ_REPO / "config").resolve()
