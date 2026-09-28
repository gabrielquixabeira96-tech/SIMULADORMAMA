"""Orquestra a reconstrucao por fotos (POST /reconstruir-foto; contratos C1 e C4 do plano foto3d).

Entrada (relativa a `malha_dir`, dentro de DATA_DIR): 1-5 fotos ja recortadas no navegador (sem rosto,
sem EXIF), a frontal obrigatoria, cada uma com os landmarks 2D clicados e, opcionalmente, a mascara do
torso; e a referencia de escala. Passos:

1. valida (vistas, arquivos, dimensoes, landmarks, escala) e confere o rosto: a furcula clicada tem de
   estar a <= 12 % da altura a partir do topo nas fotos frontal/oblíquas; senao 422
   `rosto_possivelmente_visivel` e **as fotos da requisicao sao apagadas** (LGPD);
2. mascaras: a enviada (`mascara`) ou a segmentacao (`segmentar.py`; sem pesos: modo `template`);
3. ajuste (`ajuste.py`) -> parametros 1.1, poses (K, R, t por foto), residuos, incerteza por eixo;
4. malha do template (mesmo caminho do gerador: grade densa -> decimacao 30-50 mil vertices) com a
   textura **provisoria** `textura_pele(realismo="fotografico")` no fototipo mais proximo da pele
   observada na frontal — so a base do preenchimento;
5. textura (P2, C3): `projetar.fotos_do_registro` (as fotos da requisicao com as cameras recem-ajustadas)
   -> `preencher.texturizar_malha`: foto(s) projetada(s) no atlas UV + preenchimento com cor casada do
   que nenhuma foto viu; grava `textura.png`, `observado.png` e `processada.glb` (`asset.extras`
   `origem: "foto"`, `reconstrucao`, `textura`, `iluminacao`);
6. grava `processada.obj/.mtl`, `meta.json` (`malha_meta/1.0` com `origem: "foto"`, quadro anatomico e o
   bloco `textura` = `textura_reconstruida/1.0`), `reconstrucao.json` (`reconstrucao/1.0`;
   `cobertura_observada_pct` = a do atlas, C3), `fotos/registro.json` (so o bloco `fotos`) e
   `fotos/mascara_<vista>.png` (a mascara usada).

Sem perfil a profundidade e so ilustracao: `profundidade_confiavel: false`, piso de 12 mm (so a frontal)
ou 8 mm (com oblíqua) em `incerteza_por_eixo_mm.z`; o web nao mostra numeros de projecao (C1).
"""

from __future__ import annotations

import io
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from mesh import esquemas
from mesh.foto import ajuste as aj
from mesh.foto import camera as cam
from mesh.foto import escala as esc
from mesh.foto import raster, segmentar
from mesh.foto import template as tpl
from mesh.foto.preencher import texturizar_malha
from mesh.foto.projetar import Camera, FotoRegistrada, arquivo_de_foto_valido, fotos_do_registro
from mesh.malha.io import escrever_obj, sha256_arquivo
from mesh.medir import antropometria as antro
from mesh.versao import VERSAO_SOFTWARE

ESQUEMA = "reconstrucao/1.0"
VISTAS = ("frente", "obliqua_dir", "obliqua_esq", "perfil_dir", "perfil_esq")
VISTAS_COM_ROSTO = ("frente", "obliqua_dir", "obliqua_esq")
LIMITE_FURCULA_TOPO = 0.12
FOCAL_PADRAO_35MM = 26.0
LIMITE_REGISTRO_RUIM_PX = 12.0


class ErroReconstrucao(ValueError):
    def __init__(self, status: int, codigo: str, mensagem: str, detalhes: dict | None = None):
        super().__init__(f"{codigo}: {mensagem}")
        self.status, self.codigo, self.mensagem, self.detalhes = status, codigo, mensagem, detalhes or {}


def _agora() -> str:
    return datetime.now(UTC).astimezone().isoformat(timespec="seconds")


def _dentro(base: Path, rel: str) -> Path:
    from mesh import caminhos

    try:
        return caminhos.resolver(rel, base=base)
    except caminhos.CaminhoInvalido as e:
        raise ErroReconstrucao(400, "caminho_invalido", str(e)) from e


def _apagar_fotos(pasta: Path, fotos_req: list[dict]) -> list[str]:
    apagadas = []
    for f in fotos_req:
        try:
            p = _dentro(pasta, f["arquivo"])
        except ErroReconstrucao:
            continue
        if p.is_file():
            p.unlink()
            apagadas.append(f["arquivo"])
    return apagadas


def _validar(pasta: Path, req: dict) -> list[dict]:
    fotos_req = req.get("fotos") or []
    if not fotos_req:
        raise ErroReconstrucao(422, "landmarks_2d_incompletos", "nenhuma foto")
    vistas = [f.get("vista") for f in fotos_req]
    if len(set(vistas)) != len(vistas) or any(v not in VISTAS for v in vistas):
        raise ErroReconstrucao(422, "vista_invalida", "vistas repetidas ou desconhecidas", {"vistas": vistas})
    if "frente" not in vistas:
        raise ErroReconstrucao(422, "landmarks_2d_incompletos", "a foto frontal e obrigatoria")
    for f in fotos_req:
        desconhecidos = sorted(set(f.get("landmarks_2d") or {}) - set(tpl.LANDMARKS))
        if desconhecidos:
            raise ErroReconstrucao(422, "landmark_desconhecido", "landmark fora da tabela canonica",
                                   {"landmarks": desconhecidos})
    # rosto: a furcula clicada perto do topo (o recorte do navegador corta logo acima dela)
    suspeitas = []
    for f in fotos_req:
        fur = (f.get("landmarks_2d") or {}).get("furcula")
        if f["vista"] in VISTAS_COM_ROSTO and fur is not None and float(fur[1]) > LIMITE_FURCULA_TOPO * f["altura_px"]:
            suspeitas.append(f["vista"])
    if suspeitas:
        apagadas = _apagar_fotos(pasta, fotos_req)
        raise ErroReconstrucao(422, "rosto_possivelmente_visivel",
                               "a furcula esta a mais de 12 % da altura a partir do topo: o rosto pode estar na foto; "
                               "as fotos foram apagadas, recorte e envie de novo",
                               {"vistas": suspeitas, "apagadas": apagadas})
    return fotos_req


def _carregar_foto(pasta: Path, f: dict) -> tuple[np.ndarray, str]:
    p = _dentro(pasta, f["arquivo"])
    if not p.is_file():
        raise ErroReconstrucao(404, "arquivo_nao_encontrado", f"foto nao encontrada: {f['arquivo']}")
    try:
        with Image.open(p) as im:
            im.load()
            img = np.asarray(im.convert("RGB"))
    except Exception as e:  # noqa: BLE001
        raise ErroReconstrucao(400, "foto_ilegivel", f"foto ilegivel: {f['arquivo']}") from e
    if img.shape[1] != int(f["largura_px"]) or img.shape[0] != int(f["altura_px"]):
        raise ErroReconstrucao(422, "dimensoes_divergentes", f"{f['arquivo']}: {img.shape[1]}x{img.shape[0]} px "
                               f"!= {f['largura_px']}x{f['altura_px']} informados")
    return img, sha256_arquivo(p)


def _carregar_mascara(pasta: Path, rel: str, forma) -> np.ndarray:
    p = _dentro(pasta, rel)
    if not p.is_file():
        raise ErroReconstrucao(404, "arquivo_nao_encontrado", f"mascara nao encontrada: {rel}")
    m = np.asarray(Image.open(p).convert("L")) > 127
    if m.shape != forma:
        raise ErroReconstrucao(422, "dimensoes_divergentes", f"mascara {rel} com tamanho diferente da foto")
    if m.sum() < 0.01 * m.size:
        raise ErroReconstrucao(422, "foto_sem_torso", f"mascara {rel} quase vazia")
    return m


def projecao_template(theta, K, R, t, largura, altura) -> np.ndarray:
    """Mascara da projecao do template (malha grosseira, pintor) — guia da segmentacao sem pesos."""
    from mesh.sintetico.gerador import Grade

    torso = tpl.torso_rapido(tpl.parametros_de_vetor(theta))
    grade = Grade(torso, 20000)
    V = torso.avaliar(grade.S, grade.Y)
    S = raster.tela(V, K, R, t)
    return raster.pintor(S, grade.F, largura, altura) >= 0


def _fototipo(img: np.ndarray, mascara: np.ndarray) -> str:
    from scipy import ndimage

    from mesh.sintetico.textura_pele import FOTOTIPOS

    miolo = ndimage.binary_erosion(mascara, iterations=15)
    px = img[miolo] if miolo.sum() > 100 else img[mascara]
    med = np.median(px.astype(np.float64), axis=0)
    return min(FOTOTIPOS, key=lambda k: float(np.sum((np.array(FOTOTIPOS[k][0]) - med) ** 2)))


def _cobertura(malha, fotos: list[aj.FotoAjuste], poses) -> float:
    """% da area da malha vista (de frente, sem oclusao) em pelo menos uma foto (z-buffer a 1/4)."""
    from mesh.malha.geometria import areas_faces

    vista = np.zeros(malha.n_faces, bool)
    for f, (R, t) in zip(fotos, poses, strict=True):
        k = 0.25
        K = f.K.copy()
        K[:2] *= k
        w, h = max(1, int(f.largura * k)), max(1, int(f.altura * k))
        face = raster.zbuffer(raster.tela(malha.V, K, R, t), malha.F, w, h)
        vista[np.unique(face[face >= 0])] = True
    a = areas_faces(malha.V, malha.F)
    return float(a[vista].sum() / a.sum() * 100.0)


def _bloco_processada(pasta: Path, malha) -> dict:
    mn, mx = malha.caixa()
    return {"obj": "processada.obj", "glb": "processada.glb", "n_vertices": malha.n_vertices,
            "n_faces": malha.n_faces, "sha256_glb": sha256_arquivo(pasta / "processada.glb"),
            "caixa_mm": {"min": [round(v, 2) for v in mn], "max": [round(v, 2) for v in mx]}}


def reconstruir(pasta: Path, req: dict, malha_dir: str, malha_id: str) -> dict:
    """Executa a reconstrucao e devolve {"reconstrucao": reconstrucao/1.0, "meta": malha_meta/1.0}."""
    t_ini = time.perf_counter()
    tempos: dict[str, float] = {}
    fotos_req = _validar(pasta, req)
    opcoes = req.get("opcoes") or {}
    modo_seg = opcoes.get("segmentacao", "onnx")
    try:
        escala = esc.escala_de_requisicao(req.get("escala"))
    except esc.ErroEscala as e:
        raise ErroReconstrucao(422, e.codigo, e.mensagem) from e
    avisos: list[str] = []
    fotos: list[aj.FotoAjuste] = []
    imagens, shas, focos = [], [], []
    for f in fotos_req:
        img, sha = _carregar_foto(pasta, f)
        imagens.append(img)
        shas.append(sha)
        f35 = f.get("focal_35mm")
        if f35 is None:
            f35 = FOCAL_PADRAO_35MM
            avisos.append(f"focal_35mm_ausente:{f['vista']}:padrao_{FOCAL_PADRAO_35MM:g}mm")
            focos.append("estimado")
        else:
            focos.append("exif")
        try:
            K = cam.matriz_k(img.shape[1], img.shape[0], float(f35))
        except cam.ErroCamera as e:
            raise ErroReconstrucao(422, e.codigo, e.mensagem, {"vista": f["vista"]}) from e
        lm = {k: np.asarray(v, dtype=np.float64) for k, v in (f.get("landmarks_2d") or {}).items()}
        mascara = _carregar_mascara(pasta, f["mascara"], img.shape[:2]) if f.get("mascara") else None
        fotos.append(aj.FotoAjuste(vista=f["vista"], K=K, largura=img.shape[1], altura=img.shape[0],
                                   landmarks_2d=lm, mascara=mascara, k1=float(f.get("k1") or 0.0)))
    try:
        aj.validar_entrada(fotos)
        modos = {}
        if any(f.mascara is None for f in fotos):
            t0 = time.perf_counter()
            theta_p, poses_p = aj.preliminar(fotos, escala)
            for f, img, (R, t) in zip(fotos, imagens, poses_p, strict=True):
                if f.mascara is not None:
                    continue
                proj = projecao_template(theta_p, f.K, R, t, f.largura, f.altura)
                f.mascara, modos[f.vista], av = segmentar.segmentar(img, proj, modo_seg)
                if f.mascara.sum() < 0.01 * f.mascara.size:
                    raise ErroReconstrucao(422, "foto_sem_torso", f"torso nao encontrado na foto {f.vista}")
                avisos += [a for a in av if a not in avisos]
            tempos["segmentacao_s"] = round(time.perf_counter() - t0, 2)
        t0 = time.perf_counter()
        res = aj.ajustar(fotos, escala)
        tempos["ajuste_s"] = round(time.perf_counter() - t0, 2)
    except aj.ErroAjuste as e:
        raise ErroReconstrucao(422, e.codigo, e.mensagem) from e
    if res.reprojecao_rms_px > LIMITE_REGISTRO_RUIM_PX:
        raise ErroReconstrucao(422, "registro_ruim",
                               f"reprojecao rms {res.reprojecao_rms_px:.1f} px: confira os pontos",
                               {"rms_px": res.rms_px, "residuos_px": res.residuos_px})
    # rosto, segunda checagem: a furcula projetada pelo ajuste nas fotos frontal/oblíquas
    for f, (R, t) in zip(fotos, res.poses, strict=True):
        if f.vista in VISTAS_COM_ROSTO:
            v = cam.projetar(res.landmarks_3d["furcula"][None], f.K, R, t, f.k1)[0, 1]
            if v > LIMITE_FURCULA_TOPO * f.altura:
                apagadas = _apagar_fotos(pasta, fotos_req)
                raise ErroReconstrucao(422, "rosto_possivelmente_visivel",
                                       "a furcula ajustada esta a mais de 12 % da altura a partir do topo",
                                       {"vistas": [f.vista], "apagadas": apagadas})
    avisos += [a for a in res.avisos if a not in avisos]

    # malha + textura provisoria
    t0 = time.perf_counter()
    from mesh.sintetico.textura_pele import textura_pele

    p = res.parametros
    i_f = [f.vista for f in fotos].index("frente")
    fototipo = _fototipo(imagens[i_f], fotos[i_f].mascara)
    p["textura"] = {"realismo": "fotografico", "fototipo": fototipo}
    torso = tpl.torso_final(p)
    textura, bloco_tex = textura_pele(int(p.get("semente", 0)), torso, fototipo=fototipo, realismo="fotografico")
    malha, torso, _ = tpl.malha_do_template(p, textura=textura, torso=torso)
    tempos["malha_textura_s"] = round(time.perf_counter() - t0, 2)
    t0 = time.perf_counter()
    cobertura_area = _cobertura(malha, fotos, res.poses)
    tempos["cobertura_s"] = round(time.perf_counter() - t0, 2)

    # landmarks 3D (origem "foto") e o "gabarito estimado"
    arvore = cKDTree(malha.V)
    lm3 = {}
    for k in tpl.LANDMARKS:
        _, iv = arvore.query(res.landmarks_3d[k])
        lm3[k] = {"posicao": [round(float(c), 4) for c in res.landmarks_3d[k]], "vertice": int(iv), "origem": "foto"}
    eu = antro.euclidianas(res.landmarks_3d)
    bloco_esc = esc.bloco_escala(escala, res.landmarks_3d, res.poses[i_f], fotos[i_f].K)
    perfil = any(f.vista.startswith("perfil") for f in fotos)

    # arquivos: a malha (OBJ) e a textura provisoria; o P2 troca a textura pela foto projetada
    t0 = time.perf_counter()
    escrever_obj(pasta / "processada.obj", malha, "processada.mtl", "textura.png",
                 cabecalho="# malha do template ajustado a fotos — quadro anatomico (origem na furcula), mm\n")
    (pasta / "fotos").mkdir(exist_ok=True)
    fotos_json = []
    for f, fr, (R, t), resid, rms, fo, sha in zip(fotos, fotos_req, res.poses, res.residuos_px, res.rms_px, focos,
                                                  shas, strict=True):
        if fr.get("mascara"):
            arq_masc, modo = fr["mascara"], "fornecida"
        else:
            arq_masc, modo = f"fotos/mascara_{f.vista}.png", modos.get(f.vista, "template")
            buf = io.BytesIO()
            Image.fromarray((f.mascara * 255).astype(np.uint8), "L").save(buf, format="PNG")
            (pasta / arq_masc).write_bytes(buf.getvalue())
        fotos_json.append({
            "vista": f.vista, "arquivo": fr["arquivo"], "sha256": sha, "largura_px": f.largura, "altura_px": f.altura,
            "K": cam.coluna_major(f.K), "R": cam.coluna_major(R), "t": [float(v) for v in t], "k1": f.k1,
            "f_origem": fo, "focal_35mm": round(cam.focal_35mm_de_k(f.K, f.largura, f.altura), 4),
            "landmarks_2d": {k: [float(v[0]), float(v[1])] for k, v in f.landmarks_2d.items()},
            "residuos_px": resid, "rms_px": rms, "mascara": {"arquivo": arq_masc, "modo": modo},
        })
    # textura: a(s) foto(s) projetada(s) no atlas UV do template + preenchimento do nao observado (P2, C3).
    # As fotos sao as da requisicao, pelo registro recem-ajustado (C1); a textura provisoria e a base do
    # preenchimento. Grava textura.png, observado.png e processada.glb (extras reconstrucao/textura/iluminacao).
    t0 = time.perf_counter()
    mascaras = {f.vista: f.mascara for f in fotos}
    if all(arquivo_de_foto_valido(fr["arquivo"]) for fr in fotos_req):
        registradas = fotos_do_registro(pasta, fotos_json, mascaras)
    else:  # caminho fora do layout C4 (so testes antigos): as imagens ja decodificadas acima
        registradas = [FotoRegistrada(imagem=img, camera=Camera.de_contrato(fj), mascara=mascaras[fj["vista"]],
                                      vista=fj["vista"]) for img, fj in zip(imagens, fotos_json, strict=True)]
    bloco_textura = texturizar_malha(
        pasta, malha, registradas, textura_base=textura, landmarks=lm3,
        extras_asset={"origem": "foto", "textura_provisoria": {"origem": "procedural_fototipo", "fototipo": fototipo}})
    cobertura = float(bloco_textura["cobertura_observada_pct"])
    avisos += [a for a in bloco_textura["avisos"] if a not in avisos]
    tempos["textura_s"] = round(time.perf_counter() - t0, 2)
    t0 = time.perf_counter()

    rec = {
        "esquema": ESQUEMA,
        "malha_id": malha_id,
        "malha_dir": malha_dir,
        "quadro": "anatomico",
        "unidade": "mm",
        "convencao_camera": "opencv",
        "fotos": fotos_json,
        "parametros": p,
        "escala": bloco_esc,
        "landmarks": lm3,
        "estimado": {
            "distancias": {k: {"euclidiana_mm": None if v is None else round(v, 2)} for k, v in eu.items()},
            "volumes": {lado: {"adicionado_ml": round(float(p["volume_ml"][lado]), 1)} for lado in ("dir", "esq")},
        },
        "reprojecao_rms_px": res.reprojecao_rms_px,
        "residuo_silhueta_mm": res.residuo_silhueta_mm,
        "forma_fora_do_modelo": res.forma_fora_do_modelo,
        "incerteza_por_eixo_mm": res.incerteza_por_eixo_mm,
        "incerteza_volume_pct": res.incerteza_volume_pct,
        "profundidade_confiavel": perfil,
        "qualidade": res.qualidade,
        "avisos": avisos,
        "cobertura_observada_pct": round(cobertura, 1),
        "malha": {"obj": "processada.obj", "glb": "processada.glb", "textura": "textura.png",
                  "textura_provisoria": False, "observado": bloco_textura["observado"],
                  "n_vertices": malha.n_vertices, "n_faces": malha.n_faces},
        "diagnostico": {**res.diagnostico, "incerteza_ajuste_mm": res.incerteza_ajuste_mm,
                        "cobertura_area_vista_pct": round(cobertura_area, 1),
                        "fracao_silhueta_fora": res.fracao_silhueta_fora, "textura": {k: v for k, v in bloco_tex.items()
                                                                                    if k in ("fototipo", "realismo")}},
        "versao_software": VERSAO_SOFTWARE,
        "gerado_em": _agora(),
    }
    meta = {
        "esquema": "malha_meta/1.0",
        "malha_id": malha_id,
        "malha_dir": malha_dir,
        "origem": "foto",
        "unidade_origem": "mm",
        "unidade_inferida": "mm",
        "fator_unidade": 1.0,
        "fator_escala_acumulado": 1.0,
        "quadro": "anatomico",
        "original": {"arquivo": fotos_req[i_f]["arquivo"], "n_vertices": malha.n_vertices, "n_faces": malha.n_faces,
                     "sha256": shas[i_f], "tem_textura": True},
        "processada": _bloco_processada(pasta, malha),
        "recorte": {"modo": "nenhum", "y_corte_mm": None, "aplicado": False},
        "escala": {"historico": []},
        "textura": bloco_textura,
        "avisos": avisos,
        "versao_software": VERSAO_SOFTWARE,
        "gerado_em": rec["gerado_em"],
    }
    tempos["arquivos_s"] = round(time.perf_counter() - t0, 2)
    tempos["total_s"] = round(time.perf_counter() - t_ini, 2)
    rec["diagnostico"]["tempos_reconstrucao"] = tempos
    esquemas.validar("reconstrucao", rec)
    esquemas.validar("malha_meta", meta)
    (pasta / "fotos" / "registro.json").write_text(json.dumps({"esquema": ESQUEMA + "#fotos", "malha_id": malha_id,
                                                              "fotos": fotos_json}, ensure_ascii=False, indent=2)
                                                  + "\n", encoding="utf-8")
    (pasta / "reconstrucao.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (pasta / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"reconstrucao": rec, "meta": meta}
