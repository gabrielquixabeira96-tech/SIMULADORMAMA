"""Leitura (OBJ/PLY via trimesh) e escrita (OBJ+MTL, PNG) de malhas — contratos §5.

Modelo em memoria: `MalhaRender` = malha "de desenho", com atributos por vertice (UV, cor, normal).
Vertices podem estar duplicados em costuras de UV (mesma posicao, UV diferente); operacoes
geometricas (geodesica, volume, componentes) usam a versao soldada (`geometria.soldar`).
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from mesh.malha.geometria import normais_vertices, soldar


@dataclass
class MalhaRender:
    V: np.ndarray                      # (n,3) float64, mm
    F: np.ndarray                      # (m,3) int64, base 0, anti-horario visto de fora
    uv: np.ndarray | None = None       # (n,2) float64, origem inferior esquerda (padrao OBJ)
    cores: np.ndarray | None = None    # (n,3) uint8 (cor por vertice, PLY)
    textura: Image.Image | None = None
    avisos: list[str] = field(default_factory=list)

    @property
    def n_vertices(self) -> int:
        return int(len(self.V))

    @property
    def n_faces(self) -> int:
        return int(len(self.F))

    def normais(self) -> np.ndarray:
        """Normais suaves calculadas na malha soldada (sem descontinuidade nas costuras de UV)."""
        Vw, Fw, mapa = soldar(self.V, self.F)
        return normais_vertices(Vw, Fw)[mapa]

    def caixa(self) -> tuple[list[float], list[float]]:
        return self.V.min(0).tolist(), self.V.max(0).tolist()


def sha256_arquivo(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


# ----------------------------------------------------------------------------- leitura

def ler_malha(caminho: Path) -> MalhaRender:
    """Le OBJ (com MTL/map_Kd) ou PLY (ASCII/binario, cor por vertice, UV opcional). Triangula."""
    import trimesh

    sufixo = caminho.suffix.lower()
    if sufixo not in (".obj", ".ply"):
        raise ValueError(f"formato nao suportado: {sufixo}")
    kwargs = {"process": False, "force": "mesh"}
    if sufixo == ".obj":
        kwargs["maintain_order"] = True
        kwargs["skip_materials"] = False
    m = trimesh.load(str(caminho), **kwargs)
    if not isinstance(m, trimesh.Trimesh) or len(m.faces) == 0:
        raise ValueError("arquivo sem malha triangular legivel")
    V = np.asarray(m.vertices, dtype=np.float64)
    F = np.asarray(m.faces, dtype=np.int64)
    malha = MalhaRender(V=V, F=F)
    vis = m.visual
    if getattr(vis, "kind", None) == "texture":
        uv = getattr(vis, "uv", None)
        if uv is not None and len(uv) == len(V):
            malha.uv = np.asarray(uv, dtype=np.float64)
        elif uv is not None:
            malha.avisos.append("uv_inconsistente_ignorada")
        mat = getattr(vis, "material", None)
        img = getattr(mat, "image", None) if mat is not None else None
        if img is None and mat is not None:
            img = getattr(mat, "baseColorTexture", None)
        if img is not None:
            malha.textura = img.convert("RGB")
        elif malha.uv is not None:
            malha.avisos.append("textura_referenciada_nao_encontrada")
    elif getattr(vis, "kind", None) == "vertex":
        cores = np.asarray(vis.vertex_colors)
        if cores.ndim == 2 and len(cores) == len(V):
            malha.cores = cores[:, :3].astype(np.uint8)
    return malha


# ----------------------------------------------------------------------------- escrita

def _linhas(prefixo: str, dados: np.ndarray, fmt: str) -> str:
    buf = io.StringIO()
    np.savetxt(buf, dados, fmt=f"{prefixo} {fmt}")
    return buf.getvalue()


def escrever_obj(caminho: Path, malha: MalhaRender, nome_mtl: str | None = None,
                 nome_textura: str | None = None, cabecalho: str = "") -> None:
    """OBJ ASCII so de triangulos, um objeto; vertice i usa vt i e vn i (mesma ordem do .glb)."""
    caminho = Path(caminho)
    N = malha.normais()
    partes = [f"# simulador-mamario/mesh — unidade: mm; +Y cranial, +Z anterior, +X esquerda da paciente\n{cabecalho}"]
    if nome_mtl:
        partes.append(f"mtllib {nome_mtl}\n")
    partes.append("o torso\n")
    partes.append(_linhas("v", malha.V, "%.5f %.5f %.5f"))
    tem_uv = malha.uv is not None
    if tem_uv:
        partes.append(_linhas("vt", malha.uv, "%.6f %.6f"))
    partes.append(_linhas("vn", N, "%.5f %.5f %.5f"))
    if nome_mtl:
        partes.append("usemtl material0\n")
    f1 = malha.F + 1
    if tem_uv:
        trip = np.repeat(f1, 3, axis=1)  # a a a b b b c c c
        partes.append(_linhas("f", trip, "%d/%d/%d %d/%d/%d %d/%d/%d"))
    else:
        trip = np.repeat(f1, 2, axis=1)
        partes.append(_linhas("f", trip, "%d//%d %d//%d %d//%d"))
    caminho.write_text("".join(partes), encoding="utf-8")
    if nome_mtl:
        linhas = ["newmtl material0", "Ka 1.000 1.000 1.000", "Kd 1.000 1.000 1.000", "Ks 0.000 0.000 0.000",
                  "d 1.0", "illum 1"]
        if nome_textura:
            linhas.append(f"map_Kd {nome_textura}")
        (caminho.parent / nome_mtl).write_text("\n".join(linhas) + "\n", encoding="utf-8")


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG", optimize=False)
    return buf.getvalue()
