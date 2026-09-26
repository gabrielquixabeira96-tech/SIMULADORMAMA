"""Marco 2 (Python): modelo geometrico-parametrico e morph targets glTF (contratos §9, §10, §12)."""

from __future__ import annotations

import json
import os
import re
import struct

import numpy as np
import pytest

from mesh import esquemas
from mesh.malha.geometria import normais_vertices, soldar
from mesh.malha.io import ler_malha
from mesh.simulacao import interfaces
from mesh.simulacao.geometrico import (
    CHAVES_MODELO,
    ErroSimulacao,
    SimuladorGeometrico,
    coeficientes,
    expoente_perfil,
    montar_campo,
    perfil_implante,
    previsto,
)

from .conftest import PRESETS

SNAPSHOT = os.path.join(os.path.dirname(__file__), "fixtures", "snapshot_morphs_t01.json")
PLANOS, IMFS = ("subglandular", "dual_plane"), ("manter", "rebaixar")
REDONDOS = ["teste-redondo-moderado-250", "teste-redondo-moderado-300", "teste-redondo-moderado-350",
            "teste-redondo-moderado-400"]
ANATOMICOS = ["teste-anatomico-alto-280", "teste-anatomico-alto-350"]


def _cfg():
    return esquemas.config_simulacao()


def _malha(dir_sinteticos, nome):
    m = ler_malha(dir_sinteticos / nome / "torso.obj")
    gab = json.loads((dir_sinteticos / nome / "gabarito.json").read_text(encoding="utf-8"))
    Vw, Fw, mapa = soldar(m.V, m.F)
    return m, gab, Vw, Fw, normais_vertices(Vw, Fw)


# ----------------------------------------------------------------------------- config sem fallback

def test_todos_os_coeficientes_do_modelo_vem_da_config_nao_calibrados():
    """Revisao v0.1.1, item 9: profundidade, 'pele da frente' e rampa da normal estao na config
    (nao_calibrado) com os valores que eram fixos no codigo (40, -60, 30, 0,3)."""
    cfg = _cfg()
    mg = cfg["modelo_geometrico"]
    assert set(CHAVES_MODELO) <= set(mg)
    assert all(mg[k]["nao_calibrado"] is True for k in CHAVES_MODELO)
    c = coeficientes(cfg, "dual_plane")
    fixos = (c.prof_sigma_mm, c.frente_prof_min_mm, c.frente_prof_rampa_mm, c.frente_normal_rampa)
    assert fixos == (40.0, -60.0, 30.0, 0.3)
    esquemas.validar("simulacao_config", cfg)


@pytest.mark.parametrize("caminho", [("modelo_geometrico", k) for k in CHAVES_MODELO]
                         + [("planos", "dual_plane", "suavizacao_sigma_mm"), ("imf", "rebaixar", "maximo_mm"),
                            ("tecido_mole", "espessura_referencia_mm"), ("modelo_geometrico",)])
def test_chave_ausente_na_config_falha_sem_fallback(caminho):
    import copy

    cfg = copy.deepcopy(_cfg())
    no = cfg
    for k in caminho[:-1]:
        no = no[k]
    del no[caminho[-1]]
    with pytest.raises(ErroSimulacao, match="config_simulacao_incompleta"):
        coeficientes(cfg, "dual_plane")
    # o schema tambem recusa a config incompleta
    with pytest.raises(esquemas.ErroContrato):
        esquemas.validar("simulacao_config", cfg)


def test_coeficiente_da_config_realmente_muda_o_campo(dir_sinteticos, implantes_teste):
    """Trocar `frente_normal_rampa` na config muda o deslocamento: o valor nao esta fixo no codigo."""
    import copy

    _, gab, Vw, _, Nw = _malha(dir_sinteticos, "t01_simetrico_300")
    imp = implantes_teste["teste-redondo-moderado-300"]
    base = montar_campo(gab["landmarks"], "dir", imp, "dual_plane", "manter", _cfg()).deslocamento(Vw, Nw)
    cfg = copy.deepcopy(_cfg())
    cfg["modelo_geometrico"]["frente_normal_rampa"]["valor"] = 0.9
    outro = montar_campo(gab["landmarks"], "dir", imp, "dual_plane", "manter", cfg).deslocamento(Vw, Nw)
    assert np.abs(outro - base).max() > 0.1


# ----------------------------------------------------------------------------- forma do implante

@pytest.mark.parametrize("iid", REDONDOS + ANATOMICOS)
def test_forma_do_implante_tem_o_volume_do_catalogo(implantes_teste, iid):
    imp = implantes_teste[iid]
    c = coeficientes(_cfg(), "subglandular")
    _, no_limite = expoente_perfil(imp["volume_ml"], imp["base_mm"], imp["altura_mm"], imp["projecao_mm"], c.gama)
    assert not no_limite
    passo = 0.25
    xs = np.arange(-imp["base_mm"] / 2 - 1, imp["base_mm"] / 2 + 1, passo)
    ys = np.arange(-imp["altura_mm"] - 1, imp["altura_mm"] + 1, passo)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    h = perfil_implante(imp, X, Y, c)
    assert h.max() == pytest.approx(imp["projecao_mm"], rel=1e-3)
    assert h.sum() * passo**2 / 1000 == pytest.approx(imp["volume_ml"], rel=0.01)
    ext_y = Y[h > 0]
    if imp["forma"] == "anatomica":  # apice a 62 % da altura, de cima para baixo -> polo inferior menor
        assert ext_y.max() == pytest.approx(0.62 * imp["altura_mm"], abs=1.0)
        assert -ext_y.min() == pytest.approx(0.38 * imp["altura_mm"], abs=1.0)
    else:
        assert ext_y.max() == pytest.approx(-ext_y.min(), abs=0.5)


# ----------------------------------------------------------------------------- propriedades

@pytest.mark.parametrize("plano", PLANOS)
@pytest.mark.parametrize("imf", IMFS)
@pytest.mark.parametrize("nome", PRESETS)
def test_monotonicidade_volume_maior_projeta_mais(torsos, dir_sinteticos, implantes_teste, nome, plano, imf):
    m, gab, Vw, Fw, Nw = _malha(dir_sinteticos, nome)
    sim = SimuladorGeometrico()
    proj_prev, proj_malha, vol_desl = [], [], []
    for iid in REDONDOS:  # mesmo perfil (redondo moderado), mesmo plano e IMF
        campos = sim.campos(gab["landmarks"], implantes_teste[iid], plano, imf, "ambos", _cfg())
        pv = previsto(campos, gab["landmarks"])
        proj_prev.append(pv["delta_projecao_mamilo_mm"]["dir"])
        D = sum(c.deslocamento(Vw, Nw) for c in campos)
        iv = gab["landmarks"]["mamilo_dir"]["vertice"]
        vw = soldar(m.V, m.F)[2][iv]
        proj_malha.append(float(D[vw] @ campos[0].d_ant))
        vol_desl.append(float(np.linalg.norm(D, axis=1).sum()))
    for serie in (proj_prev, proj_malha, vol_desl):
        assert all(b > a for a, b in zip(serie, serie[1:], strict=False)), serie


def test_simetria_t01(torsos, dir_sinteticos, implantes_teste):
    m, gab, Vw, Fw, Nw = _malha(dir_sinteticos, "t01_simetrico_300")
    E = np.array([-1.0, 1.0, 1.0])
    sim = SimuladorGeometrico()
    for iid in ("teste-redondo-moderado-300", "teste-anatomico-alto-350"):
        for plano in PLANOS:
            for imf in IMFS:
                campos = sim.campos(gab["landmarks"], implantes_teste[iid], plano, imf, "ambos", _cfg())
                D = sum(c.deslocamento(Vw, Nw) for c in campos)
                Dm = sum(c.deslocamento(Vw * E, Nw * E) for c in campos)
                # campo equivariante: deslocar o espelho = espelhar o deslocamento
                assert np.abs(Dm - D * E).max() < 0.1
                pv = previsto(campos, gab["landmarks"])
                for k in pv:
                    assert abs(pv[k]["dir"] - pv[k]["esq"]) <= 0.1, (iid, plano, imf, k)


def test_simetria_da_malha_resultante_t01(torsos, dir_sinteticos, implantes_teste):
    """Pontos homologos (landmarks espelhados do t01) continuam espelhados apos a deformacao, com as
    normais reais da malha (vertice mais proximo), dentro de 0,1 mm. A comparacao superficie x
    superficie nao serve aqui porque a malha decimada nao e simetrica vertice a vertice."""
    m, gab, Vw, Fw, Nw = _malha(dir_sinteticos, "t01_simetrico_300")
    from scipy.spatial import cKDTree

    E = np.array([-1.0, 1.0, 1.0])
    arv = cKDTree(Vw)
    pares = [("mamilo_dir", "mamilo_esq"), ("sulco_dir", "sulco_esq"), ("base_medial_dir", "base_medial_esq"),
             ("base_lateral_dir", "base_lateral_esq")]
    for iid in ("teste-redondo-moderado-400", "teste-anatomico-alto-280"):
        for plano in PLANOS:
            for imf in IMFS:
                campos = SimuladorGeometrico().campos(gab["landmarks"], implantes_teste[iid], plano, imf, "ambos",
                                                      _cfg())
                for a, b in pares:
                    P = np.array([gab["landmarks"][a]["posicao"], gab["landmarks"][b]["posicao"]])
                    N = Nw[arv.query(P)[1]]
                    Pd = P + sum(c.deslocamento(P, N) for c in campos)
                    assert np.abs(Pd[0] * E - Pd[1]).max() < 0.1, (iid, plano, imf, a)


@pytest.mark.parametrize("nome", PRESETS)
def test_imf_manter_e_rebaixar(torsos, implantes_teste, nome):
    gab = torsos[nome]
    cfg = _cfg()
    reb = cfg["imf"]["rebaixar"]
    for iid in REDONDOS + ANATOMICOS:
        imp = implantes_teste[iid]
        for plano in PLANOS:
            for lado in ("dir", "esq"):
                man = montar_campo(gab["landmarks"], lado, imp, plano, "manter", cfg)
                pv = previsto([man], gab["landmarks"])
                assert abs(pv["delta_y_sulco_mm"][lado]) <= 1.0
                r = montar_campo(gab["landmarks"], lado, imp, plano, "rebaixar", cfg)
                esperado = -min(reb["mm_por_100ml"]["valor"] * imp["volume_ml"] / 100, reb["maximo_mm"]["valor"])
                assert previsto([r], gab["landmarks"])["delta_y_sulco_mm"][lado] == pytest.approx(esperado, abs=0.05)


def test_dual_plane_projeta_menos_e_simulador_segue_o_protocolo(torsos, dir_sinteticos, implantes_teste):
    m, gab, *_ = _malha(dir_sinteticos, "t01_simetrico_300")
    sim: interfaces.SimuladorDeformacao = SimuladorGeometrico()
    r_sg = sim.simular(m.V, m.F, gab["landmarks"], implantes_teste["teste-redondo-moderado-300"], "subglandular",
                       "manter", "ambos", _cfg())
    r_dp = sim.simular(m.V, m.F, gab["landmarks"], implantes_teste["teste-redondo-moderado-300"], "dual_plane",
                       "manter", "ambos", _cfg())
    assert r_sg["deltas_mm"].shape == m.V.shape and r_sg["deltas_mm"].dtype == np.float32
    assert r_sg["modelo"] == "geometrico_parametrico_v1" and r_sg["nao_calibrado"] is True
    assert r_dp["previsto"]["delta_projecao_mamilo_mm"]["dir"] < r_sg["previsto"]["delta_projecao_mamilo_mm"]["dir"]
    # costas nao se movem
    costas = m.V[:, 2] < -120
    assert np.abs(r_sg["deltas_mm"][costas]).max() < 0.01


def test_interfaces_febio_e_surrogate_sao_stubs():
    with pytest.raises(NotImplementedError):
        interfaces.GeradorFEBioStub().gerar_feb(None, None, None, None, "dual_plane", "manter", "/tmp")
    with pytest.raises(NotImplementedError):
        interfaces.SurrogateONNXStub().carregar("x.onnx")


# ----------------------------------------------------------------------------- morph targets

def _ler_bin(caminho):
    dados = caminho.read_bytes()
    comp = struct.unpack_from("<I", dados, 12)[0]
    js = json.loads(dados[20:20 + comp])
    off = 20 + comp
    comp_bin = struct.unpack_from("<I", dados, off)[0]
    return js, dados[off + 8: off + 8 + comp_bin]


def _vista(js, binario, bv, dtype, cols):
    v = js["bufferViews"][bv]
    return np.frombuffer(binario, dtype=dtype, count=v["byteLength"] // np.dtype(dtype).itemsize,
                         offset=v["byteOffset"]).reshape(-1, cols) if cols > 1 else np.frombuffer(
        binario, dtype=dtype, count=v["byteLength"] // np.dtype(dtype).itemsize, offset=v["byteOffset"])


@pytest.mark.parametrize("nome", PRESETS)
def test_todas_as_combinacoes_geradas(morphs_gerados, dir_sinteticos, implantes_teste, nome):
    man = morphs_gerados[nome]
    esquemas.validar("morphs_manifest", {k: v for k, v in man.items() if not k.startswith("_")})
    pasta = dir_sinteticos / nome / "morphs"
    assert json.loads((pasta / "manifest.json").read_text())["arquivos"] == man["arquivos"]
    assert {(a["plano"], a["imf"]) for a in man["arquivos"]} == {(p, i) for p in PLANOS for i in IMFS}
    n_imp = len(implantes_teste)
    assert man["_n_targets"] == 4 * n_imp * 3
    rx = re.compile(r"^mt__[a-z0-9]+(-[a-z0-9]+)*__(subglandular|dual_plane)__(manter|rebaixar)(__(dir|esq))?$")
    base = ler_malha(dir_sinteticos / nome / "torso.obj")
    for a in man["arquivos"]:
        nomes = [t["nome"] for t in a["targets"]]
        assert len(nomes) == n_imp * 3 and len(set(nomes)) == len(nomes) and all(rx.match(n) for n in nomes)
        assert {(t["implante_id"], t["lado"]) for t in a["targets"]} == {
            (i, s) for i in implantes_teste for s in ("ambos", "dir", "esq")}
        js, binario = _ler_bin(pasta / a["arquivo"])
        assert js["asset"]["extras"]["unidade"] == "mm" and js["asset"]["extras"]["esquema"] == "morphs/1.0"
        assert js["asset"]["extras"]["quadro"] == "anatomico"
        malha = js["meshes"][0]
        assert len(js["meshes"]) == 1 and len(malha["primitives"]) == 1
        assert malha["extras"]["targetNames"] == nomes
        prim = malha["primitives"][0]
        assert len(prim["targets"]) == len(nomes) and malha["weights"] == [0.0] * len(nomes)
        pos = _vista(js, binario, js["accessors"][prim["attributes"]["POSITION"]]["bufferView"], np.float32, 3)
        assert np.abs(pos - base.V).max() < 1e-3  # malha base = torso.obj, mesma ordem
        for t in prim["targets"]:
            acc = js["accessors"][t["POSITION"]]
            assert "bufferView" not in acc and acc["count"] == len(base.V) and "min" in acc and "max" in acc
            idx = _vista(js, binario, acc["sparse"]["indices"]["bufferView"], np.uint32, 1)
            assert np.all(np.diff(idx.astype(np.int64)) > 0)
            assert "NORMAL" in t


def test_target_decodificado_bate_com_o_simulador(morphs_gerados, dir_sinteticos, implantes_teste):
    nome = "t02_assimetrico"
    m, gab, *_ = _malha(dir_sinteticos, nome)
    js, binario = _ler_bin(dir_sinteticos / nome / "morphs" / "dual_plane__rebaixar.glb")
    nomes = js["meshes"][0]["extras"]["targetNames"]
    i = nomes.index("mt__teste-anatomico-alto-350__dual_plane__rebaixar__esq")
    acc = js["accessors"][js["meshes"][0]["primitives"][0]["targets"][i]["POSITION"]]
    idx = _vista(js, binario, acc["sparse"]["indices"]["bufferView"], np.uint32, 1).astype(np.int64)
    val = _vista(js, binario, acc["sparse"]["values"]["bufferView"], np.float32, 3)
    denso = np.zeros_like(m.V)
    denso[idx] = val
    r = SimuladorGeometrico().simular(m.V, m.F, gab["landmarks"], implantes_teste["teste-anatomico-alto-350"],
                                      "dual_plane", "rebaixar", "esq", _cfg())
    assert np.abs(denso - r["deltas_mm"]).max() < 0.011  # so o corte de 0,01 mm do esparso
    assert np.abs(denso[m.V[:, 0] < -40]).max() < 0.02  # lado direito intacto (cauda do suavizado < 0,02 mm)


def _metricas(man):
    out = {}
    for a in man["arquivos"]:
        for t in a["targets"]:
            out[t["nome"]] = t["previsto"]
    return out


def test_regressao_geometrica_snapshot(morphs_gerados):
    """Snapshot das metricas `previsto` de todos os targets do t01 (catalogo de teste). Para atualizar
    conscientemente apos mudar o modelo ou a config: MESH_ATUALIZAR_SNAPSHOT=1 pytest."""
    atual = _metricas(morphs_gerados["t01_simetrico_300"])
    if os.environ.get("MESH_ATUALIZAR_SNAPSHOT") == "1" or not os.path.exists(SNAPSHOT):
        with open(SNAPSHOT, "w", encoding="utf-8") as f:
            json.dump(atual, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    with open(SNAPSHOT, encoding="utf-8") as f:
        esperado = json.load(f)
    assert set(atual) == set(esperado)
    for nome, pv in esperado.items():
        for k, porlado in pv.items():
            for lado, v in porlado.items():
                assert atual[nome][k][lado] == pytest.approx(v, abs=0.05), (nome, k, lado)


def test_benchmark_precomputo(morphs_gerados, capsys):
    """So relata (sem limite duro): tempo e tamanho do pre-computo por torso."""
    with capsys.disabled():
        for nome, man in morphs_gerados.items():
            mb = sum(man["_bytes"].values()) / 1e6
            print(f"\n[benchmark] {nome}: {man['_n_targets']} targets, {man['_duracao_s']:.2f} s, {mb:.1f} MB")
    assert all(man["_duracao_s"] > 0 for man in morphs_gerados.values())
