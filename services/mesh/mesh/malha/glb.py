"""Escrita de .glb (glTF 2.0 binario) no formato do contrato §5.3.

Um unico mesh/primitive (triangulos), POSITION/NORMAL/TEXCOORD_0|COLOR_0, indices uint32,
material pbrMetallicRoughness com textura embutida, unidade **mm** declarada em
asset.extras.unidade (desvio consciente da convencao em metros; ADR 0010). Ordem dos vertices
identica a do OBJ correspondente. Escrito a mao (sem dependencia extra) para controle total.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from mesh.malha.io import MalhaRender, png_bytes
from mesh.versao import VERSAO_SOFTWARE

_FLOAT, _UINT, _UBYTE = 5126, 5125, 5121
_ARRAY_BUFFER, _ELEMENT_ARRAY_BUFFER = 34962, 34963


def _alinhar(b: bytes, multiplo: int = 4, preenchimento: bytes = b"\x00") -> bytes:
    resto = (-len(b)) % multiplo
    return b + preenchimento * resto


def montar_glb(malha: MalhaRender, quadro: str = "scan", extras_asset: dict | None = None) -> bytes:
    V = malha.V.astype(np.float32)
    N = malha.normais().astype(np.float32)
    idx = malha.F.astype(np.uint32).reshape(-1)

    binario = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []

    def adicionar(dados: bytes, alvo: int | None) -> int:
        nonlocal binario
        binario = bytearray(_alinhar(bytes(binario)))
        bv = {"buffer": 0, "byteOffset": len(binario), "byteLength": len(dados)}
        if alvo is not None:
            bv["target"] = alvo
        binario += dados
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def acessor(arr: np.ndarray, tipo: str, comp: int, alvo: int, normalizado: bool = False,
                minmax: bool = False) -> int:
        bv = adicionar(arr.tobytes(), alvo)
        a = {"bufferView": bv, "componentType": comp, "count": int(arr.shape[0]), "type": tipo}
        if normalizado:
            a["normalized"] = True
        if minmax:
            a["min"] = arr.min(0).astype(float).tolist()
            a["max"] = arr.max(0).astype(float).tolist()
        accessors.append(a)
        return len(accessors) - 1

    atributos = {
        "POSITION": acessor(V, "VEC3", _FLOAT, _ARRAY_BUFFER, minmax=True),
        "NORMAL": acessor(N, "VEC3", _FLOAT, _ARRAY_BUFFER),
    }
    tem_textura = malha.uv is not None and malha.textura is not None
    if tem_textura:
        uv = malha.uv.astype(np.float32).copy()
        uv[:, 1] = 1.0 - uv[:, 1]  # glTF: origem no canto superior esquerdo (contratos §5.1)
        atributos["TEXCOORD_0"] = acessor(uv, "VEC2", _FLOAT, _ARRAY_BUFFER)
    elif malha.cores is not None:
        # VEC4 uint8: cada elemento precisa ocupar multiplo de 4 bytes (glTF 2.0 §3.6.2.4)
        rgba = np.full((len(V), 4), 255, dtype=np.uint8)
        rgba[:, :3] = malha.cores[:, :3]
        atributos["COLOR_0"] = acessor(rgba, "VEC4", _UBYTE, _ARRAY_BUFFER, normalizado=True)
    i_idx = acessor(idx, "SCALAR", _UINT, _ELEMENT_ARRAY_BUFFER)

    pbr: dict = {"metallicFactor": 0.0, "roughnessFactor": 0.8}
    gltf: dict = {
        "asset": {
            "version": "2.0",
            "generator": f"simulador-mamario/mesh {VERSAO_SOFTWARE}",
            "extras": {"unidade": "mm", "quadro": quadro, **(extras_asset or {})},
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "torso"}],
        "meshes": [{"name": "torso", "primitives": [
            {"attributes": atributos, "indices": i_idx, "material": 0, "mode": 4}]}],
        "materials": [{"name": "pele_neutra", "pbrMetallicRoughness": pbr, "doubleSided": False}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    if tem_textura:
        bv_img = adicionar(png_bytes(malha.textura), None)
        gltf["images"] = [{"bufferView": bv_img, "mimeType": "image/png"}]
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 33071}]
        gltf["textures"] = [{"source": 0, "sampler": 0}]
        pbr["baseColorTexture"] = {"index": 0, "texCoord": 0}
    else:
        pbr["baseColorFactor"] = [0.86, 0.80, 0.76, 1.0]

    binario = bytearray(_alinhar(bytes(binario)))
    gltf["buffers"] = [{"byteLength": len(binario)}]
    js = _alinhar(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), 4, b" ")
    total = 12 + 8 + len(js) + 8 + len(binario)
    return b"".join([
        struct.pack("<4sII", b"glTF", 2, total),
        struct.pack("<I4s", len(js), b"JSON"), js,
        struct.pack("<I4s", len(binario), b"BIN\x00"), bytes(binario),
    ])


def escrever_glb(caminho: Path, malha: MalhaRender, quadro: str = "scan", extras_asset: dict | None = None) -> None:
    Path(caminho).write_bytes(montar_glb(malha, quadro, extras_asset))


def ler_json_glb(caminho: Path) -> dict:
    dados = Path(caminho).read_bytes()
    magic, versao, _ = struct.unpack_from("<4sII", dados, 0)
    if magic != b"glTF" or versao != 2:
        raise ValueError("nao e glTF 2.0 binario")
    comp, tipo = struct.unpack_from("<I4s", dados, 12)
    if tipo != b"JSON":
        raise ValueError("primeiro chunk nao e JSON")
    return json.loads(dados[20:20 + comp].decode("utf-8"))
