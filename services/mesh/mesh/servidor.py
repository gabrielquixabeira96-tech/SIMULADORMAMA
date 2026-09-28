"""API HTTP do services/mesh (contratos §7). FastAPI em 127.0.0.1:8765, sem autenticacao (so loopback).

Uso: python -m mesh.servidor --host 127.0.0.1 --port 8765   (DATA_DIR no ambiente)

Flag DESENHO (ADR 0005, contratos §13): cabecalho `X-Desenho: A|B` obrigatorio em toda requisicao
(exceto GET /saude), gravado no log estruturado e ecoado na resposta. Enforcement em
profundidade: com `X-Desenho: A`, `POST /medir` (medicao automatica, geodesica e volume
calculado) responde 403 `desligado_no_desenho_a` — o web nunca deve chamar essa rota em A; se
chamar, fica registrado no log (com `incluir_volume`) e nada e calculado. `/morphs` (simulacao,
sempre "ilustracao") funciona nos dois desenhos.
"""

from __future__ import annotations

import argparse
import time
from typing import Annotated, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from mesh import log, servico
from mesh.versao import CONTRATO, VERSAO_SOFTWARE, versao_pygeodesic

HOSTS_LOCAIS = {"127.0.0.1", "localhost", "::1"}
ROTAS_SEM_DESENHO = {"/saude"}
ROTAS_DESLIGADAS_EM_A = {"/medir"}

Vetor3 = Annotated[list[float], Field(min_length=3, max_length=3)]


class Estrito(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Recorte(Estrito):
    modo: Literal["abaixo_do_pescoco", "caixa", "nenhum"] = "abaixo_do_pescoco"
    y_max_mm: float | None = None
    y_min_mm: float | None = None


class Decimacao(Estrito):
    alvo_vertices: int = Field(40000, ge=1000)
    min_vertices: int = Field(30000, ge=100)
    max_vertices: int = Field(50000, ge=100)


class ReqProcessar(Estrito):
    malha_dir: str
    arquivo_original: str
    unidade_origem: Literal["m", "cm", "mm", "desconhecida"] = "desconhecida"
    recorte: Recorte = Recorte()
    decimacao: Decimacao = Decimacao()
    malha_id: str | None = None


class Regua(Estrito):
    regua_mm: float = Field(gt=0)
    pontos: list[Vetor3] = Field(min_length=2, max_length=2)


class ReqReescalar(Estrito):
    malha_dir: str
    fator: float = Field(gt=0)
    regua: Regua | None = None


class Landmark(Estrito):
    posicao: Vetor3
    vertice: int = Field(ge=0)
    origem: Literal["clique", "gabarito", "automatico", "foto"] = "clique"


class ReqMedir(Estrito):
    malha_dir: str
    landmarks: dict[str, Landmark]
    distancias_euclidianas_web: dict[str, float | None] = {}
    incluir_geodesica: bool = True
    incluir_volume: bool = True


class PorLado(Estrito):
    dir: float = Field(ge=0)
    esq: float = Field(ge=0)


class ReqMorphs(Estrito):
    malha_dir: str
    landmarks: dict[str, Landmark]
    implantes: list[Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]] = Field(min_length=1)
    planos: list[Literal["subglandular", "dual_plane"]] = ["subglandular", "dual_plane"]
    imfs: list[Literal["manter", "rebaixar"]] = ["manter", "rebaixar"]
    lados: Literal["ambos", "separados"] = "separados"
    catalogo_arquivo: str | None = None
    pinca_polo_superior_mm: PorLado | None = None


Vista = Literal["frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq"]
Ponto2 = Annotated[list[float], Field(min_length=2, max_length=2)]


class FotoReconstrucao(Estrito):
    vista: Vista
    arquivo: str
    largura_px: int = Field(gt=0, le=12000)
    altura_px: int = Field(gt=0, le=12000)
    focal_35mm: float | None = Field(None, gt=0)
    landmarks_2d: dict[str, Ponto2] = {}
    mascara: str | None = None
    k1: float = 0.0


class EscalaReconstrucao(Estrito):
    metodo: Literal["ssn_n_fita", "regua_foto", "base_digitada"]
    valor_mm: float = Field(gt=0)
    lado: Literal["dir", "esq"] = "dir"
    pontos_px: list[Ponto2] | None = None


class OpcoesReconstrucao(Estrito):
    segmentacao: Literal["onnx", "template"] = "onnx"


class ReqReconstruirFoto(Estrito):
    malha_dir: str
    fotos: list[FotoReconstrucao] = Field(min_length=1, max_length=5)
    escala: EscalaReconstrucao | None = None
    opcoes: OpcoesReconstrucao = OpcoesReconstrucao()
    malha_id: str | None = None


class Par(BaseModel):
    model_config = ConfigDict(extra="allow")
    medida: str
    referencia_mm: float
    medido_mm: float
    torso: str | None = None
    operador: str | None = None


class ReqBlandAltman(Estrito):
    pares: list[Par] = Field(min_length=1)
    limite_mm: float = Field(2.0, gt=0)


def _erro(status: int, codigo: str, mensagem: str, detalhes: dict | None = None,
          desenho: str | None = None) -> JSONResponse:
    resp = JSONResponse(status_code=status,
                        content={"erro": {"codigo": codigo, "mensagem": mensagem, "detalhes": detalhes or {}}})
    if desenho:
        resp.headers["X-Desenho"] = desenho
    return resp


def criar_app() -> FastAPI:
    app = FastAPI(title="services/mesh — simulador de mamoplastia", version=VERSAO_SOFTWARE,
                  description=f"Contrato {CONTRATO}. Unidades: mm e mL. Ver docs/contratos.md §7.")

    @app.middleware("http")
    async def desenho_e_log(request: Request, call_next):
        t0 = time.perf_counter()
        rota = request.url.path
        desenho = request.headers.get("x-desenho")
        if rota not in ROTAS_SEM_DESENHO and rota not in {"/docs", "/openapi.json"}:
            if desenho is None:
                log.registrar("requisicao_recusada", rota=rota, codigo="desenho_ausente", status=400)
                return _erro(400, "desenho_ausente", "cabecalho X-Desenho (A|B) obrigatorio")
            if desenho not in ("A", "B"):
                log.registrar("requisicao_recusada", rota=rota, codigo="desenho_invalido", status=400)
                return _erro(400, "desenho_invalido", "X-Desenho deve ser A ou B")
            if desenho == "A" and rota in ROTAS_DESLIGADAS_EM_A:
                incluir_volume = None
                try:
                    corpo = await request.json()
                    incluir_volume = bool(corpo.get("incluir_volume", True)) if isinstance(corpo, dict) else None
                except Exception:  # noqa: BLE001
                    pass
                log.registrar("desligado_no_desenho_a", rota=rota, desenho="A", status=403,
                              incluir_volume=incluir_volume,
                              aviso="web chamou rota de medicao automatica em DESENHO=A")
                return _erro(403, "desligado_no_desenho_a",
                             "medicao automatica e volume calculado estao desligados no DESENHO=A", desenho="A")
        resposta = await call_next(request)
        if desenho:
            resposta.headers["X-Desenho"] = desenho
        log.registrar("requisicao", rota=rota, desenho=desenho, status=resposta.status_code,
                      duracao_ms=round((time.perf_counter() - t0) * 1000, 1))
        return resposta

    @app.exception_handler(servico.ErroServico)
    async def _h_servico(request: Request, exc: servico.ErroServico):
        return _erro(exc.status, exc.codigo, exc.mensagem, exc.detalhes, request.headers.get("x-desenho"))

    @app.exception_handler(RequestValidationError)
    async def _h_validacao(request: Request, exc: RequestValidationError):
        erros = exc.errors()
        if any(e.get("type") == "json_invalid" for e in erros):
            return _erro(400, "json_invalido", "corpo nao e JSON valido", desenho=request.headers.get("x-desenho"))
        detalhes = {"erros": [{"campo": "/".join(str(p) for p in e.get("loc", [])), "tipo": e.get("type"),
                               "mensagem": e.get("msg")} for e in erros][:20]}
        return _erro(422, "contrato_invalido", "requisicao fora do contrato", detalhes,
                     request.headers.get("x-desenho"))

    @app.exception_handler(Exception)
    async def _h_geral(request: Request, exc: Exception):
        log.registrar("erro_interno", rota=request.url.path, codigo=type(exc).__name__, status=500)
        return _erro(500, "erro_interno", "erro interno no services/mesh", desenho=request.headers.get("x-desenho"))

    @app.get("/saude")
    def saude():
        return {"status": "ok", "versao_software": VERSAO_SOFTWARE, "contrato": CONTRATO,
                "geodesica": {"biblioteca": "pygeodesic", "versao": versao_pygeodesic(), "algoritmo": "mmp"}}

    @app.post("/processar")
    async def processar(req: ReqProcessar):
        r = await run_in_threadpool(servico.processar, req.model_dump())
        log.registrar("processada", malha_id=r["malha_id"], n_vertices=r["processada"]["n_vertices"])
        return r

    @app.post("/reescalar")
    async def reescalar(req: ReqReescalar):
        r = await run_in_threadpool(servico.reescalar, req.model_dump())
        log.registrar("reescalada", malha_id=r["malha_id"], fator=req.fator)
        return r

    @app.post("/medir")
    async def medir(req: ReqMedir, request: Request):
        log.registrar("medir", desenho=request.headers.get("x-desenho"), incluir_volume=req.incluir_volume,
                      incluir_geodesica=req.incluir_geodesica, n=len(req.landmarks))
        return await run_in_threadpool(servico.medir, req.model_dump())

    @app.post("/torso-sintetico")
    async def torso_sintetico(request: Request):
        try:
            corpo = await request.json()
        except Exception:  # noqa: BLE001
            return _erro(400, "json_invalido", "corpo nao e JSON valido", desenho=request.headers.get("x-desenho"))
        if not isinstance(corpo, dict):
            return _erro(422, "contrato_invalido", "esperado objeto torso_parametros/1.0 + saida_dir")
        r = await run_in_threadpool(servico.torso_sintetico, corpo)
        log.registrar("torso_sintetico", torso=r["nome"], n_vertices=r["malha"]["decimada"]["n_vertices"])
        return r

    @app.post("/morphs")
    async def morphs(req: ReqMorphs, request: Request):
        # Em X-Desenho: A o manifest sai (e e gravado) com `previsto` null: numeros calculados
        # desligados (ADR 0005).
        r = await run_in_threadpool(servico.morphs, req.model_dump(), request.headers.get("x-desenho") or "B")
        log.registrar("morphs", malha_id=r["malha_id"], n=sum(len(a["targets"]) for a in r["arquivos"]))
        return r

    @app.post("/reconstruir-foto")
    async def reconstruir_foto(req: ReqReconstruirFoto, request: Request):
        # log sem caminhos de foto nem coordenadas (LGPD; log.py so aceita IDs, contagens e tempos)
        r = await run_in_threadpool(servico.reconstruir_foto, req.model_dump(), request.headers.get("x-desenho") or "B")
        rec = r["reconstrucao"]
        total = rec["diagnostico"].get("tempos_reconstrucao", {}).get("total_s") or 0.0
        log.registrar("reconstruir_foto", malha_id=rec["malha_id"], n=len(rec["fotos"]),
                      n_vertices=rec["malha"]["n_vertices"], duracao_ms=round(total * 1000))
        return r

    @app.post("/validar-bland-altman")
    async def validar_bland_altman(req: ReqBlandAltman):
        return servico.validar_bland_altman(req.model_dump())

    return app


app = criar_app()


def main(argv: list[str] | None = None) -> None:
    import uvicorn

    ap = argparse.ArgumentParser(description="services/mesh (FastAPI)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args(argv)
    if a.host not in HOSTS_LOCAIS:
        raise SystemExit("services/mesh so escuta em loopback nesta fase (ADR 0001); expor exige ADR novo")
    log.registrar("inicio", versao_software=VERSAO_SOFTWARE)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
