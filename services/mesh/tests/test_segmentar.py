"""Segmentacao sem pesos (modo `template`, fundo liso) e o fallback automatico do modo `onnx` (criterio 6
do P1, parte sem pesos: IoU >= 0,93 com a mascara exata no fundo neutro)."""

from __future__ import annotations

import json

import numpy as np
import pytest
from PIL import Image

from mesh import esquemas
from mesh.foto import camera as cam
from mesh.foto import segmentar
from mesh.foto import template as tpl
from mesh.foto.reconstruir import projecao_template

from .foto_util import VISTAS_3, garantir_fotos


@pytest.mark.parametrize("vista", VISTAS_3)
def test_template_iou_no_fundo_neutro(vista, torsos, dir_sinteticos):
    pasta = dir_sinteticos / "t02_assimetrico"
    garantir_fotos(pasta)
    reg = json.loads((pasta / "fotos" / f"registro_{vista}.json").read_text(encoding="utf-8"))
    img = np.asarray(Image.open(pasta / reg["arquivo"]).convert("RGB"))
    exata = np.asarray(Image.open(pasta / reg["mascara"])) > 127
    # projecao guia com o template medio (nao o verdadeiro) e a pose exata: a guia e so aproximada
    K, R, t = cam.de_coluna_major(reg["K"]), cam.de_coluna_major(reg["R"]), np.asarray(reg["t"])
    proj = projecao_template(tpl.vetor_media(), K, R, t, reg["largura_px"], reg["altura_px"])
    m, modo, avisos = segmentar.segmentar(img, proj, "template")
    assert modo == "template" and "segmentacao_template_fundo_liso" in avisos
    iou = segmentar.iou(m, exata)
    print(f"\n[foto] segmentacao template {vista}: IoU {iou:.4f}")
    assert iou >= 0.93


def test_onnx_sem_pesos_cai_no_template(tmp_path, monkeypatch):
    monkeypatch.setenv("MESH_PESOS_DIR", str(tmp_path))
    assert segmentar.onnx_disponivel() is None
    img = np.full((120, 160, 3), (0x8A, 0x8F, 0x96), np.uint8)
    img[30:110, 50:110] = (214, 170, 140)
    proj = np.zeros((120, 160), bool)
    proj[35:115, 55:115] = True
    m, modo, avisos = segmentar.segmentar(img, proj, "onnx")
    assert modo == "template" and "segmentacao_onnx_indisponivel" in avisos
    alvo = np.zeros((120, 160), bool)
    alvo[30:110, 50:110] = True
    assert segmentar.iou(m, alvo) > 0.9


def test_modo_desconhecido():
    with pytest.raises(ValueError):
        segmentar.segmentar(np.zeros((10, 10, 3), np.uint8), None, "magica")


def test_template_medio_valido():
    esquemas.validar("torso_parametros", esquemas.completar_parametros(tpl.parametros_de_vetor(tpl.vetor_media())))
