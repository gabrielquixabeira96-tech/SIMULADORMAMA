"""Gerador do torso sintetico e do gabarito (contratos §4, Marco 0).

Como o gabarito e calculado
---------------------------
- `landmarks.*.posicao`: avaliacao exata da superficie analitica S(s, y) nos parametros do
  landmark (superficie.py), nao de um vertice. `furcula` = (0, 0, 0) exato.
- `landmarks.*.vertice`: vertice mais proximo na malha decimada `torso.obj`.
- `distancias.*.euclidiana_mm`: norma entre as `posicao` exatas.
- `distancias.*.geodesica_mm`: geodesica exata MMP (pygeodesic) na **malha densa** (~300 mil faces,
  aresta ~1,6 mm), partindo das posicoes exatas inseridas na malha (medir/geodesica.py). E a verdade
  de geodesica; a malha densa e a referencia fina.
- `volumes.X.adicionado_ml`: volume do solido entre a superficie com a mama X e a mesma superficie
  sem ela, calculado na malha densa pelo teorema da divergencia (exato para o poliedro; o erro de
  discretizacao contra a superficie lisa e O(h^2) ~ 1e-4 relativo). A amplitude da mama e resolvida
  (Brent) para que esse volume coincida com `volume_ml` pedido (tolerancia 1e-4 mL).
- `volumes.X.estimado_plano_base_elipse_ml`: estimador do contratos §3.2 aplicado a malha decimada
  com os landmarks do gabarito (referencia do erro do estimador).
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from scipy.optimize import brentq
from scipy.spatial import cKDTree

from mesh import esquemas
from mesh.malha.geometria import Proximidade, soldar, volume_assinado
from mesh.malha.glb import escrever_glb
from mesh.malha.io import MalhaRender, escrever_obj, sha256_arquivo
from mesh.medir import antropometria as antro
from mesh.medir import geodesica as geo
from mesh.processar.pipeline import decimar, limpar, transferir_atributos
from mesh.sintetico.superficie import Torso
from mesh.sintetico.textura import textura_neutra
from mesh.versao import VERSAO_SOFTWARE, versao_pygeodesic


class Grade:
    """Grade (s, y) da malha densa: colunas uniformes em arco (com coluna de costura duplicada nas
    costas para a UV), linhas uniformes em y. Faces anti-horarias vistas de fora."""

    def __init__(self, torso: Torso, alvo_faces: int):
        P = torso.secao.perimetro
        Ht = torso.y_topo - torso.y_base
        delta = float(np.sqrt(2.0 * P * Ht / alvo_faces))
        self.nt = int(round(P / delta / 2.0)) * 2
        self.ny = int(round(Ht / delta)) + 1
        self.s = -P / 2 + np.arange(self.nt + 1) * (P / self.nt)  # coluna nt = costura (== coluna 0)
        self.y = np.linspace(torso.y_base, torso.y_topo, self.ny)
        S, Y = np.meshgrid(self.s, self.y, indexing="ij")
        self.S, self.Y = S.reshape(-1), Y.reshape(-1)
        self.uv = np.stack([np.repeat(np.arange(self.nt + 1) / self.nt, self.ny),
                            np.tile((self.y - torso.y_base) / Ht, self.nt + 1)], axis=1)
        idx = np.arange((self.nt + 1) * self.ny).reshape(self.nt + 1, self.ny)
        a, b = idx[:-1, :-1], idx[1:, :-1]
        c, d = idx[1:, 1:], idx[:-1, 1:]
        self.F = np.concatenate([np.stack([a, b, c], -1).reshape(-1, 3),
                                 np.stack([a, c, d], -1).reshape(-1, 3)])
        # versao soldada: coluna nt -> coluna 0
        mapa = np.arange((self.nt + 1) * self.ny)
        mapa[self.nt * self.ny:] = np.arange(self.ny)
        self.Fw = mapa[self.F]
        self.n_soldados = self.nt * self.ny

    def soldar(self, X: np.ndarray) -> np.ndarray:
        return X[: self.n_soldados]


def _resolver_amplitudes(torso: Torso, grade: Grade) -> dict[str, float]:
    """Resolve H de cada mama para que o volume adicionado (malha densa) seja o pedido."""
    volumes = {}
    for mama, chave in ((torso.mama_dir, "dir"), (torso.mama_esq, "esq")):
        alvo_mm3 = mama.volume_ml * 1000.0
        if alvo_mm3 <= 0:
            mama.H = 0.0
            volumes[chave] = 0.0
            continue
        sem = grade.soldar(torso.avaliar(grade.S, grade.Y, sem=chave))
        v_sem = volume_assinado(sem, grade.Fw)

        def vol(H, mama=mama, chave=chave, v_sem=v_sem):
            kw = {"H_dir": H} if chave == "dir" else {"H_esq": H}
            com = grade.soldar(torso.avaliar(grade.S, grade.Y, **kw))
            return volume_assinado(com, grade.Fw) - v_sem

        # estimativa inicial: integral da forma sobre a pegada (area ~ pi * base^2 / 4 * 0.5)
        hi = 20.0
        while vol(hi) < alvo_mm3:
            hi *= 2.0
            if hi > 1000:
                raise ValueError("volume inatingivel para a geometria pedida")
        mama.H = float(brentq(lambda H, alvo=alvo_mm3: vol(H) - alvo, 0.0, hi, xtol=1e-7, rtol=1e-12))
        volumes[chave] = vol(mama.H) / 1000.0
    return volumes


def _landmarks_parametricos(torso: Torso) -> dict[str, tuple[float, float]]:
    md, me = torso.mama_dir, torso.mama_esq
    return {
        "furcula": (0.0, 0.0),
        "mamilo_dir": md.param_mamilo(),
        "mamilo_esq": me.param_mamilo(),
        "sulco_dir": md.param_sulco(),
        "sulco_esq": me.param_sulco(),
        "linha_media_inferior": (0.0, 0.5 * (md.y_sulco + me.y_sulco)),
        "base_medial_dir": md.param_base_medial(),
        "base_lateral_dir": md.param_base_lateral(),
        "base_medial_esq": me.param_base_medial(),
        "base_lateral_esq": me.param_base_lateral(),
    }


def gerar_torso(parametros: dict, saida: Path, escrever_densa: bool = True) -> dict:
    """Gera a pasta <saida>/<nome>/ (contratos §4.2) e devolve o gabarito/1.0."""
    t0 = time.time()
    p = esquemas.completar_parametros(parametros)
    esquemas.validar("torso_parametros", p)
    nome = p["nome"]
    pasta = Path(saida) / nome
    pasta.mkdir(parents=True, exist_ok=True)

    torso = Torso(p)
    grade = Grade(torso, int(p["resolucao"]["densa_faces"]))
    volumes_reais = _resolver_amplitudes(torso, grade)

    Vd_render = torso.avaliar(grade.S, grade.Y)
    textura = textura_neutra(int(p["semente"]))
    densa = MalhaRender(V=Vd_render, F=grade.F, uv=grade.uv, textura=textura)
    Vw = grade.soldar(Vd_render)
    Fw = grade.Fw

    # landmarks exatos
    params = _landmarks_parametricos(torso)
    pos = {k: torso.ponto(s, y) for k, (s, y) in params.items()}
    pos["furcula"] = np.zeros(3)  # exato por construcao (evita -0.0/arredondamento)

    # geodesicas verdadeiras na malha densa
    geod = geo.geodesicas_entre_pontos(Vw, Fw, pos, antro.DISTANCIAS, prox=Proximidade(Vw, Fw))

    # malha decimada (mesmo pipeline do /processar)
    Vc, Fc, _ = limpar(Vw, Fw)
    alvo = int(p["resolucao"]["decimada_vertices"])
    Vdec, Fdec = decimar(Vc, Fc, alvo, 30000, 50000)
    decimada = transferir_atributos(densa, Vdec, Fdec)

    # arquivos
    escrever_obj(pasta / "torso.obj", decimada, "torso.mtl", "textura.png",
                 cabecalho=f"# torso sintetico {nome} — quadro anatomico (origem na furcula)\n")
    textura.save(pasta / "textura.png")
    escrever_glb(pasta / "torso.glb", decimada, quadro="anatomico", extras_asset={"sintetico": True, "nome": nome})
    if escrever_densa:
        escrever_obj(pasta / "denso.obj", densa, "torso.mtl", "textura.png",
                     cabecalho=f"# malha densa de referencia do gabarito {nome}\n")

    arvore = cKDTree(decimada.V)
    lm_json = {}
    for k in antro.LANDMARKS:
        _, iv = arvore.query(pos[k])
        lm_json[k] = {"posicao": [round(float(c), 4) for c in pos[k]], "vertice": int(iv), "origem": "gabarito"}

    eu = antro.euclidianas({k: v for k, v in pos.items()})
    Vdw, Fdw, _ = soldar(decimada.V, decimada.F)
    estimados = {lado: antro.volume_plano_base_elipse(Vdw, Fdw, pos, lado) for lado in ("dir", "esq")}

    gabarito = {
        "esquema": "gabarito/1.0",
        "nome": nome,
        "gerado_em": datetime.now(UTC).astimezone().isoformat(timespec="seconds"),
        "versao_software": VERSAO_SOFTWARE,
        "unidade": "mm",
        "quadro": "anatomico",
        "parametros": p,
        "landmarks": lm_json,
        "distancias": {k: {"euclidiana_mm": round(eu[k], 2), "geodesica_mm": round(geod[k], 2)}
                       for k in antro.DISTANCIAS},
        "volumes": {lado: {"adicionado_ml": round(volumes_reais[lado], 1),
                           "estimado_plano_base_elipse_ml": None if estimados[lado] is None
                           else round(estimados[lado], 1)}
                    for lado in ("dir", "esq")},
        "malha": {
            "densa": {"arquivo": "denso.obj", "n_vertices": int(len(Vw)), "n_faces": int(len(Fw))},
            "decimada": {"arquivo": "torso.obj", "n_vertices": decimada.n_vertices,
                         "n_faces": decimada.n_faces, "sha256": sha256_arquivo(pasta / "torso.obj")},
        },
        "geodesica": {"algoritmo": geo.ALGORITMO, "biblioteca": geo.BIBLIOTECA, "versao": versao_pygeodesic(),
                      "malha": "densa"},
    }
    if escrever_densa:
        gabarito["malha"]["densa"]["sha256"] = sha256_arquivo(pasta / "denso.obj")
    esquemas.validar("gabarito", gabarito)
    (pasta / "parametros.json").write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (pasta / "gabarito.json").write_text(json.dumps(gabarito, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
    gabarito_interno = dict(gabarito)
    gabarito_interno["_duracao_s"] = round(time.time() - t0, 2)
    gabarito_interno["_amplitudes_mm"] = {"dir": torso.mama_dir.H, "esq": torso.mama_esq.H}
    return gabarito_interno
