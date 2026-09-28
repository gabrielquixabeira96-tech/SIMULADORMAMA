"""Referencia de escala da reconstrucao por fotos (contrato C1 `escala`).

Com fotos, a escala absoluta nao vem da imagem (tamanho e distancia se confundem): vem de uma medida
digitada pelo medico, que o ajuste fixa com sigma 0,5 mm (mesh/foto/ajuste.py):

- `ssn_n_fita`: furcula-mamilo (SSN-N) medido com fita, lado `dir`|`esq`; o ajuste fixa a distancia 3D
  |furcula - mamilo| (euclidiana, como `distancias.ssn_n_*.euclidiana_mm`). A mais indicada.
- `regua_foto`: 2 cliques (px) sobre uma regua visivel na foto frontal + o comprimento em mm; os pontos
  sao levados ao plano da furcula paralelo a imagem (a regua deve estar a altura do esterno).
- `base_digitada`: largura da base (TEPID, paquimetro) base_medial - base_lateral do lado; a menos
  precisa (a borda da base e mal definida na foto).

`fator` no bloco de saida = valor_mm / (a mesma medida no modelo ajustado): ~1,0 quando a referencia
foi honrada; longe de 1 indica conflito entre a referencia e as fotos.
"""

from __future__ import annotations

import numpy as np

from mesh.foto.ajuste import EscalaAjuste

METODOS = ("ssn_n_fita", "regua_foto", "base_digitada")


class ErroEscala(ValueError):
    def __init__(self, codigo: str, mensagem: str):
        super().__init__(f"{codigo}: {mensagem}")
        self.codigo = codigo
        self.mensagem = mensagem


def escala_de_requisicao(bloco: dict | None) -> EscalaAjuste:
    if not bloco or bloco.get("metodo") is None or bloco.get("valor_mm") is None:
        raise ErroEscala("escala_ausente", "informe escala.metodo e escala.valor_mm")
    metodo = bloco["metodo"]
    if metodo not in METODOS:
        raise ErroEscala("escala_ausente", f"metodo de escala desconhecido: {metodo}")
    valor = float(bloco["valor_mm"])
    if not np.isfinite(valor) or not (20.0 <= valor <= 600.0):
        raise ErroEscala("escala_ausente", "valor_mm fora de [20, 600] mm")
    lado = bloco.get("lado", "dir")
    if lado not in ("dir", "esq"):
        raise ErroEscala("escala_ausente", "lado deve ser dir ou esq")
    pontos = None
    if metodo == "regua_foto":
        pts = bloco.get("pontos_px")
        if not pts or len(pts) != 2:
            raise ErroEscala("escala_ausente", "regua_foto exige pontos_px: 2 pontos [u, v] na foto frontal")
        pontos = np.asarray(pts, dtype=np.float64).reshape(2, 2)
        if np.linalg.norm(pontos[0] - pontos[1]) < 20:
            raise ErroEscala("escala_ausente", "os 2 pontos da regua estao a menos de 20 px")
    return EscalaAjuste(metodo, valor, lado, pontos)


def medida_no_modelo(escala: EscalaAjuste, L: dict, pose_frontal=None, K=None) -> float:
    if escala.metodo == "ssn_n_fita":
        return float(np.linalg.norm(L["mamilo_" + escala.lado] - L["furcula"]))
    if escala.metodo == "base_digitada":
        return float(np.linalg.norm(L["base_lateral_" + escala.lado] - L["base_medial_" + escala.lado]))
    R, t = pose_frontal
    zf = (R @ L["furcula"] + t)[2]
    q = np.column_stack([escala.pontos_px, np.ones(2)]) @ np.linalg.inv(K).T * zf
    return float(np.linalg.norm(q[0] - q[1]))


def bloco_escala(escala: EscalaAjuste, L: dict, pose_frontal=None, K=None) -> dict:
    medido = medida_no_modelo(escala, L, pose_frontal, K)
    out = {"metodo": escala.metodo, "valor_mm": round(escala.valor_mm, 2),
           "fator": round(escala.valor_mm / medido, 5) if medido > 0 else None, "medido_no_modelo_mm": round(medido, 2)}
    if escala.metodo != "regua_foto":
        out["lado"] = escala.lado
    return out
