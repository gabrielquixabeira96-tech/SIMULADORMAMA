"""Operacoes do services/mesh, independentes de HTTP (usadas pela API e pela CLI).

Cada funcao recebe caminhos **relativos a DATA_DIR** (contratos §5.4) e devolve os objetos dos
contratos (`malha_meta/1.0`, resposta de `/medir`, `gabarito/1.0`, Bland-Altman).
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from mesh import caminhos, esquemas
from mesh.malha.geometria import Proximidade, soldar
from mesh.malha.glb import escrever_glb
from mesh.malha.io import MalhaRender, escrever_obj, ler_malha, sha256_arquivo
from mesh.medir import antropometria as antro
from mesh.medir import geodesica as geo
from mesh.medir.bland_altman import bland_altman
from mesh.processar.pipeline import processar_malha
from mesh.versao import VERSAO_SOFTWARE, versao_pygeodesic

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
TOL_EUCLIDIANA_MM = 0.01


class ErroServico(Exception):
    def __init__(self, status: int, codigo: str, mensagem: str, detalhes: dict | None = None):
        super().__init__(mensagem)
        self.status, self.codigo, self.mensagem, self.detalhes = status, codigo, mensagem, detalhes or {}


def agora() -> str:
    return datetime.now(UTC).astimezone().isoformat(timespec="seconds")


def _dir_malha(malha_dir: str) -> Path:
    try:
        return caminhos.resolver(malha_dir)
    except caminhos.CaminhoInvalido as e:
        raise ErroServico(400, "caminho_invalido", str(e)) from e


def _arquivo(base: Path, rel: str) -> Path:
    try:
        p = caminhos.resolver(rel, base=base)
    except caminhos.CaminhoInvalido as e:
        raise ErroServico(400, "caminho_invalido", str(e)) from e
    if not p.is_file():
        raise ErroServico(404, "arquivo_nao_encontrado", f"arquivo nao encontrado: {rel}")
    return p


def _malha_id(malha_dir: str, informado: str | None) -> str:
    if informado:
        if not _UUID.match(informado):
            raise ErroServico(400, "malha_id_invalido", "malha_id deve ser UUID v4 minusculo")
        return informado
    ultimo = Path(malha_dir).name
    return ultimo if _UUID.match(ultimo) else str(uuid.uuid5(uuid.NAMESPACE_URL, f"mesh:{malha_dir}"))


def _gravar_processada(pasta: Path, malha: MalhaRender) -> tuple[str, str]:
    tem_textura = malha.textura is not None and malha.uv is not None
    if tem_textura:
        malha.textura.save(pasta / "textura.png")
    escrever_obj(pasta / "processada.obj", malha, "processada.mtl", "textura.png" if tem_textura else None)
    escrever_glb(pasta / "processada.glb", malha, quadro="scan")
    return "processada.obj", "processada.glb"


def _bloco_processada(pasta: Path, malha: MalhaRender) -> dict:
    mn, mx = malha.caixa()
    return {
        "obj": "processada.obj",
        "glb": "processada.glb",
        "n_vertices": malha.n_vertices,
        "n_faces": malha.n_faces,
        "sha256_glb": sha256_arquivo(pasta / "processada.glb"),
        "caixa_mm": {"min": [round(v, 2) for v in mn], "max": [round(v, 2) for v in mx]},
    }


# ----------------------------------------------------------------------------- /processar

def processar(req: dict) -> dict:
    malha_dir = req["malha_dir"]
    pasta = _dir_malha(malha_dir)
    if not pasta.is_dir():
        raise ErroServico(404, "malha_dir_nao_encontrado", "malha_dir nao existe em DATA_DIR")
    arq = _arquivo(pasta, req["arquivo_original"])
    if arq.suffix.lower() not in (".obj", ".ply"):
        raise ErroServico(415, "formato_nao_suportado", "aceitos: .obj, .ply")
    try:
        original = ler_malha(arq)
    except Exception as e:  # noqa: BLE001
        raise ErroServico(400, "malha_ilegivel", f"falha ao ler a malha: {type(e).__name__}") from e
    unidade = req.get("unidade_origem", "desconhecida")
    try:
        res = processar_malha(original, unidade, req.get("recorte"), req.get("decimacao"))
    except ValueError as e:
        raise ErroServico(400, "processamento_invalido", str(e)) from e
    _gravar_processada(pasta, res.malha)
    meta = {
        "esquema": "malha_meta/1.0",
        "malha_id": _malha_id(malha_dir, req.get("malha_id")),
        "malha_dir": malha_dir,
        "unidade_origem": unidade,
        "unidade_inferida": res.unidade_inferida,
        "fator_unidade": res.fator_unidade,
        "fator_escala_acumulado": 1.0,
        "quadro": "scan",
        "original": {
            "arquivo": req["arquivo_original"],
            "n_vertices": original.n_vertices,
            "n_faces": original.n_faces,
            "sha256": sha256_arquivo(arq),
            "tem_textura": original.textura is not None,
        },
        "processada": _bloco_processada(pasta, res.malha),
        "recorte": {
            "modo": (req.get("recorte") or {}).get("modo", "abaixo_do_pescoco"),
            "y_corte_mm": None if res.y_corte_mm is None else round(res.y_corte_mm, 2),
            "aplicado": res.recorte_aplicado,
        },
        "escala": {"historico": []},
        "avisos": res.avisos,
        "versao_software": VERSAO_SOFTWARE,
        "gerado_em": agora(),
    }
    esquemas.validar("malha_meta", meta)
    (pasta / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


# ----------------------------------------------------------------------------- /reescalar

def _ler_meta(pasta: Path) -> dict:
    p = pasta / "meta.json"
    if not p.is_file():
        raise ErroServico(404, "meta_nao_encontrado", "meta.json ausente: chame /processar antes")
    return json.loads(p.read_text(encoding="utf-8"))


def reescalar(req: dict) -> dict:
    pasta = _dir_malha(req["malha_dir"])
    fator = float(req["fator"])
    if not np.isfinite(fator) or not (1e-3 <= fator <= 1e3):
        raise ErroServico(400, "fator_invalido", "fator deve ser finito e estar em [0.001, 1000]")
    meta = _ler_meta(pasta)
    obj = _arquivo(pasta, "processada.obj")
    malha = ler_malha(obj)
    malha.V = malha.V * fator  # em torno da origem (contratos §7.3)
    _gravar_processada(pasta, malha)
    meta["fator_escala_acumulado"] = float(meta.get("fator_escala_acumulado", 1.0)) * fator
    meta.setdefault("escala", {}).setdefault("historico", []).append(
        {"fator": fator, "regua": req.get("regua"), "aplicado_em": agora()})
    meta["processada"] = _bloco_processada(pasta, malha)
    esquemas.validar("malha_meta", meta)
    (pasta / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


# ----------------------------------------------------------------------------- /medir

def _landmarks_validados(landmarks: dict, n_vertices: int) -> dict:
    desconhecidos = sorted(set(landmarks) - set(antro.LANDMARKS))
    if desconhecidos:
        raise ErroServico(422, "landmark_desconhecido", "landmark fora da tabela canonica",
                          {"landmarks": desconhecidos})
    saida = {}
    for nome, item in landmarks.items():
        pos = np.asarray(item["posicao"], dtype=np.float64)
        if pos.shape != (3,) or not np.all(np.isfinite(pos)):
            raise ErroServico(422, "posicao_invalida", f"posicao invalida em {nome}")
        v = int(item["vertice"])
        if not (0 <= v < n_vertices):
            raise ErroServico(422, "vertice_invalido", f"vertice fora da malha processada em {nome}",
                              {"landmark": nome, "n_vertices": n_vertices})
        saida[nome] = {"posicao": pos, "vertice": v}
    return saida


def medir(req: dict) -> dict:
    pasta = _dir_malha(req["malha_dir"])
    malha = ler_malha(_arquivo(pasta, "processada.obj"))
    lm = _landmarks_validados(req.get("landmarks") or {}, malha.n_vertices)
    eu = antro.euclidianas(lm)
    web = req.get("distancias_euclidianas_web") or {}
    divergentes = {}
    for k, v in web.items():
        if k not in antro.DISTANCIAS:
            raise ErroServico(422, "distancia_desconhecida", f"distancia fora da tabela canonica: {k}")
        if v is None:
            continue
        calc = eu.get(k)
        if calc is None or abs(float(v) - calc) > TOL_EUCLIDIANA_MM:
            divergentes[k] = {"web_mm": v, "mesh_mm": None if calc is None else round(calc, 4)}
    if divergentes:
        raise ErroServico(422, "euclidiana_divergente",
                          f"euclidiana do web difere > {TOL_EUCLIDIANA_MM} mm da recalculada", divergentes)
    Vw, Fw, _ = soldar(malha.V, malha.F)
    prox = Proximidade(Vw, Fw)
    avisos: list[str] = []
    if lm:
        nomes = list(lm)
        _, _, _, dist = prox.consultar(np.array([lm[n]["posicao"] for n in nomes]))
        avisos += [f"landmark_fora_da_superficie:{n}" for n, d in zip(nomes, dist, strict=True) if d > 5.0]
    faltando = [n for n in antro.OBRIGATORIOS if n not in lm]
    if faltando:
        avisos.append("landmarks_obrigatorios_ausentes:" + ",".join(faltando))
    r = antro.medir(Vw, Fw, lm, incluir_geodesica=bool(req.get("incluir_geodesica", True)),
                    incluir_volume=bool(req.get("incluir_volume", True)),
                    fator_incerteza=esquemas.fator_incerteza_volume(), prox=prox)
    return {
        "distancias": r["distancias"],
        "volumes": r["volumes"],
        "quadro_anatomico": r["quadro_anatomico"],
        "geodesica": {"algoritmo": geo.ALGORITMO, "biblioteca": geo.BIBLIOTECA, "versao": versao_pygeodesic()},
        "avisos": avisos + r["avisos"],
    }


# ----------------------------------------------------------------------------- /torso-sintetico

def torso_sintetico(req: dict) -> dict:
    from mesh.sintetico.gerador import gerar_torso

    req = dict(req)
    saida_rel = req.pop("saida_dir", "sinteticos")
    try:
        saida = caminhos.resolver(saida_rel)
    except caminhos.CaminhoInvalido as e:
        raise ErroServico(400, "caminho_invalido", str(e)) from e
    try:
        esquemas.validar("torso_parametros", esquemas.completar_parametros(req))
    except esquemas.ErroContrato as e:
        raise ErroServico(422, "contrato_invalido", "torso_parametros/1.0 invalido", {"erros": e.erros}) from e
    saida.mkdir(parents=True, exist_ok=True)
    g = gerar_torso(req, saida)
    return {k: v for k, v in g.items() if not k.startswith("_")}


# ----------------------------------------------------------------------------- /validar-bland-altman

def validar_bland_altman(req: dict) -> dict:
    pares = req.get("pares") or []
    if not pares:
        raise ErroServico(400, "sem_pares", "informe ao menos 1 par")
    return bland_altman(pares, float(req.get("limite_mm", 2.0)))

