"""Segmentacao do torso na foto (mascara usada pelo residuo de silhueta do ajuste).

Modos (`opcoes.segmentacao` de POST /reconstruir-foto):
- `mascara`: a mascara veio pronta com a foto (fotos sinteticas: exata; ou desenhada pelo medico).
- `onnx`: rede de segmentacao (ISNet/U2-Net, Apache-2.0) via onnxruntime, com pesos em
  `$MESH_PESOS_DIR` (padrao `DATA_DIR/modelos/`). **Ainda nao entregue neste pacote** (P1-nucleo; sessao 2
  do plano: onnxruntime e `scripts/pesos.sh` entram junto): sem onnxruntime ou sem os pesos, cai
  automaticamente no modo `template`, com o aviso `segmentacao_onnx_indisponivel`.
- `template` (sem pesos): exige fundo liso. A projecao do template (pose e forma preliminares) e dilatada
  (`MARGEM_PX`); a cor do fundo e modelada pelos pixels fora dela, a da pele pelo miolo (projecao
  erodida); cada pixel da faixa intermediaria vai para a classe mais proxima (distancia de Mahalanobis
  em RGB), com limpeza morfologica, preenchimento de buracos e o maior componente conexo. A mascara
  fica restrita a projecao dilatada (bracos, cabelo e objetos longe do torso ficam de fora).
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from scipy import ndimage

MODOS = ("mascara", "onnx", "template")
MARGEM_PX = 60
MIOLO_PX = 25
PESOS = ("isnet-general-use.onnx", "u2net.onnx", "u2netp.onnx")


def dir_pesos() -> Path:
    from mesh.caminhos import data_dir

    return Path(os.environ.get("MESH_PESOS_DIR") or (data_dir() / "modelos"))


def onnx_disponivel() -> Path | None:
    """Caminho dos pesos se onnxruntime e um dos pesos existirem; senao None."""
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        return None
    for nome in PESOS:
        p = dir_pesos() / nome
        if p.is_file():
            return p
    return None


def _modelo_cor(px: np.ndarray):
    px = px.astype(np.float64)
    mu = np.median(px, axis=0)
    C = np.cov(px.T) + np.eye(3) * 4.0
    return mu, np.linalg.inv(C)


def _mahal(px: np.ndarray, modelo) -> np.ndarray:
    mu, Ci = modelo
    d = px.astype(np.float64) - mu
    return np.einsum("ij,jk,ik->i", d, Ci, d)


def segmentar_template(imagem: np.ndarray, projecao: np.ndarray | None) -> np.ndarray:
    img = np.asarray(imagem)
    H, W = img.shape[:2]
    if projecao is None or not projecao.any():
        projecao = np.zeros((H, W), bool)
        projecao[H // 4:3 * H // 4, W // 4:3 * W // 4] = True
        regiao = np.ones((H, W), bool)
    else:
        regiao = ndimage.binary_dilation(projecao, iterations=MARGEM_PX)
    miolo = ndimage.binary_erosion(projecao, iterations=MIOLO_PX)
    if miolo.sum() < 100:
        miolo = projecao
    fundo = ~ndimage.binary_dilation(regiao, iterations=5)
    if fundo.sum() < 100:
        borda = np.zeros((H, W), bool)
        borda[:, :10] = borda[:, -10:] = True
        fundo = borda & ~projecao
    m_fundo, m_pele = _modelo_cor(img[fundo]), _modelo_cor(img[miolo])
    faixa = regiao & ~miolo
    px = img[faixa]
    pele = _mahal(px, m_pele) < _mahal(px, m_fundo)
    mascara = miolo.copy()
    mascara[faixa] = pele
    mascara = ndimage.binary_opening(mascara, iterations=2)
    mascara = ndimage.binary_closing(mascara, iterations=3)
    mascara = ndimage.binary_fill_holes(mascara)
    rot, n = ndimage.label(mascara)
    if n > 1:
        tam = ndimage.sum(mascara, rot, index=np.arange(1, n + 1))
        mascara = rot == (1 + int(np.argmax(tam)))
    return mascara & regiao


def segmentar(imagem: np.ndarray, projecao: np.ndarray | None, modo: str = "onnx") -> tuple[np.ndarray, str, list[str]]:
    """(mascara bool, modo usado, avisos)."""
    if modo not in ("onnx", "template"):
        raise ValueError(f"modo de segmentacao desconhecido: {modo}")
    avisos: list[str] = []
    if modo == "onnx":
        # o caminho ONNX entra com onnxruntime e scripts/pesos.sh (plano foto3d, sessao 2)
        avisos.append("segmentacao_onnx_indisponivel")
        modo = "template"
    avisos.append("segmentacao_template_fundo_liso")
    return segmentar_template(imagem, projecao), modo, avisos


def iou(a: np.ndarray, b: np.ndarray) -> float:
    a, b = np.asarray(a, bool), np.asarray(b, bool)
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0
