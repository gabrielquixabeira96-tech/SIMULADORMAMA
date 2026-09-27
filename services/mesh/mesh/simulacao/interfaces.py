"""Interfaces de simulacao (contratos §12.1). O modelo geometrico implementa `SimuladorDeformacao`;
FEBio (fase 6) e o surrogate ONNX (fase 6) ficam como stubs que levantam NotImplementedError, para
serem intercambiaveis atras do mesmo contrato."""

from __future__ import annotations

from typing import Literal, Protocol, TypedDict

import numpy as np

Plano = Literal["subglandular", "dual_plane"]
Imf = Literal["manter", "rebaixar"]
Lado = Literal["ambos", "dir", "esq"]


class Implante(TypedDict):  # subconjunto do catalogo, contratos §11
    id: str
    forma: Literal["redonda", "anatomica"]
    base_mm: float
    altura_mm: float
    projecao_mm: float
    volume_ml: float


class ResultadoSimulacao(TypedDict):
    deltas_mm: np.ndarray  # (n_vertices, 3) float32 — delta por vertice da malha processada
    previsto: dict         # contratos §10.4 "previsto"
    modelo: str            # "geometrico_parametrico_v1" | "febio_v1" | "surrogate_onnx_v1"
    nao_calibrado: bool


class SimuladorDeformacao(Protocol):
    def simular(self, vertices_mm: np.ndarray, faces: np.ndarray, landmarks: dict, implante: Implante,
                plano: Plano, imf: Imf, lado: Lado, config: dict) -> ResultadoSimulacao: ...


class GeradorFEBio(Protocol):  # offline, fase 6
    def gerar_feb(self, vertices_mm, faces, landmarks, implante, plano, imf, saida_dir: str) -> str: ...
    def ler_resultado(self, caminho_log: str) -> ResultadoSimulacao: ...


class SurrogateONNX(Protocol):  # fase 6
    def exportar(self, dataset_dir: str, saida_onnx: str) -> str: ...
    def carregar(self, caminho_onnx: str) -> SimuladorDeformacao: ...


class GeradorFEBioStub:
    """Stub: FEBio entra na fase 6 (ESTRATEGIA.md). Mantem a assinatura do contrato."""

    def gerar_feb(self, vertices_mm, faces, landmarks, implante, plano, imf, saida_dir: str) -> str:
        raise NotImplementedError("nao_implementado: FEBio (fase 6)")

    def ler_resultado(self, caminho_log: str) -> ResultadoSimulacao:
        raise NotImplementedError("nao_implementado: FEBio (fase 6)")


class SurrogateONNXStub:
    """Stub: surrogate neural (ONNX Runtime, MIT) entra na fase 6."""

    def exportar(self, dataset_dir: str, saida_onnx: str) -> str:
        raise NotImplementedError("nao_implementado: surrogate ONNX (fase 6)")

    def carregar(self, caminho_onnx: str) -> SimuladorDeformacao:
        raise NotImplementedError("nao_implementado: surrogate ONNX (fase 6)")
