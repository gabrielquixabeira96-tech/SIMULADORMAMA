"""Resolucao segura de caminhos relativos a DATA_DIR (contratos §5.4, ADR 0003 item 8).

Regras: so caminhos relativos, sem `..`, sem barra inicial, e o caminho real (resolvido, com
links simbolicos) precisa ficar dentro de DATA_DIR. Qualquer violacao levanta CaminhoInvalido.
"""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

from mesh.versao import RAIZ_REPO


class CaminhoInvalido(ValueError):
    """Caminho fora de DATA_DIR, absoluto ou com `..`."""


def data_dir() -> Path:
    bruto = os.environ.get("DATA_DIR")
    base = Path(bruto) if bruto else RAIZ_REPO / "data"
    if not base.is_absolute():
        base = (Path.cwd() / base)
    return base.resolve()


def config_dir() -> Path:
    bruto = os.environ.get("CONFIG_DIR")
    return Path(bruto).resolve() if bruto else RAIZ_REPO / "config"


def validar_relativo(rel: str) -> PurePosixPath:
    if not isinstance(rel, str) or not rel.strip():
        raise CaminhoInvalido("caminho vazio")
    if "\\" in rel or "\x00" in rel:
        raise CaminhoInvalido("caractere proibido no caminho")
    p = PurePosixPath(rel)
    if p.is_absolute() or rel.startswith("/"):
        raise CaminhoInvalido("caminho absoluto nao permitido")
    if any(parte == ".." for parte in p.parts):
        raise CaminhoInvalido("'..' nao permitido")
    return p


def resolver(rel: str, base: Path | None = None) -> Path:
    """Resolve `rel` (relativo a `base`, padrao DATA_DIR) e garante que fica dentro de DATA_DIR."""
    raiz = data_dir()
    base = (base or raiz).resolve()
    p = validar_relativo(rel)
    alvo = (base / Path(*p.parts)).resolve()
    try:
        alvo.relative_to(raiz)
    except ValueError as e:
        raise CaminhoInvalido("caminho escapa de DATA_DIR") from e
    return alvo


def relativo_a_data_dir(p: Path) -> str:
    return p.resolve().relative_to(data_dir()).as_posix()
