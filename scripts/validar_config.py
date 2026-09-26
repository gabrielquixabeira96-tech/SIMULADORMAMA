#!/usr/bin/env python3
"""Valida os JSONs de config/ e docs/validacao/ contra config/schemas/ (draft 2020-12).

Uso: python3 scripts/validar_config.py   (requer: pip install jsonschema)
Sai com 1 se algo falhar. Tambem confere unicidade global de implantes.id no catalogo.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    print("jsonschema ausente: pip install jsonschema", file=sys.stderr)
    sys.exit(2)

RAIZ = Path(__file__).resolve().parent.parent
SCHEMAS = RAIZ / "config" / "schemas"

# (arquivo ou glob, schema, chave que contem lista de instancias ou None)
ALVOS: list[tuple[str, str, str | None]] = [
    ("config/tepid.json", "tepid_config", None),
    ("config/simulacao.json", "simulacao_config", None),
    ("config/torsos_presets.json", "torso_parametros", "presets"),
    ("config/catalogo/*.json", "catalogo", None),
    ("docs/validacao/v*.json", "validacao", None),
]


def carregar_schema(nome: str) -> Draft202012Validator:
    esquema = json.loads((SCHEMAS / f"{nome}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(esquema)
    return Draft202012Validator(esquema)


def main() -> int:
    falhas = 0
    for p in sorted(SCHEMAS.glob("*.schema.json")):
        try:
            carregar_schema(p.stem.replace(".schema", ""))
            print(f"[ok] schema valido: {p.relative_to(RAIZ)}")
        except Exception as e:  # noqa: BLE001
            print(f"[FALHA] schema invalido {p}: {e}")
            falhas += 1

    ids_implantes: dict[str, str] = {}
    for padrao, nome_schema, chave in ALVOS:
        validador = carregar_schema(nome_schema)
        arquivos = sorted(RAIZ.glob(padrao))
        if not arquivos:
            print(f"[pulado] nenhum arquivo para {padrao}")
            continue
        for arq in arquivos:
            try:
                dado = json.loads(arq.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                print(f"[FALHA] JSON invalido {arq.relative_to(RAIZ)}: {e}")
                falhas += 1
                continue
            instancias = dado[chave] if chave else [dado]
            for i, inst in enumerate(instancias):
                erros = sorted(validador.iter_errors(inst), key=lambda e: list(e.path))
                rotulo = f"{arq.relative_to(RAIZ)}" + (f"[{chave}][{i}]" if chave else "")
                if erros:
                    falhas += 1
                    print(f"[FALHA] {rotulo}")
                    for e in erros[:10]:
                        print(f"        {'/'.join(map(str, e.path)) or '<raiz>'}: {e.message[:160]}")
                else:
                    print(f"[ok] {rotulo} ~ {nome_schema}/1.0")
            if nome_schema == "catalogo":
                for imp in dado.get("implantes", []):
                    if imp["id"] in ids_implantes:
                        print(f"[FALHA] implante id duplicado '{imp['id']}' em {arq.name} e {ids_implantes[imp['id']]}")
                        falhas += 1
                    ids_implantes[imp["id"]] = arq.name
                    if imp["forma"] == "redonda" and abs(imp["base_mm"] - imp["altura_mm"]) > 1e-6:
                        print(f"[FALHA] implante redondo '{imp['id']}' com altura_mm != base_mm")
                        falhas += 1

    versao = (RAIZ / "VERSION").read_text().strip()
    sidecar = RAIZ / "docs" / "validacao" / f"v{versao}.json"
    if sidecar.exists():
        dado = json.loads(sidecar.read_text(encoding="utf-8"))
        if dado.get("versao_software") != versao:
            print(f"[FALHA] {sidecar.name}: versao_software != VERSION ({versao})")
            falhas += 1
        else:
            print(f"[ok] {sidecar.name} coerente com VERSION={versao}")
    else:
        print(f"[FALHA] falta docs/validacao/v{versao}.json")
        falhas += 1

    print("[ok] tudo valido" if falhas == 0 else f"[FALHA] {falhas} problema(s)")
    return 0 if falhas == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
