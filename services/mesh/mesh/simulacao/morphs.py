"""Pre-computo de morph targets (implante x plano x IMF [x lado]) e exportacao glTF (contratos §10).

Um `.glb` por (plano, imf) com a malha base completa (mesma geometria, textura e ordem de vertices
da malha processada) + um target por (implante, lado), deltas de POSITION e NORMAL em acessores
esparsos (|delta| > 0,01 mm), nomes em `mesh.extras.targetNames`, e `manifest.json` (`morphs/1.0`).
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from mesh import esquemas
from mesh.malha.geometria import normais_vertices, soldar
from mesh.malha.glb import escrever_glb
from mesh.malha.io import ler_malha, sha256_arquivo
from mesh.medir.antropometria import LANDMARKS, _pos
from mesh.simulacao.geometrico import ErroSimulacao, SimuladorGeometrico, previsto
from mesh.versao import VERSAO_SOFTWARE

PLANOS = ("subglandular", "dual_plane")
IMFS = ("manter", "rebaixar")
LIMIAR_DELTA_MM = 0.01
LIMIAR_DELTA_NORMAL = 1e-3


def nome_target(implante_id: str, plano: str, imf: str, lado: str) -> str:
    base = f"mt__{implante_id}__{plano}__{imf}"
    return base if lado == "ambos" else f"{base}__{lado}"


def exigir_landmarks(lm: dict) -> None:
    faltando = [n for n in LANDMARKS if _pos(lm, n) is None]
    if faltando:
        raise ErroSimulacao("landmarks_da_base_ausentes:" + ",".join(faltando))


def gerar_morphs(pasta: Path, landmarks: dict, implantes: list[dict], planos=PLANOS, imfs=IMFS,
                 lados: str = "separados", malha_id: str = "", arquivo_obj: str = "processada.obj",
                 arquivo_glb: str = "processada.glb", quadro: str = "scan", pinca: dict | None = None,
                 config: dict | None = None) -> dict:
    t0 = time.perf_counter()
    exigir_landmarks(landmarks)
    if not implantes:
        raise ErroSimulacao("nenhum implante pedido")
    if lados not in ("ambos", "separados"):
        raise ErroSimulacao("lados deve ser 'ambos' ou 'separados'")
    for p in planos:
        if p not in PLANOS:
            raise ErroSimulacao(f"plano desconhecido: {p}")
    for i in imfs:
        if i not in IMFS:
            raise ErroSimulacao(f"imf desconhecido: {i}")
    config = config or esquemas.config_simulacao()
    base = ler_malha(pasta / arquivo_obj)
    Vw, Fw, mapa = soldar(base.V, base.F)
    Nw = normais_vertices(Vw, Fw)
    sim = SimuladorGeometrico()
    saida = pasta / "morphs"
    saida.mkdir(parents=True, exist_ok=True)

    arquivos = []
    n_targets = 0
    for plano in planos:
        for imf in imfs:
            alvos, meta_targets = [], []
            for imp in implantes:
                cd, ce = sim.campos(landmarks, imp, plano, imf, "ambos", config, pinca)
                Dd, De = cd.deslocamento(Vw, Nw), ce.deslocamento(Vw, Nw)
                variantes = [("ambos", Dd + De, [cd, ce])]
                if lados == "separados":
                    variantes += [("dir", Dd, [cd]), ("esq", De, [ce])]
                for lado, D, campos in variantes:
                    Dr = D[mapa]
                    dN = (normais_vertices(Vw + D, Fw) - Nw)[mapa]
                    mov = ((np.linalg.norm(Dr, axis=1) > LIMIAR_DELTA_MM)
                           | (np.linalg.norm(dN, axis=1) > LIMIAR_DELTA_NORMAL))
                    ind = np.nonzero(mov)[0]
                    nome = nome_target(imp["id"], plano, imf, lado)
                    alvos.append({"nome": nome, "indices": ind, "dpos": Dr[ind], "dnorm": dN[ind]})
                    meta_targets.append({"nome": nome, "implante_id": imp["id"], "lado": lado,
                                         "indice": len(meta_targets), "previsto": previsto(campos, landmarks)})
            arq = f"{plano}__{imf}.glb"
            escrever_glb(saida / arq, base, quadro=quadro, alvos=alvos,
                         extras_asset={"esquema": "morphs/1.0",
                                       "versao_config_simulacao": str(config.get("versao", "?")),
                                       "nao_calibrado": True, "modelo": sim.modelo})
            arquivos.append({"arquivo": arq, "plano": plano, "imf": imf, "sha256": sha256_arquivo(saida / arq),
                             "targets": meta_targets})
            n_targets += len(meta_targets)
    manifest = {
        "esquema": "morphs/1.0",
        "malha_id": malha_id,
        "sha256_malha_base": sha256_arquivo(pasta / arquivo_glb),
        "versao_software": VERSAO_SOFTWARE,
        "versao_config_simulacao": str(config.get("versao", "?")),
        "nao_calibrado": True,
        "gerado_em": datetime.now(UTC).astimezone().isoformat(timespec="seconds"),
        "lados": lados,
        "arquivos": arquivos,
    }
    esquemas.validar("morphs_manifest", manifest)
    (saida / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest_interno = dict(manifest)
    manifest_interno["_duracao_s"] = round(time.perf_counter() - t0, 2)
    manifest_interno["_n_targets"] = n_targets
    manifest_interno["_bytes"] = {a["arquivo"]: (saida / a["arquivo"]).stat().st_size for a in arquivos}
    return manifest_interno
