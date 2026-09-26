"""Versao do software (arquivo VERSION na raiz do repositorio, contratos §16)."""

from __future__ import annotations

import os
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parents[3]
CONTRATO = "1.0"


def _ler_versao() -> str:
    candidato = Path(os.environ.get("MESH_VERSION_FILE", RAIZ_REPO / "VERSION"))
    try:
        return candidato.read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


VERSAO_SOFTWARE = _ler_versao()


def versao_pygeodesic() -> str:
    try:
        from importlib.metadata import version

        return version("pygeodesic")
    except Exception:  # noqa: BLE001
        return "desconhecida"
