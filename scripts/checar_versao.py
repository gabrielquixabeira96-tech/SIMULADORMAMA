#!/usr/bin/env python3
"""Confere que as versoes dos manifestos batem com VERSION (plano A3; contratos §16).

Manifestos: package.json (raiz), apps/web/package.json, packages/contratos/package.json e
services/mesh/pyproject.toml ([project].version). Sai 0 se todos batem; 1 se algum diverge ou
nao tem versao; 2 se VERSION for invalido ou um manifesto nao puder ser lido.
Uso: python3 scripts/checar_versao.py [--raiz <dir>]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:  # Python >= 3.11
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore[assignment]

MANIFESTOS_JSON = ("package.json", "apps/web/package.json", "packages/contratos/package.json")
PYPROJECT = "services/mesh/pyproject.toml"


def versao_pyproject(texto: str) -> str | None:
    if tomllib is not None:
        return (tomllib.loads(texto).get("project") or {}).get("version")
    secao = re.search(r"^\[project\]\s*$(.*?)(?=^\[|\Z)", texto, re.M | re.S)
    m = secao and re.search(r'^version\s*=\s*"([^"]*)"', secao.group(1), re.M)
    return m.group(1) if m else None


def main(argv: list[str]) -> int:
    raiz = Path(__file__).resolve().parents[1]
    if len(argv) == 2 and argv[0] == "--raiz":
        raiz = Path(argv[1]).resolve()
    elif argv:
        print("uso: checar_versao.py [--raiz <dir>]", file=sys.stderr)
        return 2
    try:
        versao = (raiz / "VERSION").read_text(encoding="utf-8").strip()
    except OSError as e:
        print(f"ERRO: VERSION ilegivel: {e}", file=sys.stderr)
        return 2
    if not re.fullmatch(r"\d+\.\d+\.\d+", versao):
        print(f"ERRO: VERSION invalida: {versao!r}", file=sys.stderr)
        return 2
    achados: dict[str, str | None] = {}
    try:
        for rel in MANIFESTOS_JSON:
            achados[rel] = json.loads((raiz / rel).read_text(encoding="utf-8")).get("version")
        achados[PYPROJECT] = versao_pyproject((raiz / PYPROJECT).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"ERRO: manifesto ilegivel: {e}", file=sys.stderr)
        return 2
    divergentes = {k: v for k, v in achados.items() if v != versao}
    for k, v in achados.items():
        print(f"{'ok  ' if v == versao else 'DIVERGE'} {k}: {v!r}")
    if divergentes:
        print(f"ERRO: {len(divergentes)} manifesto(s) com versao diferente de VERSION={versao}", file=sys.stderr)
        return 1
    print(f"todos os manifestos em {versao}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
