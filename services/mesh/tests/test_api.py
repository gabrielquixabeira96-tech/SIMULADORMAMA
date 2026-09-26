"""API HTTP (contratos §7) e flag DESENHO (ADR 0005): modo A desliga medicao automatica e volume."""

from __future__ import annotations

import json
import shutil
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

from mesh import esquemas
from mesh.medir import antropometria as antro
from mesh.servidor import app
from mesh.validacao import landmarks_projetados

B = {"X-Desenho": "B"}
A = {"X-Desenho": "A"}
MALHA_ID = "3f1c2b7a-5d4e-4a8b-9c0d-1e2f3a4b5c6d"
MALHA_DIR = f"pacientes/P-7K2M9Q/malhas/{MALHA_ID}"


@pytest.fixture()
def cliente(data_dir):
    return TestClient(app)


@pytest.fixture()
def malha_processada(cliente, data_dir, torsos, dir_sinteticos):
    """t01 decimado copiado como upload e processado via API."""
    origem = dir_sinteticos / "t01_simetrico_300"
    pasta = data_dir / MALHA_DIR / "original"
    pasta.mkdir(parents=True)
    shutil.copy(origem / "torso.obj", pasta / "scan.obj")
    shutil.copy(origem / "torso.mtl", pasta / "torso.mtl")
    shutil.copy(origem / "textura.png", pasta / "textura.png")
    r = cliente.post("/processar", headers=B, json={
        "malha_dir": MALHA_DIR, "arquivo_original": "original/scan.obj", "unidade_origem": "mm",
        "recorte": {"modo": "abaixo_do_pescoco"},
        "decimacao": {"alvo_vertices": 40000, "min_vertices": 30000, "max_vertices": 50000}})
    assert r.status_code == 200, r.text
    gab = json.loads((origem / "gabarito.json").read_text())
    lm = landmarks_projetados(data_dir / MALHA_DIR, {k: np.array(v["posicao"]) for k, v in gab["landmarks"].items()})
    for v in lm.values():
        v["origem"] = "clique"
    return {"meta": r.json(), "landmarks": lm, "gabarito": gab}


def _corpo_medir(lm, **kw):
    eu = {k: (None if v is None else round(v, 2)) for k, v in antro.euclidianas(lm).items()}
    return {"malha_dir": MALHA_DIR, "landmarks": lm, "distancias_euclidianas_web": eu,
            "incluir_geodesica": True, "incluir_volume": True, **kw}


def test_saude(cliente):
    r = cliente.get("/saude")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok" and j["contrato"] == "1.0" and j["geodesica"]["biblioteca"] == "pygeodesic"


@pytest.mark.parametrize(("cab", "codigo"), [({}, "desenho_ausente"), ({"X-Desenho": "C"}, "desenho_invalido")])
def test_cabecalho_desenho_obrigatorio(cliente, cab, codigo):
    r = cliente.post("/validar-bland-altman", headers=cab,
                     json={"pares": [{"medida": "x", "referencia_mm": 1, "medido_mm": 1}]})
    assert r.status_code == 400 and r.json()["erro"]["codigo"] == codigo


def test_processar_meta_contrato(malha_processada, data_dir):
    meta = malha_processada["meta"]
    esquemas.validar("malha_meta", meta)
    assert meta["malha_id"] == MALHA_ID and meta["quadro"] == "scan"
    assert 30000 <= meta["processada"]["n_vertices"] <= 50000
    assert meta["original"]["tem_textura"] is True
    for arq in ("processada.obj", "processada.mtl", "processada.glb", "textura.png", "meta.json"):
        assert (data_dir / MALHA_DIR / arq).is_file()


def test_medir_desenho_b_completo_e_contrato(cliente, malha_processada):
    r = cliente.post("/medir", headers=B, json=_corpo_medir(malha_processada["landmarks"]))
    assert r.status_code == 200, r.text
    assert r.headers["X-Desenho"] == "B"
    j = r.json()
    gab = malha_processada["gabarito"]
    for k, d in j["distancias"].items():
        assert abs(d["euclidiana_mm"] - gab["distancias"][k]["euclidiana_mm"]) <= 1.0
        assert abs(d["geodesica_mm"] - gab["distancias"][k]["geodesica_mm"]) <= 1.0
    for lado in ("dir", "esq"):
        assert j["volumes"][lado]["metodo"] == "plano_base_elipse" and j["volumes"][lado]["incerteza_ml"] > 0
    assert j["quadro_anatomico"] is not None and len(j["quadro_anatomico"]["matriz"]) == 16
    # monta um medidas/1.0 com a resposta e valida contra o esquema
    medidas = {
        "esquema": "medidas/1.0", "medida_id": str(uuid.uuid4()), "malha_id": MALHA_ID, "pseudonimo": "P-7K2M9Q",
        "desenho": "B", "versao_software": "0.0.1", "versao_config": {"tepid": "1.0", "simulacao": "1.0"},
        "unidade": "mm", "quadro": "scan", "gerado_em": "2026-09-26T14:00:00-04:00",
        "gerado_por": {"componente": "mesh", "usuario_id": "local"},
        "escala": {"metodo": "gabarito", "fator": 1.0}, "landmarks": malha_processada["landmarks"],
        "quadro_anatomico": j["quadro_anatomico"], "distancias": j["distancias"], "volumes": j["volumes"],
        "geodesica": j["geodesica"], "medidas_digitadas": None,
    }
    esquemas.validar("medidas", medidas)


def test_quadro_anatomico_do_torso_sintetico_e_identidade(cliente, malha_processada):
    j = cliente.post("/medir", headers=B, json=_corpo_medir(malha_processada["landmarks"],
                                                            incluir_geodesica=False, incluir_volume=False)).json()
    M = np.array(j["quadro_anatomico"]["matriz"]).reshape(4, 4).T  # coluna-major
    # sintetico nasce no quadro anatomico (a incisura inclina o eixo Y ~1 grau)
    assert np.allclose(M[:3, :3], np.eye(3), atol=0.03)
    assert np.allclose(M[:3, 3], 0.0, atol=0.2)
    assert j["volumes"] is None
    assert all(d["geodesica_mm"] is None for d in j["distancias"].values())


def test_desenho_a_desliga_medicao_e_volume(cliente, malha_processada):
    for incluir_volume in (True, False):
        r = cliente.post("/medir", headers=A, json=_corpo_medir(malha_processada["landmarks"],
                                                                incluir_volume=incluir_volume))
        assert r.status_code == 403
        assert r.json()["erro"]["codigo"] == "desligado_no_desenho_a"
        assert r.headers["X-Desenho"] == "A"
        assert "distancias" not in r.json() and "volumes" not in r.json()


def test_desenho_a_mantem_upload_e_calibracao(cliente, malha_processada):
    r = cliente.post("/reescalar", headers=A, json={"malha_dir": MALHA_DIR, "fator": 1.01,
                                                     "regua": {"regua_mm": 100, "pontos": [[0, 0, 0], [99, 0, 0]]}})
    assert r.status_code == 200 and r.headers["X-Desenho"] == "A"
    assert r.json()["fator_escala_acumulado"] == pytest.approx(1.01)
    assert len(r.json()["escala"]["historico"]) == 1


def test_euclidiana_divergente_422(cliente, malha_processada):
    corpo = _corpo_medir(malha_processada["landmarks"])
    corpo["distancias_euclidianas_web"]["ssn_n_dir"] += 0.05
    r = cliente.post("/medir", headers=B, json=corpo)
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "euclidiana_divergente"
    assert "ssn_n_dir" in r.json()["erro"]["detalhes"]


def test_landmark_desconhecido_e_vertice_invalido(cliente, malha_processada):
    lm = dict(malha_processada["landmarks"])
    lm["umbigo"] = lm["furcula"]
    r = cliente.post("/medir", headers=B, json={"malha_dir": MALHA_DIR, "landmarks": lm})
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "landmark_desconhecido"
    lm = dict(malha_processada["landmarks"])
    lm["furcula"] = {**lm["furcula"], "vertice": 10_000_000}
    r = cliente.post("/medir", headers=B, json={"malha_dir": MALHA_DIR, "landmarks": lm})
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "vertice_invalido"


def test_caminho_fora_de_data_dir(cliente):
    r = cliente.post("/medir", headers=B, json={"malha_dir": "../../etc", "landmarks": {}})
    assert r.status_code == 400 and r.json()["erro"]["codigo"] == "caminho_invalido"
    r = cliente.post("/processar", headers=B, json={"malha_dir": "/tmp", "arquivo_original": "x.obj"})
    assert r.status_code == 400


def test_entrada_fora_do_contrato(cliente):
    r = cliente.post("/reescalar", headers=B, json={"malha_dir": MALHA_DIR, "fator": -1})
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "contrato_invalido"
    r = cliente.post("/reescalar", headers=B, content=b"{nao json", )
    assert r.status_code in (400, 422)


def _corpo_morphs(lm, **kw):
    return {"malha_dir": MALHA_DIR, "landmarks": lm,
            "implantes": ["exemplo-redondo-moderado-300", "exemplo-anatomico-alto-350"],
            "catalogo_arquivo": "exemplo.json", **kw}


@pytest.mark.parametrize("cab", [B, A])  # simulacao e ilustracao: ligada nos dois desenhos (ADR 0005)
def test_morphs_endpoint(cliente, malha_processada, data_dir, cab):
    r = cliente.post("/morphs", headers=cab, json=_corpo_morphs(malha_processada["landmarks"]))
    assert r.status_code == 200, r.text
    man = r.json()
    esquemas.validar("morphs_manifest", man)
    assert man["malha_id"] == MALHA_ID and man["lados"] == "separados" and man["nao_calibrado"] is True
    assert len(man["arquivos"]) == 4 and all(len(a["targets"]) == 6 for a in man["arquivos"])
    pasta = data_dir / MALHA_DIR / "morphs"
    assert json.loads((pasta / "manifest.json").read_text()) == man
    from mesh.malha.io import sha256_arquivo

    assert man["sha256_malha_base"] == sha256_arquivo(data_dir / MALHA_DIR / "processada.glb")
    for a in man["arquivos"]:
        assert sha256_arquivo(pasta / a["arquivo"]) == a["sha256"]


def test_morphs_so_ambos_e_subconjunto(cliente, malha_processada):
    r = cliente.post("/morphs", headers=B, json=_corpo_morphs(malha_processada["landmarks"], lados="ambos",
                                                             planos=["dual_plane"], imfs=["rebaixar"]))
    assert r.status_code == 200, r.text
    (a,) = r.json()["arquivos"]
    assert a["arquivo"] == "dual_plane__rebaixar.glb" and [t["lado"] for t in a["targets"]] == ["ambos", "ambos"]


def test_morphs_erros(cliente, malha_processada):
    lm = malha_processada["landmarks"]
    r = cliente.post("/morphs", headers=B, json={**_corpo_morphs(lm), "implantes": ["nao-existe-300"]})
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "implante_desconhecido"
    sem_base = {k: v for k, v in lm.items() if not k.startswith("base_")}
    r = cliente.post("/morphs", headers=B, json=_corpo_morphs(sem_base))
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "landmarks_da_base_ausentes"
    r = cliente.post("/morphs", headers=B, json={**_corpo_morphs(lm), "catalogo_arquivo": "../simulacao.json"})
    assert r.status_code == 400
    r = cliente.post("/morphs", headers=B, json={**_corpo_morphs(lm), "planos": ["submuscular"]})
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "contrato_invalido"


def test_bland_altman_endpoint(cliente):
    pares = [{"medida": "ssn_n_dir", "referencia_mm": 200.0, "medido_mm": 200.0 + d, "torso": "t01_simetrico_300",
              "operador": "op1"} for d in (0.5, -0.5, 1.0, 0.0)]
    r = cliente.post("/validar-bland-altman", headers=B, json={"pares": pares})
    assert r.status_code == 200
    j = r.json()
    assert j["n"] == 4 and j["vies_mm"] == pytest.approx(0.25)
    dp = float(np.std([0.5, -0.5, 1.0, 0.0], ddof=1))
    assert j["dp_mm"] == pytest.approx(dp, abs=1e-4)
    assert j["loa_superior_mm"] == pytest.approx(0.25 + 1.96 * dp, abs=1e-3)
    assert j["dentro_de_2mm"] is True and j["por_medida"]["ssn_n_dir"]["n"] == 4


def test_torso_sintetico_endpoint(cliente, data_dir):
    p = dict(esquemas.presets_torso()["t01_simetrico_300"])
    p.update({"nome": "t99_api", "resolucao": {"densa_faces": 60000, "decimada_vertices": 30000}})
    r = cliente.post("/torso-sintetico", headers=B, json={**p, "saida_dir": "sinteticos"})
    assert r.status_code == 200, r.text
    esquemas.validar("gabarito", r.json())
    assert (data_dir / "sinteticos/t99_api/torso.glb").is_file()
    ruim = {**p, "largura_toracica_mm": 10}
    r = cliente.post("/torso-sintetico", headers=B, json={**ruim, "saida_dir": "sinteticos"})
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "contrato_invalido"
    r = cliente.post("/torso-sintetico", headers=B, json={**p, "saida_dir": "../fora"})
    assert r.status_code == 400
