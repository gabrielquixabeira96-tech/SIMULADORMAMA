"""Log estruturado (JSON por linha) sem dado pessoal.

Somente IDs tecnicos (malha_id, nome de torso sintetico), rota, desenho (A/B), contagens e tempos.
Nunca caminhos absolutos, nomes, textos livres de anamnese ou coordenadas de pacientes.
"""

from __future__ import annotations

import json
import logging
import sys
import time

_LOGGER = logging.getLogger("mesh")
if not _LOGGER.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(message)s"))
    _LOGGER.addHandler(_h)
    _LOGGER.setLevel(logging.INFO)
    _LOGGER.propagate = False

_CAMPOS_PERMITIDOS = {
    "evento", "rota", "desenho", "status", "malha_id", "torso", "n_vertices", "n_faces", "duracao_ms",
    "incluir_volume", "incluir_geodesica", "codigo", "aviso", "versao_software", "fator", "n",
}


def registrar(evento: str, nivel: int = logging.INFO, **campos: object) -> dict:
    registro = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "evento": evento}
    for k, v in campos.items():
        if k in _CAMPOS_PERMITIDOS:
            registro[k] = v
    _LOGGER.log(nivel, json.dumps(registro, ensure_ascii=False, default=str))
    return registro
