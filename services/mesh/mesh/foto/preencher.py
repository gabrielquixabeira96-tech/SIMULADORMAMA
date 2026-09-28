"""Preenchimento do que a foto nao viu + gravacao da textura reconstruida (plano foto3d, P2; C3).

O atlas projetado (`projetar.projetar_fotos`) so tem cor onde alguma foto viu a pele (`observado`).
O resto (flancos, costas, faixa abaixo do quadro, sob a prega quando oclusa) recebe a textura
procedural do ADR 0020 (`textura_pele(realismo="fotografico")`, a "textura provisoria" que o P1 gera
no fototipo estimado) com a cor **casada** com a pele observada vizinha, e fica marcado como nao
observado (`observado.png` = 0; o web hachura). Nada generativo: so re-amostragem da foto, filtros
lineares e a textura procedural por codigo.

Algoritmo (espaco log da luz linear, por canal; atlas H x W a `px_por_mm` texels/mm)
-----------------------------------------------------------------------------------
1. **Baixa frequencia observada `M`**: a cor projetada em log, com peso q = rampa(observado; 0,15 ->
   0,5), e reduzida a celulas de 1 mm (media ponderada), extrapolada para todo o atlas por push-pull
   (piramide de medias ponderadas, Gortler et al. 1996) e suavizada (gaussiana de 3 mm, periodica em
   u). Na borda do observado, M e a cor observada local; longe dela, a media observada mais proxima.
2. **Detalhe procedural `D`**: log da textura base menos a sua propria baixa frequencia (gaussiana de
   8 mm): poros, mosqueado fino e nevos, sem a luz assada da base nem o seu tom medio. A amplitude e
   casada com a do detalhe observado (razao dos desvios, por canal, limitada a [0,5; 1,5]).
3. **Areola**: se o mamilo de um lado foi observado (observado >= 0,5 no texel do mamilo), o disco da
   areola procedural daquele lado (raio areola/2 + 5 mm) e apagado de D — a areola real ja esta na
   foto e nao pode aparecer duas vezes. Se nao foi observado, a areola procedural e mantida inteira
   (contraste contra a pele da base) e vai para os avisos (`areola_procedural_<lado>`).
4. **Mistura**: `alfa = smoothstep(d / 10 mm) * rampa(observado)`, d = distancia (mm, no atlas) ao
   texel nao observado mais proximo; `cor = alfa * foto + (1 - alfa) * exp(M + D)` em luz linear.
   `alfa` e o que vai para `observado.png` (L 8 bits: fracao da cor que veio da foto; 0 = preenchido
   proceduralmente). `cobertura_observada_pct` = % dos texels do atlas com `observado >= 0,15`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

from mesh import esquemas
from mesh.foto.projetar import (
    LIMIAR_NAO_OBSERVADO,
    FotoRegistrada,
    MalhaUV,
    ProjecaoAtlas,
    malha_uv,
    projetar_fotos,
)
from mesh.malha.glb import escrever_glb
from mesh.malha.io import MalhaRender, png_bytes, sha256_arquivo
from mesh.simulacao.iluminacao import (
    ajustar_sh9,
    amostrar_textura,
    eixos_anatomicos,
    linear_para_srgb,
    srgb_para_linear,
)

ESQUEMA = "textura_reconstruida/1.0"
PX_POR_MM = 4.0
CELULA_MM = 1.0               # celula da baixa frequencia
SIGMA_M_MM = 3.0              # suavizacao da baixa frequencia observada
SIGMA_D_MM = 8.0              # corte do detalhe procedural
TRANSICAO_MM = 10.0           # rampa observado -> preenchido
Q_PLENO = 0.5                 # observado a partir do qual a foto vale inteira
MARGEM_AREOLA_MM = 5.0
AREOLA_MM = 40.0
RAZAO_DETALHE = (0.5, 1.5)
_EPS = 1e-4
_F32 = np.float32


def _rampa(x, a: float, b: float):
    t = np.clip((np.asarray(x, dtype=_F32) - _F32(a)) / _F32(b - a), 0.0, 1.0)
    return t * t * (_F32(3.0) - _F32(2.0) * t)


def _log_linear(rgb_srgb01: np.ndarray) -> np.ndarray:
    """sRGB 0..1 -> log(luz linear) em float32 (LUT de 4096 niveis: rapida e deterministica)."""
    lut = np.log(np.maximum(srgb_para_linear(np.linspace(0.0, 1.0, 4096)), _EPS)).astype(_F32)
    idx = np.clip(np.asarray(rgb_srgb01, dtype=_F32) * _F32(4095.0) + _F32(0.5), 0, 4095).astype(np.int32)
    return lut[idx]


def _srgb8_de_linear(lin: np.ndarray) -> np.ndarray:
    lut = np.round(linear_para_srgb(np.arange(65536) / 65535.0) * 255.0).astype(np.uint8)
    return lut[np.clip(lin * _F32(65535.0) + _F32(0.5), 0, 65535).astype(np.uint16)]


def _reduzir(x: np.ndarray, peso: np.ndarray, f: int) -> tuple[np.ndarray, np.ndarray]:
    """Media ponderada em blocos f x f (com preenchimento por zeros): (valor (h, w, C), peso medio (h, w))."""
    H, W = peso.shape
    h, w = -(-H // f), -(-W // f)
    pp = np.zeros((h * f, w * f), _F32)
    pp[:H, :W] = peso
    xx = np.zeros((h * f, w * f, x.shape[2]), _F32)
    xx[:H, :W] = x * peso[..., None]
    s = xx.reshape(h, f, w, f, -1).sum(axis=(1, 3))
    q = pp.reshape(h, f, w, f).sum(axis=(1, 3))
    val = np.where(q[..., None] > 0, s / np.maximum(q, 1e-12)[..., None], 0.0).astype(_F32)
    return val, (q / (f * f)).astype(_F32)


def _ampliar(x: np.ndarray, forma: tuple[int, int], f: float) -> np.ndarray:
    """Bilinear de uma grade de celulas f x f de volta para `forma` (H, W) (centros alinhados)."""
    H, W = forma
    yy = (np.arange(H) + 0.5) / f - 0.5
    xx = (np.arange(W) + 0.5) / f - 0.5
    h, w = x.shape[:2]
    y0 = np.clip(np.floor(yy).astype(np.int64), 0, h - 1)
    x0 = np.clip(np.floor(xx).astype(np.int64), 0, w - 1)
    y1, x1 = np.minimum(y0 + 1, h - 1), (x0 + 1) % w
    fy = np.clip(yy - np.floor(yy), 0, 1).astype(_F32)[:, None, None]
    fx = np.clip(xx - np.floor(xx), 0, 1).astype(_F32)[None, :, None]
    fy = np.where((yy < 0)[:, None, None] | (yy > h - 1)[:, None, None], _F32(0.0), fy)
    topo = x[y0][:, x0] * (1 - fx) + x[y0][:, x1] * fx
    base = x[y1][:, x0] * (1 - fx) + x[y1][:, x1] * fx
    return (topo * (1 - fy) + base * fy).astype(_F32)


def _push_pull(val: np.ndarray, peso: np.ndarray) -> np.ndarray:
    """Extrapola `val` (h, w, C) de onde `peso` > 0 para toda a grade (piramide de medias ponderadas)."""
    niveis = []
    v, p = val.astype(_F32), np.minimum(peso, 1.0).astype(_F32)
    while True:
        niveis.append((v, p))
        if min(v.shape[:2]) <= 1:
            break
        v, q = _reduzir(v, p, 2)
        p = np.minimum(q * 4.0, 1.0)  # soma dos pesos (saturada em 1): as celulas vazias herdam do nivel acima
    cor = np.where(niveis[-1][1][..., None] > 0, niveis[-1][0], 0.0).astype(_F32)
    if not np.any(niveis[-1][1] > 0):
        raise ValueError("nenhum texel observado para casar a cor")
    for v, p in reversed(niveis[:-1]):
        acima = _ampliar(cor, v.shape[:2], 2.0)
        cor = (p[..., None] * v + (1.0 - p[..., None]) * acima).astype(_F32)
    return cor


def _suavizar(x: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussiana por canal, periodica em u (eixo 1), borda replicada em v."""
    return np.stack([ndimage.gaussian_filter(x[..., k], sigma, mode=("nearest", "wrap"))
                     for k in range(x.shape[2])], axis=-1).astype(_F32)


def _passa_baixa(L: np.ndarray, peso: np.ndarray, f: int, sigma_celulas: float) -> np.ndarray:
    """Convolucao normalizada (peso) na grade reduzida, ampliada de volta: baixa frequencia de L."""
    v, q = _reduzir(L, peso, f)
    num = _suavizar(v * q[..., None], sigma_celulas)
    den = _suavizar(q[..., None], sigma_celulas)
    return _ampliar(num / np.maximum(den, 1e-6), L.shape[:2], f)


# ----------------------------------------------------------------------------- fototipo

def _lab(rgb01: np.ndarray) -> np.ndarray:
    """sRGB 0..1 (..., 3) -> CIE L*a*b* (D65)."""
    lin = srgb_para_linear(rgb01)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    return np.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])], -1)


def mediana_pele_observada(proj: ProjecaoAtlas, limiar: float = 0.9) -> np.ndarray | None:
    """Mediana sRGB (0..1) dos texels bem observados (observado >= `limiar`) — a "pele observada"."""
    sel = proj.observado >= limiar
    if sel.sum() < 100:
        return None
    return np.median(proj.cor[sel].reshape(-1, 3)[:: max(1, int(sel.sum()) // 200000)], axis=0)


def fototipo_estimado(proj: ProjecaoAtlas) -> str | None:
    """Fototipo (I-VI da tabela do ADR 0020) cuja pele e a mais proxima, em L*a*b*, da mediana da pele
    observada. Para a textura provisoria/base do P1 (`textura_pele(fototipo=...)`)."""
    from mesh.sintetico.textura_pele import FOTOTIPOS

    med = mediana_pele_observada(proj)
    if med is None:
        return None
    lab = _lab(med[None, :])[0]
    dist = {k: float(np.linalg.norm(_lab(np.array(v[0])[None, :] / 255.0)[0] - lab)) for k, v in FOTOTIPOS.items()}
    return min(dist, key=dist.get)


# ----------------------------------------------------------------------------- preenchimento

@dataclass
class TexturaReconstruida:
    textura: Image.Image           # RGB do atlas
    alfa: np.ndarray               # (H, W) float32: fracao da cor que veio da(s) foto(s) (observado.png)
    cobertura_observada_pct: float
    avisos: list[str] = field(default_factory=list)
    info: dict = field(default_factory=dict)

    def observado_png(self) -> Image.Image:
        return Image.fromarray(np.round(np.clip(self.alfa, 0, 1) * 255.0).astype(np.uint8), mode="L")


def _base_como_array(textura_base, W: int, H: int, avisos: list[str]) -> np.ndarray | None:
    if textura_base is None:
        avisos.append("preenchimento_sem_textura_base")
        return None
    img = textura_base if isinstance(textura_base, Image.Image) else Image.fromarray(np.asarray(textura_base))
    img = img.convert("RGB")
    if img.size != (W, H):
        avisos.append("textura_base_redimensionada")
        img = img.resize((W, H), Image.Resampling.BICUBIC)
    return np.asarray(img, dtype=_F32) / _F32(255.0)


def uv_dos_landmarks(malha, landmarks: dict) -> dict[str, tuple[float, float]]:
    """(u, v) do vertice mais proximo de cada landmark 3D (`{nome: {posicao: [x,y,z]}}` ou `{nome: xyz}`)."""
    m = malha if isinstance(malha, MalhaUV) else malha_uv(malha)
    arvore = cKDTree(m.V)
    saida = {}
    for nome, v in (landmarks or {}).items():
        pos = v.get("posicao") if isinstance(v, dict) else v
        if pos is None:
            continue
        _, i = arvore.query(np.asarray(pos, dtype=np.float64))
        saida[nome] = (float(m.uv[i, 0]), float(m.uv[i, 1]))
    return saida


def preencher(proj: ProjecaoAtlas, textura_base=None, px_por_mm: float = PX_POR_MM,
              mamilos_uv: dict[str, tuple[float, float]] | None = None,
              areola_mm: float = AREOLA_MM) -> TexturaReconstruida:
    """Completa o atlas projetado. `textura_base`: a textura procedural (PIL/array) no mesmo atlas —
    a provisoria do P1; sem ela, o nao observado recebe so a cor casada (aviso). `mamilos_uv`:
    `{"mamilo_dir": (u, v), "mamilo_esq": (u, v)}` (ver `uv_dos_landmarks`)."""
    t0 = time.perf_counter()
    H, W = proj.observado.shape
    avisos = list(proj.avisos)
    obs = proj.observado.astype(_F32)
    q = _rampa(obs, LIMIAR_NAO_OBSERVADO, Q_PLENO)
    if not np.any(q > 0):
        raise ValueError("nenhum texel observado: nada para casar a cor do preenchimento")
    f = max(1, int(round(CELULA_MM * px_por_mm)))
    L_obs = _log_linear(proj.cor)

    # 1. baixa frequencia observada, extrapolada (push-pull) e suavizada
    v, qc = _reduzir(L_obs, q, f)
    M = _ampliar(_suavizar(_push_pull(v, qc), SIGMA_M_MM / CELULA_MM), (H, W), f)

    # 2. detalhe procedural
    base = _base_como_array(textura_base, W, H, avisos)
    info: dict = {}
    if base is not None:
        Lb = _log_linear(base)
        D = Lb - _passa_baixa(Lb, np.ones((H, W), _F32), f, SIGMA_D_MM / CELULA_MM)
        plena = q >= 0.99
        if plena.sum() > 1000:
            hp_obs = L_obs - _passa_baixa(L_obs, q, f, SIGMA_D_MM / CELULA_MM)
            passo = max(1, int(plena.sum()) // 500000)
            dp_obs = hp_obs[plena][::passo].std(axis=0)
            dp_base = np.maximum(D[plena][::passo].std(axis=0), 1e-6)
            razao = np.clip(dp_obs / dp_base, *RAZAO_DETALHE).astype(_F32)
            del hp_obs
        else:
            razao = np.ones(3, _F32)
        info["razao_detalhe_rgb"] = [round(float(r), 3) for r in razao]
        D *= razao

        # 3. areola: apagada do detalhe onde o mamilo real foi visto; mantida (com contraste) se nao
        for nome, (u, vv) in sorted((mamilos_uv or {}).items()):
            if not nome.startswith("mamilo_"):
                continue
            lado = nome.split("_", 1)[1]
            cj, ci = u * W - 0.5, (1.0 - vv) * H - 0.5
            r = (areola_mm / 2.0 + MARGEM_AREOLA_MM) * px_por_mm
            i0, i1 = max(int(ci - r - 8), 0), min(int(ci + r + 8) + 1, H)
            jj = np.arange(int(cj - r - 8), int(cj + r + 8) + 1)
            ii = np.arange(i0, i1)
            dist = np.hypot(ii[:, None] - ci, jj[None, :] - cj)
            disco = (1.0 - _rampa(dist, r - 2 * px_por_mm, r + 2 * px_por_mm)).astype(_F32)
            jm = jj % W
            iv, jv = int(round(np.clip(ci, 0, H - 1))), int(round(cj)) % W
            if obs[iv, jv] >= Q_PLENO:
                D[i0:i1][:, jm] *= (1.0 - disco)[..., None]
                info[f"areola_{lado}"] = "observada"
            else:
                anel = (dist > r) & (dist < r + 10 * px_por_mm)
                pele = Lb[i0:i1][:, jm][anel].mean(axis=0) if anel.any() else Lb[i0:i1][:, jm].mean(axis=(0, 1))
                D[i0:i1][:, jm] = ((1.0 - disco)[..., None] * D[i0:i1][:, jm]
                                   + disco[..., None] * (Lb[i0:i1][:, jm] - pele))
                avisos.append(f"areola_procedural_{lado}")
                info[f"areola_{lado}"] = "procedural"
        del Lb
        preench = np.exp(M + D)
        del D
    else:
        preench = np.exp(M)
    del M

    # 4. mistura observado -> preenchido (rampa de 10 mm para dentro do observado)
    dist_mm = ndimage.distance_transform_edt(obs >= LIMIAR_NAO_OBSERVADO) / px_por_mm
    alfa = (_rampa(dist_mm, 0.0, TRANSICAO_MM) * q).astype(_F32)
    alfa[obs < LIMIAR_NAO_OBSERVADO] = 0.0
    del dist_mm
    lin = np.exp(L_obs)
    del L_obs
    lin *= alfa[..., None]
    lin += (1.0 - alfa)[..., None] * preench
    del preench
    rgb8 = _srgb8_de_linear(lin)
    cobertura = 100.0 * float(np.count_nonzero(obs >= LIMIAR_NAO_OBSERVADO)) / (W * H)
    info["duracao_s"] = round(time.perf_counter() - t0, 2)
    return TexturaReconstruida(textura=Image.fromarray(rgb8), alfa=alfa, cobertura_observada_pct=round(cobertura, 2),
                               avisos=avisos, info=info)


# ----------------------------------------------------------------------------- gravacao (para o P1)

def texturizar_malha(malha_dir: Path, malha: MalhaRender, fotos: list[FotoRegistrada], textura_base=None,
                     landmarks: dict | None = None, px_por_mm: float = PX_POR_MM,
                     tamanho_atlas: tuple[int, int] | None = None, arquivo_glb: str = "processada.glb",
                     quadro: str = "anatomico", extras_asset: dict | None = None, detalhes: bool = False):
    """Projeta -> preenche -> grava em `malha_dir`: `textura.png` (a mesma que `processada.obj/.mtl`
    referenciam), `observado.png` (L) e `arquivo_glb` com `asset.extras.reconstrucao`,
    `asset.extras.textura` e `asset.extras.iluminacao` (ajuste SH9 so nos vertices observados).
    Devolve o bloco `textura` (`textura_reconstruida/1.0`) para `meta.json` (o P1 grava o meta.json);
    com `detalhes=True`, `(bloco, ProjecaoAtlas, TexturaReconstruida)`. Nao cria nada fora de
    `malha_dir` e nao le imagem nenhuma (as fotos chegam decodificadas; ver `projetar.ler_foto`)."""
    t0 = time.perf_counter()
    malha_dir = Path(malha_dir)
    if tamanho_atlas is None:
        ref = textura_base if textura_base is not None else malha.textura
        if ref is None:
            raise ValueError("tamanho do atlas desconhecido: passe textura_base ou tamanho_atlas")
        tamanho_atlas = ref.size if isinstance(ref, Image.Image) else (ref.shape[1], ref.shape[0])
    m = malha_uv(malha)
    proj = projetar_fotos(m, fotos, tamanho_atlas)
    t_proj = time.perf_counter() - t0
    mamilos = {k: v for k, v in uv_dos_landmarks(m, landmarks or {}).items() if k.startswith("mamilo_")}
    rec = preencher(proj, textura_base, px_por_mm=px_por_mm, mamilos_uv=mamilos)

    png = png_bytes(rec.textura)
    (malha_dir / "textura.png").write_bytes(png)
    rec.observado_png().save(malha_dir / "observado.png", format="PNG", optimize=False)
    alfa_v = amostrar_textura(Image.fromarray(np.round(rec.alfa * 255).astype(np.uint8)).convert("RGB"), m.uv)[:, 0]
    iluminacao = ajustar_sh9(rec.textura, m.uv, m.N, mascara=alfa_v >= 0.5, eixos=eixos_anatomicos(landmarks))
    bloco_rec = {"fotos": len(fotos), "cobertura_observada_pct": rec.cobertura_observada_pct}
    bloco_tex = {"origem": "foto_projetada", "observado": "observado.png",
                 "cobertura_observada_pct": rec.cobertura_observada_pct,
                 "limiar_nao_observado": LIMIAR_NAO_OBSERVADO}
    render = MalhaRender(V=malha.V, F=malha.F, uv=m.uv, textura=rec.textura)
    extras = {**(extras_asset or {}), "reconstrucao": bloco_rec, "textura": bloco_tex, "iluminacao": iluminacao}
    escrever_glb(malha_dir / arquivo_glb, render, quadro=quadro, extras_asset=extras, imagem_png=png,
                 normais=m.N)
    bloco = {
        "esquema": ESQUEMA,
        **bloco_tex,
        "arquivo": "textura.png",
        "largura_px": int(tamanho_atlas[0]),
        "altura_px": int(tamanho_atlas[1]),
        "px_por_mm": float(px_por_mm),
        "fotos": [dict(f) for f in proj.por_foto],
        "sha256": sha256_arquivo(malha_dir / "textura.png"),
        "sha256_observado": sha256_arquivo(malha_dir / "observado.png"),
        "iluminacao": iluminacao,
        "avisos": rec.avisos,
        "duracao_s": {"projecao": round(t_proj, 2), "total": round(time.perf_counter() - t0, 2)},
    }
    esquemas.validar("textura_reconstruida", bloco)
    return (bloco, proj, rec) if detalhes else bloco
