"""Gerador de torso sintetico: dimensoes conhecidas, gabarito, textura neutra, GLB."""

from __future__ import annotations

import json

import numpy as np
import pytest

from mesh import esquemas
from mesh.malha.glb import ler_json_glb
from mesh.malha.io import ler_malha
from mesh.sintetico.superficie import TOPO_ACIMA_FURCULA_MM, Torso
from mesh.sintetico.textura import COR_BASE, textura_neutra

from .conftest import PRESETS


def _pos(g, nome):
    return np.array(g["landmarks"][nome]["posicao"])


@pytest.mark.parametrize("nome", PRESETS)
def test_arquivos_e_esquema(torsos, dir_sinteticos, nome):
    pasta = dir_sinteticos / nome
    for arq in ("parametros.json", "gabarito.json", "denso.obj", "torso.obj", "torso.mtl", "textura.png", "torso.glb"):
        assert (pasta / arq).is_file(), arq
    gab = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
    esquemas.validar("gabarito", gab)
    assert gab["quadro"] == "anatomico" and gab["unidade"] == "mm"
    assert (gab["geodesica"]["algoritmo"], gab["geodesica"]["biblioteca"], gab["geodesica"]["malha"]) == (
        "mmp", "pygeodesic", "densa")
    assert "map_Kd textura.png" in (pasta / "torso.mtl").read_text()


@pytest.mark.parametrize("nome", PRESETS)
def test_dimensoes_conhecidas(torsos, dir_sinteticos, nome):
    g = torsos[nome]
    p = g["parametros"]
    densa = ler_malha(dir_sinteticos / nome / "denso.obj")
    dec = ler_malha(dir_sinteticos / nome / "torso.obj")
    for m, tol in ((densa, 0.05), (dec, 1.0)):
        ext = m.V.max(0) - m.V.min(0)
        assert abs(ext[0] - p["largura_toracica_mm"]) <= tol  # largura da parede = parametro
        assert abs(m.V[:, 1].min() + p["altura_torso_mm"]) <= tol
        assert abs(m.V[:, 1].max() - TOPO_ACIMA_FURCULA_MM) <= tol
    # furcula na origem exata; mamilos a frente da parede e do lado certo (+X = esquerda)
    assert np.allclose(_pos(g, "furcula"), 0.0)
    assert _pos(g, "mamilo_esq")[0] > 0 > _pos(g, "mamilo_dir")[0]
    assert _pos(g, "mamilo_esq")[2] > 20 and _pos(g, "mamilo_dir")[2] > 20
    # n_imf: distancia vertical mamilo-sulco = parametro (parede vertical na regiao da mama)
    for lado in ("dir", "esq"):
        dy = _pos(g, f"mamilo_{lado}")[1] - _pos(g, f"sulco_{lado}")[1]
        assert abs(dy - p["n_imf_mm"][lado]) <= 0.05
        # volume adicionado real = pedido (resolvido na malha densa)
        assert abs(g["volumes"][lado]["adicionado_ml"] - p["volume_ml"][lado]) <= 0.1
    # contagens
    assert 30000 <= g["malha"]["decimada"]["n_vertices"] <= 50000
    assert g["malha"]["densa"]["n_faces"] == pytest.approx(p["resolucao"]["densa_faces"], rel=0.02)


def test_simetria_t01(torsos):
    g = torsos["t01_simetrico_300"]
    espelho = np.array([-1.0, 1.0, 1.0])
    for a, b in (("mamilo_dir", "mamilo_esq"), ("sulco_dir", "sulco_esq"),
                 ("base_medial_dir", "base_medial_esq"), ("base_lateral_dir", "base_lateral_esq")):
        assert np.allclose(_pos(g, a) * espelho, _pos(g, b), atol=1e-3)
    d = g["distancias"]
    for par in (("ssn_n_dir", "ssn_n_esq"), ("n_imf_dir", "n_imf_esq"), ("base_dir", "base_esq")):
        assert abs(d[par[0]]["euclidiana_mm"] - d[par[1]]["euclidiana_mm"]) <= 0.01
        assert abs(d[par[0]]["geodesica_mm"] - d[par[1]]["geodesica_mm"]) <= 0.2
    assert _pos(g, "linha_media_inferior")[0] == pytest.approx(0.0, abs=1e-9)


def test_assimetria_t02(torsos):
    g = torsos["t02_assimetrico"]
    p = g["parametros"]
    # y_mamilo = -(165 + 60*ptose) (+ delta_altura na esquerda)
    esperado = (-(165 + 60 * p["ptose"]["esq"]) + p["assimetria"]["delta_altura_mamilo_mm"]) - (
        -(165 + 60 * p["ptose"]["dir"]))
    assert _pos(g, "mamilo_esq")[1] - _pos(g, "mamilo_dir")[1] == pytest.approx(esperado, abs=0.01)
    assert abs(_pos(g, "mamilo_esq")[0]) > abs(_pos(g, "mamilo_dir")[0])  # esquerda mais lateral
    assert g["volumes"]["dir"]["adicionado_ml"] == pytest.approx(350.0, abs=0.1)
    assert g["volumes"]["esq"]["adicionado_ml"] == pytest.approx(280.0, abs=0.1)


def test_distancias_do_gabarito_coerentes(torsos):
    for g in torsos.values():
        for k, d in g["distancias"].items():
            # geodesica sobre a pele nunca menor que a corda
            assert d["geodesica_mm"] >= d["euclidiana_mm"] - 0.01, k
            a, b = {"ssn_n_dir": ("furcula", "mamilo_dir"), "ssn_n_esq": ("furcula", "mamilo_esq"),
                    "n_imf_dir": ("mamilo_dir", "sulco_dir"), "n_imf_esq": ("mamilo_esq", "sulco_esq"),
                    "base_dir": ("base_medial_dir", "base_lateral_dir"),
                    "base_esq": ("base_medial_esq", "base_lateral_esq"),
                    "intermamilar": ("mamilo_dir", "mamilo_esq")}[k]
            assert d["euclidiana_mm"] == pytest.approx(np.linalg.norm(_pos(g, a) - _pos(g, b)), abs=0.006)


def test_superficie_deterministica_e_textura_neutra():
    """Textura neutra do Marco 0 (hoje `textura.realismo: "esquematico"`; ADR 0020)."""
    p = esquemas.completar_parametros(esquemas.presets_torso()["t02_assimetrico"])
    s, y = np.array([10.0, -80.0, 120.0]), np.array([-5.0, -200.0, -260.0])
    assert np.array_equal(Torso(p).avaliar(s, y), Torso(p).avaliar(s, y))
    a, b, c = textura_neutra(42), textura_neutra(42), textura_neutra(43)
    assert a.size == (1024, 1024) and a.mode == "RGB"
    assert a.tobytes() == b.tobytes() and a.tobytes() != c.tobytes()
    arr = np.asarray(a, dtype=float)
    # tom liso: todos os pixels a <= 8 niveis da cor base; nada de desenho/foto
    assert np.abs(arr - COR_BASE).max() <= 8.0
    # periodica em u: primeira e ultima coluna vizinhas
    assert np.abs(arr[:, 0] - arr[:, -1]).max() <= 3.0


@pytest.mark.parametrize("nome", PRESETS)
def test_glb_contrato(torsos, dir_sinteticos, nome):
    import trimesh

    pasta = dir_sinteticos / nome
    js = ler_json_glb(pasta / "torso.glb")
    assert js["asset"]["extras"]["unidade"] == "mm" and js["asset"]["extras"]["quadro"] == "anatomico"
    assert js["asset"]["generator"].startswith("simulador-mamario/mesh ")
    assert len(js["meshes"]) == 1 and len(js["meshes"][0]["primitives"]) == 1
    prim = js["meshes"][0]["primitives"][0]
    assert prim["mode"] == 4 and {"POSITION", "NORMAL", "TEXCOORD_0"} <= set(prim["attributes"])
    assert js["accessors"][prim["indices"]]["componentType"] == 5125  # uint32
    assert "matrix" not in js["nodes"][0] and "scale" not in js["nodes"][0]
    obj = ler_malha(pasta / "torso.obj")
    glb = trimesh.load(pasta / "torso.glb", process=False, force="mesh")
    assert len(glb.vertices) == obj.n_vertices
    assert np.abs(np.asarray(glb.vertices) - obj.V).max() < 1e-3  # mesma ordem de vertices
    assert np.array_equal(np.asarray(glb.faces), obj.F)


@pytest.mark.parametrize("nome", PRESETS)
def test_normais_para_fora_e_uv_sem_arrasto(torsos, dir_sinteticos, nome):
    m = ler_malha(dir_sinteticos / nome / "torso.obj")
    a, b, c = (m.V[m.F[:, k]] for k in range(3))
    fn = np.cross(b - a, c - a)
    centro = m.V.mean(0)
    radial = (a + b + c) / 3 - centro
    radial[:, 1] = 0
    assert (np.einsum("ij,ij->i", fn, radial) > 0).mean() > 0.99
    # nenhuma face "atravessa" a costura de UV (arrasto de textura): em unidades de mm da grade
    # (u * perimetro, v * altura) cada aresta de UV tem ~o comprimento da aresta 3D; na costura seria ~perimetro
    g = torsos[nome]
    per = Torso(esquemas.completar_parametros(g["parametros"])).secao.perimetro
    alt = g["parametros"]["altura_torso_mm"] + TOPO_ACIMA_FURCULA_MM
    uvmm = m.uv * np.array([per, alt])
    razoes = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        d3 = np.linalg.norm(m.V[m.F[:, i]] - m.V[m.F[:, j]], axis=1)
        duv = np.linalg.norm(uvmm[m.F[:, i]] - uvmm[m.F[:, j]], axis=1)
        razoes.append(duv / np.maximum(d3, 1e-9))
    assert np.max(razoes) < 1.5


def test_torso_esquematico_textura_neutra_e_morphs_antigos_apagados(tmp_path):
    """`textura.realismo: "esquematico"` gera exatamente a textura neutra (1024 x 1024) e o gabarito
    registra o bloco `textura`; regerar o torso apaga `morphs/` (derivados da malha/textura antigas);
    `torso_atualizado` reconhece o que ja esta gerado e o que ficou para tras."""
    import json

    from mesh.sintetico.gerador import gerar_torso, torso_atualizado

    p = dict(esquemas.presets_torso()["t01_simetrico_300"])
    p.update({"nome": "t98_esquematico", "resolucao": {"densa_faces": 60000, "decimada_vertices": 30000},
              "textura": {"realismo": "esquematico"}})
    pasta = tmp_path / "t98_esquematico"
    (pasta / "morphs").mkdir(parents=True)
    (pasta / "morphs" / "velho.glb").write_bytes(b"glTF")
    assert not torso_atualizado(pasta, p)
    g = gerar_torso(p, tmp_path, escrever_densa=False)
    assert not (pasta / "morphs").exists()
    esquemas.validar("gabarito", {k: v for k, v in g.items() if not k.startswith("_")})
    assert g["textura"]["realismo"] == "esquematico" and g["textura"]["sh9"][1:] == [0.0] * 8
    from PIL import Image

    with Image.open(pasta / "textura.png") as im:
        assert im.size == (1024, 1024)
        assert im.convert("RGB").tobytes() == textura_neutra(p["semente"]).tobytes()
    assert torso_atualizado(pasta, p)
    assert not torso_atualizado(pasta, {**p, "semente": 7})
    assert not torso_atualizado(pasta, {**p, "textura": {"realismo": "fotografico"}})
    gab = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
    gab.pop("textura")  # gabarito da v0.1.x: sem textura.esquema -> desatualizado
    (pasta / "gabarito.json").write_text(json.dumps(gab), encoding="utf-8")
    assert not torso_atualizado(pasta, p)


def test_cli_se_desatualizado_pula_o_que_ja_esta_gerado(torsos, dir_sinteticos, capsys):
    from mesh import cli

    antes = (dir_sinteticos / "t03_pequeno_ptose" / "gabarito.json").stat().st_mtime_ns
    assert cli.main(["torso", "--preset", "t03_pequeno_ptose", "--saida", str(dir_sinteticos),
                     "--se-desatualizado"]) == 0
    assert "nada a regerar" in capsys.readouterr().out
    assert (dir_sinteticos / "t03_pequeno_ptose" / "gabarito.json").stat().st_mtime_ns == antes


def test_preset_fotografico_nao_e_a_textura_neutra(torsos, dir_sinteticos):
    from PIL import Image

    with Image.open(dir_sinteticos / "t01_simetrico_300" / "textura.png") as im:
        arr = np.asarray(im.convert("RGB"), dtype=float)
    assert arr.shape[1] > 1024 and arr.shape[0] > 1024  # 4 px/mm, nao 1024 x 1024
    assert np.abs(arr - COR_BASE).max() > 60            # ha areola/mamilo e sombra: nao e o tom liso
