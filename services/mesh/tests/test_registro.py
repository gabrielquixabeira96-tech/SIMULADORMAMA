"""Registro de componente do services/mesh (plano PT2: A5 e A7): caminhos com a versao corrente e
resultado do glTF-Validator em vez de "verificacao manual"."""

from __future__ import annotations

from mesh.validacao import _markdown, _markdown_marco2
from mesh.versao import VERSAO_SOFTWARE

RESUMO = {"marco0_erro_max_gabarito_mm": 0.09, "aprovado_marco0": True}
BA = {"n": 0, "vies_mm": 0.0, "dp_mm": 0.0, "loa_inferior_mm": 0.0, "loa_superior_mm": 0.0, "dentro_de_2mm": True}
M2 = {"monotonicidade": True, "simetria_max_mm": 0.0, "imf_manter_max_mm": 0.0, "imf_rebaixar_erro_max_mm": 0.0,
      "series": {}, "precomputo": {}}


def test_registro_como_reproduzir_usa_versao_corrente():
    md = _markdown(RESUMO, [], BA)
    assert f"--relatorio ../../docs/validacao/v{VERSAO_SOFTWARE}-services-mesh.md" in md
    assert f"`v{VERSAO_SOFTWARE}.md`" in md
    assert "validar_gltf.mjs" in md
    if VERSAO_SOFTWARE != "0.0.1":
        assert "v0.0.1" not in md


def test_registro_gltf_validator_resultado_e_nao_manual():
    ok = _markdown_marco2(M2, "cat.json", {"arquivos": 12, "erros": 0, "avisos": 0, "versao": "2.0.0-dev.3.10"})
    assert "12 arquivos, **0 erros, 0 avisos**" in ok and "sem erros nem avisos" in ok
    ruim = _markdown_marco2(M2, "cat.json", {"arquivos": 12, "erros": 1, "avisos": 2, "versao": "2.0.0-dev.3.10"})
    assert "NÃO passou" in ruim
    sem = _markdown_marco2(M2, "cat.json")
    assert "não executado" in sem
    for md in (ok, ruim, sem):
        assert "verificação manual" not in md
