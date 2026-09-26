"""services/mesh — processamento de malha, torso sintetico e antropometria.

Convencoes (docs/contratos.md §1, ADR 0010): milimetro em tudo, volume em mL, sistema destro,
+Y cranial, +Z anterior, +X lado esquerdo da paciente. Lados `dir`/`esq` sempre da paciente.
"""

from mesh.versao import CONTRATO, VERSAO_SOFTWARE

__all__ = ["CONTRATO", "VERSAO_SOFTWARE"]
