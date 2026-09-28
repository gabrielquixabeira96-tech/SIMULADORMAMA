"""Validacao contra config/schemas/*.schema.json (forma executavel dos contratos) e leitura de config."""

from __future__ import annotations

import json
from functools import lru_cache

from jsonschema import Draft202012Validator

from mesh.caminhos import config_dir


class ErroContrato(ValueError):
    def __init__(self, esquema: str, erros: list[str]):
        super().__init__(f"{esquema}: " + "; ".join(erros[:5]))
        self.esquema = esquema
        self.erros = erros


@lru_cache(maxsize=32)
def validador(nome: str) -> Draft202012Validator:
    caminho = config_dir() / "schemas" / f"{nome}.schema.json"
    esquema = json.loads(caminho.read_text(encoding="utf-8"))
    return Draft202012Validator(esquema)


def validar(nome: str, dado: object) -> None:
    erros = sorted(validador(nome).iter_errors(dado), key=lambda e: list(e.path))
    if erros:
        raise ErroContrato(nome, [f"{'/'.join(map(str, e.path)) or '<raiz>'}: {e.message}" for e in erros])


@lru_cache(maxsize=1)
def config_simulacao() -> dict:
    return json.loads((config_dir() / "simulacao.json").read_text(encoding="utf-8"))


def fator_incerteza_volume() -> float:
    try:
        return float(config_simulacao()["incerteza"]["volume_relativa_fator"]["valor"])
    except (KeyError, OSError, ValueError, TypeError):
        return 0.15


def presets_torso() -> dict[str, dict]:
    dado = json.loads((config_dir() / "torsos_presets.json").read_text(encoding="utf-8"))
    return {p["nome"]: p for p in dado["presets"]}


TEXTURA_PADRAO = {"realismo": "esquematico", "fototipo": "III", "px_por_mm": 4.0, "areola_mm": 40.0,
                  "mamilo_mm": 10.0}


def completar_parametros(p: dict) -> dict:
    """Aplica os defaults do esquema torso_parametros/1.0 (altura, profundidade, resolucao, textura).
    Sem `textura`, o torso sai com a textura neutra do Marco 0 (`realismo: "esquematico"`), para que
    parametros antigos gerem exatamente o que geravam; os presets pedem `"fotografico"` (ADR 0020)."""
    q = json.loads(json.dumps(p))
    q.setdefault("altura_torso_mm", 450)
    q.setdefault("profundidade_toracica_mm", 200)
    res = q.setdefault("resolucao", {})
    res.setdefault("densa_faces", 300000)
    res.setdefault("decimada_vertices", 40000)
    tex = q.setdefault("textura", {})
    for k, v in TEXTURA_PADRAO.items():
        tex.setdefault(k, v)
    return q
