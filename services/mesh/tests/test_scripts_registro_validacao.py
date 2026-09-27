"""scripts/registro_validacao.py: ordenacao de versoes do indice (estilo SemVer, total, sem TypeError)."""

from __future__ import annotations

import importlib.util
import random
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("registro_validacao", RAIZ / "scripts" / "registro_validacao.py")
assert _spec and _spec.loader
rv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rv)

ORDEM = [
    "0.1.0",
    "0.1.1",
    "0.1.2-alpha",
    "0.1.2-alpha.1",
    "0.1.2-alpha.beta",
    "0.1.2-beta",
    "0.1.2-beta.2",
    "0.1.2-beta.11",
    "0.1.2-rc.1",
    "0.1.2",
    "0.2.0-rc1",
    "0.2.0",
    "0.10.0",
    "1.0.0-0",
    "1.0.0",
]


def test_ordem_semver_total_prerelease_antes_da_release():
    embaralhada = ORDEM[:]
    random.Random(7).shuffle(embaralhada)
    assert sorted(embaralhada, key=rv._chave_versao) == ORDEM
    # o caso que antes levantava TypeError (int vs str na mesma posicao)
    assert rv._chave_versao("0.2.0-rc1") < rv._chave_versao("0.2.0")
    assert rv._chave_versao("0.2.0-rc1") > rv._chave_versao("0.1.9")
    # build ignorado; prefixo v aceito; campos ausentes = 0
    assert rv._chave_versao("v0.1.1+abc") == rv._chave_versao("0.1.1")
    assert rv._chave_versao("0.2") == rv._chave_versao("0.2.0")


def test_indice_insere_prerelease_na_ordem(tmp_path: Path):
    indice = tmp_path / "README.md"
    indice.write_text(
        "# Registros\n\n| Versão | Data |\n|---|---|\n| 0.2.0 | x |\n| 0.1.1 | x |\n\nfim\n", encoding="utf-8"
    )
    rv.atualizar_indice(indice, "0.2.0-rc1", "| 0.2.0-rc1 | x |")
    rv.atualizar_indice(indice, "0.1.2", "| 0.1.2 | x |")
    linhas = [l.split("|")[1].strip() for l in indice.read_text(encoding="utf-8").splitlines() if l.startswith("| 0")]
    assert linhas == ["0.2.0", "0.2.0-rc1", "0.1.2", "0.1.1"]
