"""Leitura do catalogo de implantes (contratos §11) validado contra config/schemas/catalogo.schema.json."""

from __future__ import annotations

import json
from pathlib import Path

from mesh import esquemas
from mesh.caminhos import config_dir


class ErroCatalogo(ValueError):
    pass


def ler_arquivo(caminho: Path) -> list[dict]:
    dado = json.loads(Path(caminho).read_text(encoding="utf-8"))
    try:
        esquemas.validar("catalogo", dado)
    except esquemas.ErroContrato as e:
        raise ErroCatalogo(f"catalogo invalido ({Path(caminho).name}): {e}") from e
    return list(dado["implantes"])


def carregar(arquivos: list[Path] | None = None) -> tuple[dict[str, dict], list[str]]:
    """Implantes por id. Sem `arquivos`, le todos os config/catalogo/*.json validos (os invalidos sao
    pulados com aviso). Ids repetidos entre arquivos sao erro (id e unico global)."""
    avisos: list[str] = []
    if arquivos is None:
        arquivos = sorted((config_dir() / "catalogo").glob("*.json"))
        explicito = False
    else:
        explicito = True
    implantes: dict[str, dict] = {}
    for arq in arquivos:
        try:
            itens = ler_arquivo(arq)
        except (ErroCatalogo, json.JSONDecodeError, OSError) as e:
            if explicito:
                raise ErroCatalogo(str(e)) from e
            avisos.append(f"catalogo_ignorado:{Path(arq).name}")
            continue
        for it in itens:
            if it["id"] in implantes:
                raise ErroCatalogo(f"id de implante repetido: {it['id']}")
            implantes[it["id"]] = it
    return implantes, avisos
