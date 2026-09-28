"""Referencias de escala (escala.py): validacao da requisicao e `regua_foto`/`base_digitada` honradas no
ajuste (so a frontal)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from mesh.foto import ajuste as aj
from mesh.foto import camera as cam
from mesh.foto import escala as esc

from .foto_util import carregar_fotos, garantir_fotos


def test_requisicao_invalida():
    for bloco in (None, {}, {"metodo": "ssn_n_fita"}, {"metodo": "palmo", "valor_mm": 200},
                  {"metodo": "ssn_n_fita", "valor_mm": 5}, {"metodo": "regua_foto", "valor_mm": 100},
                  {"metodo": "regua_foto", "valor_mm": 100, "pontos_px": [[10, 10], [12, 10]]}):
        with pytest.raises(esc.ErroEscala) as e:
            esc.escala_de_requisicao(bloco)
        assert e.value.codigo == "escala_ausente"
    e = esc.escala_de_requisicao({"metodo": "base_digitada", "valor_mm": 120, "lado": "esq"})
    assert e.metodo == "base_digitada" and e.lado == "esq"


@pytest.mark.parametrize("metodo", ["regua_foto", "base_digitada"])
def test_escala_honrada(metodo, torsos, dir_sinteticos):
    pasta = dir_sinteticos / "t01_simetrico_300"
    garantir_fotos(pasta)
    g = torsos["t01_simetrico_300"]
    reg = json.loads((pasta / "fotos" / "registro_frente.json").read_text(encoding="utf-8"))
    K, R, t = cam.de_coluna_major(reg["K"]), cam.de_coluna_major(reg["R"]), np.asarray(reg["t"])
    if metodo == "regua_foto":
        # regua de 150 mm no plano da furcula, paralela a imagem (eixo x da camera)
        c = cam.para_camera(np.zeros((1, 3)), R, t)[0]
        pts = np.array([c - [75.0, 0, 0], c + [75.0, 0, 0]])
        uv = pts[:, :2] / pts[:, 2:] * K[0, 0] + K[:2, 2]
        e = esc.escala_de_requisicao({"metodo": metodo, "valor_mm": 150.0, "pontos_px": uv.tolist()})
    else:
        e = esc.escala_de_requisicao({"metodo": metodo, "valor_mm": g["distancias"]["base_dir"]["euclidiana_mm"]})
    res = aj.ajustar(carregar_fotos(pasta, ("frente",)), e)
    b = esc.bloco_escala(e, res.landmarks_3d, res.poses[0], K)
    assert b["fator"] == pytest.approx(1.0, abs=0.01)
    ssn = float(np.linalg.norm(res.landmarks_3d["mamilo_dir"]))
    assert ssn == pytest.approx(g["distancias"]["ssn_n_dir"]["euclidiana_mm"], rel=0.03)
