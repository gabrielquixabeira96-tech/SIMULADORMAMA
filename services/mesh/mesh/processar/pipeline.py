"""Pre-processamento de malha (contratos §7.2, ADR 0003): unidade, recorte abaixo do pescoco,
limpeza, decimacao por quadricas (fast-simplification, MIT) e transferencia de UV/cor.

Todas as operacoes geometricas usam a malha **soldada** (vertices fundidos por posicao); a malha
de saida (`MalhaRender`) pode duplicar vertices apenas em costuras de UV.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from mesh.malha.geometria import Proximidade, areas_faces, compactar, componentes, soldar
from mesh.malha.io import MalhaRender

FATORES_UNIDADE = {"m": 1000.0, "cm": 10.0, "mm": 1.0}


# ----------------------------------------------------------------------------- unidade

TAMANHO_TIPICO_MM = 500.0            # maior dimensao tipica de um torso recortado (ADR 0013)
FAIXA_PLAUSIVEL_MM = (150.0, 2500.0)  # fora disso a unidade inferida e marcada como duvidosa


def inferir_unidade(V: np.ndarray) -> str:
    """Unidade cuja conversao deixa a maior dimensao da caixa mais perto (em escala log) de 500 mm.

    Equivale a limiares em media geometrica: ext < 5 -> m; 5 <= ext < 158,1 -> cm; senao mm (ADR 0013).
    O criterio antigo (< 500 -> cm) chamava de cm um torso em mm com menos de 500 mm de altura.
    """
    ext = float((V.max(0) - V.min(0)).max())
    if ext <= 0:
        return "mm"
    return min(FATORES_UNIDADE, key=lambda u: abs(np.log(ext * FATORES_UNIDADE[u] / TAMANHO_TIPICO_MM)))


def unidade_duvidosa(V: np.ndarray, unidade: str) -> bool:
    ext_mm = float((V.max(0) - V.min(0)).max()) * FATORES_UNIDADE[unidade]
    return not (FAIXA_PLAUSIVEL_MM[0] <= ext_mm <= FAIXA_PLAUSIVEL_MM[1])


# ----------------------------------------------------------------------------- limpeza

def limpar(V: np.ndarray, F: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Remove faces degeneradas/duplicadas, mantem o maior componente conexo, compacta vertices."""
    avisos: list[str] = []
    F = np.asarray(F, dtype=np.int64)
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    ok &= areas_faces(V, F) > 1e-10
    F = F[ok]
    _, uniq = np.unique(np.sort(F, axis=1), axis=0, return_index=True)
    F = F[np.sort(uniq)]
    if len(F) == 0:
        raise ValueError("malha vazia apos limpeza")
    n, rot = componentes(F, len(V))
    if n > 1:
        cont = np.bincount(rot[F[:, 0]], minlength=n)
        maior = int(np.argmax(cont))
        descartadas = int(len(F) - cont[maior])
        F = F[rot[F[:, 0]] == maior]
        if descartadas:
            avisos.append(f"componentes_menores_removidos:{n - 1}")
    V2, F2, _ = compactar(V, F)[:3]
    return V2, F2, avisos


# ----------------------------------------------------------------------------- recorte

def detectar_corte_pescoco(V: np.ndarray, passo_mm: float = 5.0, abaixo_mm: float = 30.0) -> float | None:
    """Plano horizontal 3 cm abaixo do ponto mais estreito do pescoco (varredura de cima para baixo).

    Largura = extensao em X por faixa de Y. O pescoco e a faixa de largura minima acima da faixa mais
    larga (ombros/torax), e so e aceito se for < 60 % dela. Em plato (pescoco cilindrico) usa o
    centro do plato. Devolve y_corte (mm) ou None se nao houver pescoco reconhecivel.
    """
    y = V[:, 1]
    topo, base = float(y.max()), float(y.min())
    nb = int(np.ceil((topo - base) / passo_mm))
    if nb < 6:
        return None
    k = np.clip(((topo - y) / passo_mm).astype(int), 0, nb - 1)  # 0 = topo
    xmin = np.full(nb, np.inf)
    xmax = np.full(nb, -np.inf)
    np.minimum.at(xmin, k, V[:, 0])
    np.maximum.at(xmax, k, V[:, 0])
    cont = np.bincount(k, minlength=nb)
    w = np.where(cont >= 3, xmax - xmin, np.nan)
    # suavizacao leve (media movel de 3 faixas, ignorando vazios)
    wp = np.pad(w, 1, mode="edge")
    w = np.nanmean(np.stack([wp[:-2], wp[1:-1], wp[2:]]), axis=0)
    if np.all(np.isnan(w)):
        return None
    kmax = int(np.nanargmax(w))
    if kmax < 2:
        return None
    regiao = w[:kmax]
    kmin = int(np.nanargmin(regiao))
    if not (regiao[kmin] < 0.6 * w[kmax]):
        return None
    lim = 1.03 * regiao[kmin]
    a = kmin
    while a - 1 >= 0 and regiao[a - 1] <= lim:
        a -= 1
    b = kmin
    while b + 1 < kmax and regiao[b + 1] <= lim:
        b += 1
    centro = 0.5 * (a + b)
    y_pescoco = topo - (centro + 0.5) * passo_mm
    return float(y_pescoco - abaixo_mm)


def recortar_faces(V: np.ndarray, F: np.ndarray, y_min: float | None, y_max: float | None) -> np.ndarray:
    y = V[:, 1][F]
    ok = np.ones(len(F), dtype=bool)
    if y_max is not None:
        ok &= (y <= y_max).all(axis=1)
    if y_min is not None:
        ok &= (y >= y_min).all(axis=1)
    return F[ok]


# ----------------------------------------------------------------------------- decimacao

def decimar(V: np.ndarray, F: np.ndarray, alvo: int, vmin: int, vmax: int) -> tuple[np.ndarray, np.ndarray]:
    """Decimacao por quadricas (Garland–Heckbert; fast-simplification, MIT) ate `alvo` vertices."""
    import fast_simplification

    razao = len(F) / max(len(V), 1)
    alvo_faces = int(alvo * razao)
    melhor = None
    for _ in range(4):
        Vd, Fd = fast_simplification.simplify(np.ascontiguousarray(V, dtype=np.float64),
                                              np.ascontiguousarray(F, dtype=np.int32),
                                              target_count=max(alvo_faces, 4))
        Vd, Fd, _ = limpar(np.asarray(Vd, dtype=np.float64), np.asarray(Fd, dtype=np.int64))
        melhor = (Vd, Fd)
        n = len(Vd)
        if vmin <= n <= vmax and abs(n - alvo) <= 0.05 * alvo:
            break
        alvo_faces = int(alvo_faces * alvo / max(n, 1))
    return melhor


# ----------------------------------------------------------------------------- atributos

def _bary_extrapolada(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Coordenadas baricentricas (podem sair de [0,1]) da projecao de p no plano de (a,b,c)."""
    v0, v1, v2 = b - a, c - a, p - a
    d00 = np.einsum("ij,ij->i", v0, v0)
    d01 = np.einsum("ij,ij->i", v0, v1)
    d11 = np.einsum("ij,ij->i", v1, v1)
    d20 = np.einsum("ij,ij->i", v2, v0)
    d21 = np.einsum("ij,ij->i", v2, v1)
    den = d00 * d11 - d01 * d01
    den[den == 0] = 1e-30
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return np.stack([1 - v - w, v, w], axis=1)


def transferir_atributos(origem: MalhaRender, Vd: np.ndarray, Fd: np.ndarray) -> MalhaRender:
    """Leva UV (com tratamento de costura) ou cor por vertice da malha de origem para (Vd, Fd).

    UV por vertice = interpolacao baricentrica no ponto mais proximo da origem. Faces que cruzam uma
    costura de UV (os cantos caem em ilhas/lados diferentes do atlas) sao detectadas comparando com a
    UV extrapolada a partir da face de origem mais proxima do centroide; nelas os cantos recebem a UV
    extrapolada e os vertices sao duplicados (mesma posicao, UV diferente).
    """
    saida = MalhaRender(V=Vd.copy(), F=Fd.copy(), textura=origem.textura)
    if origem.uv is None and origem.cores is None:
        return saida
    prox = Proximidade(origem.V, origem.F)
    _, face_v, bary_v, _ = prox.consultar(Vd, k=6)
    tri_v = origem.F[face_v]
    if origem.cores is not None and origem.uv is None:
        cores = np.einsum("ij,ijk->ik", bary_v, origem.cores[tri_v].astype(np.float64))
        saida.cores = np.clip(np.round(cores), 0, 255).astype(np.uint8)
        return saida

    uv_r = origem.uv
    uv_v = np.einsum("ij,ijk->ik", bary_v, uv_r[tri_v])
    cent = Vd[Fd].mean(axis=1)
    _, face_c, _, _ = prox.consultar(cent, k=6)
    tri_c = origem.F[face_c]
    A, B, C = origem.V[tri_c[:, 0]], origem.V[tri_c[:, 1]], origem.V[tri_c[:, 2]]
    uv_e = np.zeros((len(Fd), 3, 2))
    for k in range(3):
        be = _bary_extrapolada(Vd[Fd[:, k]], A, B, C)
        uv_e[:, k, :] = np.einsum("ij,ijk->ik", be, uv_r[tri_c])
    uv_canto = uv_v[Fd]  # (m,3,2)
    dif = np.linalg.norm(uv_canto - uv_e, axis=2).max(axis=1)
    extensao = (uv_e.max(axis=1) - uv_e.min(axis=1)).max(axis=1)
    costura = dif > (3.0 * extensao + 1e-3)

    uv_final = uv_v.copy()
    V_out = [Vd]
    F_out = Fd.copy()
    if costura.any():
        fs = np.nonzero(costura)[0]
        novos: dict[tuple[int, int, int], int] = {}
        extras_v, extras_uv = [], []
        base = len(Vd)
        for f in fs:
            for k in range(3):
                v = int(Fd[f, k])
                uv = uv_e[f, k]
                if np.linalg.norm(uv - uv_v[v]) <= 1e-7:
                    continue
                chave = (v, int(round(uv[0] * 1e6)), int(round(uv[1] * 1e6)))
                idx = novos.get(chave)
                if idx is None:
                    idx = base + len(extras_v)
                    novos[chave] = idx
                    extras_v.append(Vd[v])
                    extras_uv.append(uv)
                F_out[f, k] = idx
        if extras_v:
            V_out.append(np.array(extras_v))
            uv_final = np.vstack([uv_final, np.array(extras_uv)])
    # um vertice cujos cantos foram todos trocados por duplicatas fica sem face: remove-o
    V2, F2, _, uv2 = compactar(np.vstack(V_out), F_out, uv_final)
    saida.V, saida.F, saida.uv = V2, F2, uv2
    return saida


# ----------------------------------------------------------------------------- orquestracao

@dataclass
class ResultadoProcessamento:
    malha: MalhaRender
    y_corte_mm: float | None
    recorte_aplicado: bool
    unidade_inferida: str | None
    fator_unidade: float
    avisos: list[str] = field(default_factory=list)


def processar_malha(original: MalhaRender, unidade_origem: str = "mm", recorte: dict | None = None,
                    decimacao: dict | None = None) -> ResultadoProcessamento:
    recorte = recorte or {"modo": "abaixo_do_pescoco"}
    decimacao = decimacao or {}
    alvo = int(decimacao.get("alvo_vertices", 40000))
    vmin = int(decimacao.get("min_vertices", 30000))
    vmax = int(decimacao.get("max_vertices", 50000))
    if not (vmin <= alvo <= vmax):
        raise ValueError("decimacao: exige min_vertices <= alvo_vertices <= max_vertices")
    avisos = list(original.avisos)

    unidade_inferida = None
    if unidade_origem == "desconhecida":
        unidade_inferida = inferir_unidade(original.V)
        fator = FATORES_UNIDADE[unidade_inferida]
        avisos.append(f"unidade_inferida:{unidade_inferida}")
        if unidade_duvidosa(original.V, unidade_inferida):
            avisos.append("unidade_inferida_duvidosa:calibrar_pela_regua")
    elif unidade_origem in FATORES_UNIDADE:
        fator = FATORES_UNIDADE[unidade_origem]
    else:
        raise ValueError(f"unidade_origem invalida: {unidade_origem}")
    origem = MalhaRender(V=original.V * fator, F=original.F, uv=original.uv, cores=original.cores,
                         textura=original.textura)

    Vw, Fw, _ = soldar(origem.V, origem.F)
    modo = recorte.get("modo", "abaixo_do_pescoco")
    y_corte = None
    aplicado = False
    if modo == "abaixo_do_pescoco":
        y_corte = detectar_corte_pescoco(Vw)
        if y_corte is None:
            avisos.append("pescoco_nao_detectado_sem_recorte")
        else:
            Fw = recortar_faces(Vw, Fw, None, y_corte)
            aplicado = True
    elif modo == "caixa":
        ymin, ymax = recorte.get("y_min_mm"), recorte.get("y_max_mm")
        if ymin is None and ymax is None:
            avisos.append("recorte_caixa_sem_limites")
        else:
            Fw = recortar_faces(Vw, Fw, ymin, ymax)
            aplicado = True
            y_corte = ymax
    elif modo != "nenhum":
        raise ValueError(f"modo de recorte invalido: {modo}")
    if len(Fw) == 0:
        raise ValueError("recorte removeu a malha inteira")

    Vc, Fc, av = limpar(Vw, Fw)
    avisos += av
    if len(Vc) > vmax:
        Vd, Fd = decimar(Vc, Fc, alvo, vmin, vmax)
    else:
        Vd, Fd = Vc, Fc
        if len(Vc) < vmin:
            avisos.append(f"abaixo_do_minimo_sem_decimacao:{len(Vc)}")
    malha = transferir_atributos(origem, Vd, Fd)
    n = malha.n_vertices
    if n > vmax and len(Vc) > vmax:
        avisos.append(f"acima_do_maximo_apos_costuras:{n}")
    return ResultadoProcessamento(malha=malha, y_corte_mm=y_corte, recorte_aplicado=aplicado,
                                  unidade_inferida=unidade_inferida, fator_unidade=fator, avisos=avisos)
