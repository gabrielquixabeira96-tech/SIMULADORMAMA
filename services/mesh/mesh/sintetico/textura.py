"""Textura procedural neutra (contratos §4; ADR 0009 item 5): tom uniforme com ruido leve e
gradiente vertical sutil. Nenhuma imagem fotografica, nenhum mamilo/areola desenhado.
Periodica em u (a costura nas costas fica invisivel). Deterministica pela `semente`.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

COR_BASE = np.array([206.0, 192.0, 182.0])  # bege-acinzentado neutro


def textura_neutra(semente: int, tamanho: int = 1024) -> Image.Image:
    rng = np.random.default_rng(semente)
    u = np.linspace(0, 1, tamanho, endpoint=False)
    v = np.linspace(0, 1, tamanho)
    U, Vv = np.meshgrid(u, v, indexing="xy")
    ruido = np.zeros_like(U)
    for _ in range(12):
        fu = rng.integers(1, 24)          # frequencia inteira em u -> periodica
        fv = rng.uniform(1, 24)
        fase = rng.uniform(0, 2 * np.pi, 2)
        ruido += np.sin(2 * np.pi * fu * U + fase[0]) * np.sin(2 * np.pi * fv * Vv + fase[1])
    ruido /= np.abs(ruido).max() or 1.0
    gradiente = (Vv - 0.5) * 6.0  # +-3 niveis de cinza
    img = COR_BASE[None, None, :] + (3.0 * ruido + gradiente)[..., None]
    return Image.fromarray(np.clip(np.round(img), 0, 255).astype(np.uint8))
