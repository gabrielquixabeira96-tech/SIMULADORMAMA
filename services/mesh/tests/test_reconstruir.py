"""POST /reconstruir-foto de ponta a ponta (contrato C4) com as fotos sinteticas: contrato de saida
(reconstrucao/1.0 + malha_meta/1.0 com origem "foto"), arquivos, tempo <= 90 s, /morphs e /medir rodando
na malha do template com landmarks de origem "foto", DESENHO=A, e os erros 422 (rosto, escala, landmarks)."""

from __future__ import annotations

import json
import shutil
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from mesh import esquemas
from mesh.malha.glb import ler_json_glb
from mesh.malha.io import sha256_arquivo
from mesh.servidor import app

from .foto_util import VISTAS_3, garantir_fotos

B = {"X-Desenho": "B"}
A = {"X-Desenho": "A"}


@pytest.fixture()
def cliente(data_dir):
    return TestClient(app)


def _preparar(data_dir, pasta_torso, vistas, com_mascara=True, nome=None):
    garantir_fotos(pasta_torso)
    mid = nome or str(uuid.uuid4())
    rel = f"pacientes/P-ABCDEF/malhas/{mid}"
    md = data_dir / rel
    (md / "original").mkdir(parents=True)
    fotos = []
    for v in vistas:
        reg = json.loads((pasta_torso / "fotos" / f"registro_{v}.json").read_text(encoding="utf-8"))
        shutil.copy(pasta_torso / reg["arquivo"], md / "original" / f"foto_{v}.jpg")
        ids = list(reg["landmarks_2d"]) if v == "frente" else reg["visiveis"]
        item = {"vista": v, "arquivo": f"original/foto_{v}.jpg", "largura_px": reg["largura_px"],
                "altura_px": reg["altura_px"], "focal_35mm": reg["focal_35mm"],
                "landmarks_2d": {k: reg["landmarks_2d"][k] for k in ids}}
        if com_mascara:
            shutil.copy(pasta_torso / reg["mascara"], md / "original" / f"mascara_{v}.png")
            item["mascara"] = f"original/mascara_{v}.png"
        fotos.append(item)
    g = json.loads((pasta_torso / "gabarito.json").read_text(encoding="utf-8"))
    corpo = {"malha_dir": rel, "fotos": fotos,
             "escala": {"metodo": "ssn_n_fita", "valor_mm": g["distancias"]["ssn_n_dir"]["euclidiana_mm"],
                        "lado": "dir"}}
    return md, rel, corpo, g


def test_tres_fotos_contrato_arquivos_tempo_e_morphs(cliente, data_dir, torsos, dir_sinteticos):
    md, rel, corpo, g = _preparar(data_dir, dir_sinteticos / "t01_simetrico_300", VISTAS_3)
    t0 = time.perf_counter()
    r = cliente.post("/reconstruir-foto", json=corpo, headers=B)
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    rec, meta = r.json()["reconstrucao"], r.json()["meta"]
    print(f"\n[foto] /reconstruir-foto 3 fotos t01: {dt:.1f} s ({rec['diagnostico']['tempos_reconstrucao']}); "
          f"rms {rec['reprojecao_rms_px']} px; volumes {rec['estimado']['volumes']}")
    assert dt <= 90.0
    esquemas.validar("reconstrucao", rec)
    esquemas.validar("malha_meta", meta)
    assert meta["origem"] == "foto" and meta["quadro"] == "anatomico" and rec["quadro"] == "anatomico"
    assert rec["profundidade_confiavel"] is True and rec["qualidade"] == "boa"
    assert rec["reprojecao_rms_px"] <= 3.0 and not rec["forma_fora_do_modelo"]
    assert 30000 <= rec["malha"]["n_vertices"] <= 50000
    assert [f["vista"] for f in rec["fotos"]] == list(VISTAS_3)
    for f in rec["fotos"]:
        assert len(f["K"]) == 9 and len(f["R"]) == 9 and len(f["t"]) == 3 and f["f_origem"] == "exif"
        assert f["mascara"]["modo"] == "fornecida"
    for lado in ("dir", "esq"):
        assert abs(rec["estimado"]["volumes"][lado]["adicionado_ml"] - g["volumes"][lado]["adicionado_ml"]) \
            <= 0.10 * g["volumes"][lado]["adicionado_ml"]
    for a in ("processada.obj", "processada.mtl", "processada.glb", "textura.png", "observado.png", "meta.json",
              "reconstrucao.json", "fotos/registro.json"):
        assert (md / a).is_file(), a
    js = ler_json_glb(md / "processada.glb")
    ex = js["asset"]["extras"]
    assert ex["reconstrucao"]["fotos"] == 3 and ex["origem"] == "foto"
    # integracao P1 -> P2: a textura e a foto projetada (nao a provisoria), com o bloco no meta.json
    assert ex["textura"]["origem"] == "foto_projetada" and ex["iluminacao"]["esquema"] == "iluminacao_sh9/1.0"
    assert meta["textura"]["esquema"] == "textura_reconstruida/1.0"
    assert meta["textura"]["sha256"] == sha256_arquivo(md / "textura.png")
    assert [f["vista"] for f in meta["textura"]["fotos"]] == list(VISTAS_3)
    assert rec["malha"]["textura_provisoria"] is False and rec["malha"]["observado"] == "observado.png"
    assert rec["cobertura_observada_pct"] == round(meta["textura"]["cobertura_observada_pct"], 1)
    assert 45.0 <= rec["cobertura_observada_pct"] <= 80.0  # 3 fotos: frente + oblíqua + perfil do lado D
    assert json.loads((md / "meta.json").read_text(encoding="utf-8")) == meta
    # avaliacao contra o gabarito (a malha gravada, mesh.foto.avaliar): mesmos criterios do ajuste (P1 item 4)
    from mesh.foto.avaliar import avaliar_reconstrucao

    av = avaliar_reconstrucao(md, dir_sinteticos / "t01_simetrico_300")
    print(f"[foto] avaliacao t01 3 fotos: rms {av['rms_mm']}, volume {av['volume_erro_pct']}, "
          f"landmarks {av['landmarks_erro_mm']['max']} mm, reprojecao {av['reprojecao_rms_px']} px")
    assert all(av["rms_mm"][ax] <= 2.0 for ax in "xyz")
    assert all(abs(v) <= 10.0 for v in av["volume_erro_pct"].values())
    assert av["landmarks_erro_mm"]["max"] <= 2.0 and av["reprojecao_rms_px"] <= 3.0
    assert set(av["pose_erro_mm"]) == set(VISTAS_3) and (md / "avaliacao.json").is_file()
    assert json.loads((md / "fotos" / "registro.json").read_text(encoding="utf-8"))["fotos"] == rec["fotos"]
    # landmarks "foto" alimentam /medir e /morphs sem mudanca nessas rotas
    lm = rec["landmarks"]
    assert all(v["origem"] == "foto" and v["vertice"] < rec["malha"]["n_vertices"] for v in lm.values())
    rm = cliente.post("/medir", json={"malha_dir": rel, "landmarks": lm, "incluir_geodesica": False}, headers=B)
    assert rm.status_code == 200, rm.text


def test_morphs_com_catalogo_padrao_na_malha_do_template(cliente, data_dir, torsos, dir_sinteticos):
    from mesh.simulacao import catalogo

    md, rel, corpo, _ = _preparar(data_dir, dir_sinteticos / "t03_pequeno_ptose", ("frente", "perfil_dir"))
    r = cliente.post("/reconstruir-foto", json=corpo, headers=B)
    assert r.status_code == 200, r.text
    rec = r.json()["reconstrucao"]
    todos, _ = catalogo.carregar(None)
    rmo = cliente.post("/morphs", json={"malha_dir": rel, "landmarks": rec["landmarks"],
                                        "implantes": [next(iter(todos))], "lados": "ambos"}, headers=B)
    assert rmo.status_code == 200, rmo.text
    assert (md / "morphs" / "manifest.json").is_file()


def test_so_frontal_sem_mascara_em_desenho_a(cliente, data_dir, torsos, dir_sinteticos):
    md, rel, corpo, _ = _preparar(data_dir, dir_sinteticos / "t02_assimetrico", ("frente",), com_mascara=False)
    r = cliente.post("/reconstruir-foto", json=corpo, headers=A)
    assert r.status_code == 200, r.text
    assert r.headers["X-Desenho"] == "A"
    rec = r.json()["reconstrucao"]
    assert rec["estimado"] == {"distancias": {}, "volumes": {}}
    assert rec["profundidade_confiavel"] is False and rec["incerteza_por_eixo_mm"]["z"] >= 12.0
    assert "sem_perfil:profundidade_so_ilustracao" in rec["avisos"]
    assert "segmentacao_onnx_indisponivel" in rec["avisos"]
    assert rec["fotos"][0]["mascara"] == {"arquivo": "fotos/mascara_frente.png", "modo": "template"}
    assert (md / "fotos" / "mascara_frente.png").is_file()
    assert json.loads((md / "reconstrucao.json").read_text(encoding="utf-8"))["estimado"]["volumes"] == {}


def test_erros_422(cliente, data_dir, torsos, dir_sinteticos):
    pasta = dir_sinteticos / "t01_simetrico_300"
    md, rel, corpo, _ = _preparar(data_dir, pasta, ("frente",))
    sem_escala = {k: v for k, v in corpo.items() if k != "escala"}
    r = cliente.post("/reconstruir-foto", json=sem_escala, headers=B)
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "escala_ausente"
    poucos = json.loads(json.dumps(corpo))
    poucos["fotos"][0]["landmarks_2d"] = dict(list(poucos["fotos"][0]["landmarks_2d"].items())[:5])
    r = cliente.post("/reconstruir-foto", json=poucos, headers=B)
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "landmarks_2d_incompletos"
    sem_frente = json.loads(json.dumps(corpo))
    sem_frente["fotos"][0]["vista"] = "obliqua_dir"
    r = cliente.post("/reconstruir-foto", json=sem_frente, headers=B)
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "landmarks_2d_incompletos"
    desconhecido = json.loads(json.dumps(corpo))
    desconhecido["fotos"][0]["landmarks_2d"]["umbigo"] = [10.0, 10.0]
    r = cliente.post("/reconstruir-foto", json=desconhecido, headers=B)
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "landmark_desconhecido"
    fora = json.loads(json.dumps(corpo))
    fora["fotos"][0]["arquivo"] = "../../../etc/passwd"
    r = cliente.post("/reconstruir-foto", json=fora, headers=B)
    assert r.status_code == 400 and r.json()["erro"]["codigo"] == "caminho_invalido"
    # rosto: furcula a 30 % da altura -> 422 e as fotos da requisicao sao apagadas
    rosto = json.loads(json.dumps(corpo))
    rosto["fotos"][0]["landmarks_2d"]["furcula"][1] = 0.3 * rosto["fotos"][0]["altura_px"]
    assert (md / "original" / "foto_frente.jpg").is_file()
    r = cliente.post("/reconstruir-foto", json=rosto, headers=B)
    assert r.status_code == 422 and r.json()["erro"]["codigo"] == "rosto_possivelmente_visivel"
    assert not (md / "original" / "foto_frente.jpg").exists()
    assert r.json()["erro"]["detalhes"]["apagadas"] == ["original/foto_frente.jpg"]
    r = cliente.post("/reconstruir-foto", json=corpo, headers=B)
    assert r.status_code == 404 and r.json()["erro"]["codigo"] == "arquivo_nao_encontrado"
