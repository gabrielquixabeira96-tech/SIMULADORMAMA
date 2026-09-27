#!/usr/bin/env python3
"""Checa se algum NOME DE PACOTE proibido (ADR 0009; PROMPT.md restricao 7) aparece nos manifestos
e lockfiles de dependencias. So olha nomes de pacote — nunca texto livre, hashes ou docs —, para que
ADRs e documentacao possam citar os nomes proibidos sem falso positivo.

Fontes de nomes:
  - pnpm-lock.yaml (chaves de `packages:`/`snapshots:`), package.json da raiz, de apps/* e packages/*;
  - services/mesh/pyproject.toml (dependencies e optional-dependencies), requirements*.txt;
  - pacotes instalados no services/mesh/.venv (`pip list`), se existir (pega transitivas).

Uso: python3 scripts/checar_proibidos.py [--raiz DIR]    (sai com 1 se achar proibido)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

# Nome inteiro (normalizado: minusculas, "_" e "." viram "-") ou prefixo de escopo.
PROIBIDOS_NOME = {
    "rbsm", "irbsm", "lirbsm",
    "smpl", "smplx", "smpl-x", "smplpytorch", "smplify", "smplify-x",
    "pymeshlab", "gdist",
    "sam-3d-body", "sam3d", "sam-3d", "sam3d-body", "sam-3d-objects",
    "vggt",
    "flux-dev", "flux-1-dev", "flux1-dev",
    "depth-anything", "depth-anything-v2", "depth-anything-2", "depth-anything-3", "depth-anything-v3", "da3",
}
# Tokens proibidos DENTRO do nome (separado por - / @): ex. "smpl-body", "@black-forest-labs/flux".
TOKENS_PROIBIDOS = {"smpl", "smplx", "sam3d", "vggt", "rbsm", "irbsm", "lirbsm", "da3", "pymeshlab"}
ESCOPOS_PROIBIDOS = {"black-forest-labs", "@black-forest-labs", "depth-anything", "facebookresearch-sam3d"}
SUBSTRINGS_PROIBIDAS = ("depth-anything-3", "depth-anything-v3", "depth-anything-v2", "flux-1-dev", "flux1-dev", "flux-dev",
                        "black-forest-labs", "sam-3d-body", "sam3d", "smpl-x", "smplx")


def normalizar(nome: str) -> str:
    return re.sub(r"[._]+", "-", nome.strip().lower())


def proibido(nome: str) -> bool:
    n = normalizar(nome)
    escopo, _, base = n.rpartition("/")
    if n in PROIBIDOS_NOME or base in PROIBIDOS_NOME:
        return True
    if escopo and escopo in ESCOPOS_PROIBIDOS:
        return True
    if set(re.split(r"[-/@]+", n)) & TOKENS_PROIBIDOS:
        return True
    return any(s in n for s in SUBSTRINGS_PROIBIDAS)


def nomes_pnpm_lock(p: Path) -> set[str]:
    out: set[str] = set()
    secao = None
    for linha in p.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\S", linha):
            secao = linha.rstrip(":")
            continue
        if secao in ("packages", "snapshots"):
            m = re.match(r"^  '?(@?[^@\s'][^@\s']*)@", linha)
            if m:
                out.add(m.group(1))
        elif secao == "importers":
            m = re.match(r"^      '?(@?[^:\s']+)'?:\s*$", linha)
            if m:
                out.add(m.group(1))
    return out


def nomes_package_json(p: Path) -> set[str]:
    d = json.loads(p.read_text(encoding="utf-8"))
    out = {d.get("name", "")}
    for k in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        out |= set((d.get(k) or {}).keys())
    return {n for n in out if n}


def nome_req(espec: str) -> str | None:
    m = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)", espec)
    return m.group(1) if m else None


def nomes_pyproject(p: Path) -> set[str]:
    d = tomllib.loads(p.read_text(encoding="utf-8"))
    proj = d.get("project", {})
    specs = list(proj.get("dependencies", []))
    for lista in (proj.get("optional-dependencies") or {}).values():
        specs += list(lista)
    return {n for n in (nome_req(s) for s in specs) if n}


def nomes_requirements(p: Path) -> set[str]:
    out = set()
    for linha in p.read_text(encoding="utf-8").splitlines():
        linha = linha.split("#", 1)[0].strip()
        if linha and not linha.startswith("-"):
            n = nome_req(linha)
            if n:
                out.add(n)
    return out


def nomes_venv(raiz: Path) -> set[str]:
    py = raiz / "services/mesh/.venv/bin/python"
    if not py.is_file():
        return set()
    r = subprocess.run([str(py), "-m", "pip", "list", "--format=json"], capture_output=True, text=True, check=True)
    return {x["name"] for x in json.loads(r.stdout)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raiz", default=str(Path(__file__).resolve().parents[1]))
    raiz = Path(ap.parse_args().raiz).resolve()
    fontes: dict[str, set[str]] = {}
    if (raiz / "pnpm-lock.yaml").is_file():
        fontes["pnpm-lock.yaml"] = nomes_pnpm_lock(raiz / "pnpm-lock.yaml")
    for pj in [raiz / "package.json", *sorted(raiz.glob("apps/*/package.json")), *sorted(raiz.glob("packages/*/package.json"))]:
        if pj.is_file():
            fontes[str(pj.relative_to(raiz))] = nomes_package_json(pj)
    pp = raiz / "services/mesh/pyproject.toml"
    if pp.is_file():
        fontes[str(pp.relative_to(raiz))] = nomes_pyproject(pp)
    for rq in sorted(raiz.glob("services/mesh/requirements*.txt")):
        fontes[str(rq.relative_to(raiz))] = nomes_requirements(rq)
    venv = nomes_venv(raiz)
    if venv:
        fontes["services/mesh/.venv (pip list)"] = venv
    if not fontes or sum(len(v) for v in fontes.values()) == 0:
        print("ERRO: nenhum manifesto/lockfile de dependencias encontrado", file=sys.stderr)
        return 1
    achados = sorted({(f, n) for f, nomes in fontes.items() for n in nomes if proibido(n)})
    for f, n in achados:
        print(f"PROIBIDO (ADR 0009): {n}  em {f}", file=sys.stderr)
    total = sum(len(v) for v in fontes.values())
    if not achados:
        print(f"nenhum pacote proibido entre {total} nomes em: {', '.join(fontes)}")
    return 1 if achados else 0


if __name__ == "__main__":
    sys.exit(main())
