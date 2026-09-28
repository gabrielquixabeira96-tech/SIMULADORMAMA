"""T10 — textura procedural "fotografica" de pele (contratos §4.5; ADR 0020).

As medidas sao feitas por codigo sobre os pixels e a superficie analitica: a areola e o mamilo sao
identificados pela crominancia log(G/R) em RGB linear (a luz assada e acromatica, entao a razao nao
depende do sombreamento) e cada texel classificado e levado a superficie por (s, y) -> torso.avaliar.
"""

from __future__ import annotations

import hashlib
import io
import re
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from mesh import esquemas
from mesh.malha.io import png_bytes
from mesh.simulacao.iluminacao import srgb_para_linear
from mesh.sintetico import textura_pele as tp
from mesh.sintetico.superficie import Torso
from mesh.sintetico.textura import textura_neutra

T01 = "t01_simetrico_300"
RAIZ_SINTETICO = Path(__file__).resolve().parents[1] / "mesh" / "sintetico"


def _torso(g: dict) -> Torso:
    """Torso com as amplitudes resolvidas pelo gerador (as mesmas que geraram a textura do preset)."""
    t = Torso(esquemas.completar_parametros(g["parametros"]))
    t.mama_dir.H, t.mama_esq.H = g["_amplitudes_mm"]["dir"], g["_amplitudes_mm"]["esq"]
    return t


def _sha(img: Image.Image) -> str:
    return hashlib.sha256(png_bytes(img)).hexdigest()


@pytest.fixture(scope="module")
def t01(torsos) -> Torso:
    return _torso(torsos[T01])


@pytest.fixture(scope="module")
def pixels_t01(dir_sinteticos) -> np.ndarray:
    with Image.open(dir_sinteticos / T01 / "textura.png") as im:
        return np.asarray(im.convert("RGB"))


# ----------------------------------------------------------------------------- gabarito / preset

@pytest.mark.parametrize("nome", ["t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose"])
def test_presets_fotograficos_com_bloco_textura(torsos, dir_sinteticos, nome):
    g = torsos[nome]
    esquemas.validar("gabarito", {k: v for k, v in g.items() if not k.startswith("_")})
    tex = g["textura"]
    assert g["parametros"]["textura"]["realismo"] == "fotografico" == tex["realismo"]
    assert (tex["esquema"], tex["origem"], tex["fototipo"], tex["r2"]) == (
        "iluminacao_sh9/1.0", "sintetico", "III", 1.0)
    assert (tex["areola_mm"], tex["mamilo_mm"], tex["px_por_mm"]) == (40.0, 10.0, 4.0)
    assert tex["sh9"] == [round(float(v), 6) for v in tp.sh9_gravada()]
    arq = dir_sinteticos / nome / "textura.png"
    assert tex["sha256"] == hashlib.sha256(arq.read_bytes()).hexdigest()
    with Image.open(arq) as im:
        W, H = im.size
        assert im.mode == "RGB"
    t = _torso(g)
    assert (W, H) == tp.dimensoes(t, 4.0) == (tex["largura_px"], tex["altura_px"])
    assert W <= 4096 and H <= 2048 and W % 4 == 0
    # 4 px/mm nas duas direcoes (isotropico), dentro do arredondamento para multiplo de 4
    assert W / t.secao.perimetro == pytest.approx(4.0, abs=4.0 / t.secao.perimetro)
    assert H / (t.y_topo - t.y_base) == pytest.approx(4.0, abs=0.5 / (t.y_topo - t.y_base))


def test_tempo_de_geracao_t01(torsos, t01, capsys):
    """Geracao <= 10 s no t01 (medida no gerador e numa chamada direta)."""
    t0 = time.perf_counter()
    tp.textura_pele(42, t01)
    direto = time.perf_counter() - t0
    with capsys.disabled():
        print(f"\n[T10] textura t01: gerador {torsos[T01]['_duracao_textura_s']:.2f} s, direta {direto:.2f} s")
    assert torsos[T01]["_duracao_textura_s"] <= 10.0
    assert direto <= 10.0


def test_determinismo_por_semente(torsos, t01, dir_sinteticos):
    a, _ = tp.textura_pele(42, t01)
    b, _ = tp.textura_pele(42, t01)
    c, _ = tp.textura_pele(43, t01)
    sha_a = _sha(a)
    assert sha_a == _sha(b) == torsos[T01]["textura"]["sha256"]  # 3 execucoes: 2 aqui + a do gerador
    assert sha_a == hashlib.sha256((dir_sinteticos / T01 / "textura.png").read_bytes()).hexdigest()
    assert _sha(c) != sha_a


def test_periodica_em_u(pixels_t01):
    """A primeira e a ultima coluna sao vizinhas na pele (costura nas costas): media |dif| <= 2/255."""
    arr = pixels_t01.astype(np.int16)
    dif_costura = float(np.abs(arr[:, 0] - arr[:, -1]).mean())
    dif_vizinhas = float(np.abs(arr[:, 1] - arr[:, 0]).mean())
    assert dif_costura <= 2.0, (dif_costura, dif_vizinhas)
    assert dif_costura <= dif_vizinhas + 0.5  # a costura nao se distingue de duas colunas quaisquer


# ----------------------------------------------------------------------------- areola e mamilo

def _medir(pixels: np.ndarray, torso: Torso, mama) -> dict:
    """Mede areola e mamilo nos pixels. Classificacao: log(G/R) abaixo do ponto medio entre as medianas
    da pele (anel de 28-34 mm) e da areola (8-14 mm) = pigmento de areola; abaixo do ponto medio entre
    areola e mamilo (< 2,5 mm) = mamilo. Cada texel vai a superficie por (s, y) -> torso.avaliar."""
    H, W = pixels.shape[:2]
    s, y = tp.coordenadas_texels(torso, W, H)
    sm, ym = mama.param_mamilo()
    p_n = torso.ponto(sm, ym)
    R = 36.0
    js = np.nonzero(np.abs(s - sm) <= R)[0]
    iy = np.nonzero(np.abs(y - ym) <= R)[0]
    S, Y = np.meshgrid(s[js], y[iy])
    P = torso.avaliar(S, Y)
    d = np.linalg.norm(P - p_n, axis=-1)                              # distancia 3D a ponta do mamilo
    ds, dy = float(s[1] - s[0]), float(y[0] - y[1])
    Ps = (torso.avaliar(S + ds / 2, Y) - torso.avaliar(S - ds / 2, Y)) / ds
    Py = (torso.avaliar(S, Y + dy / 2) - torso.avaliar(S, Y - dy / 2)) / dy
    area = np.linalg.norm(np.cross(Ps, Py), axis=-1) * ds * dy       # area de cada texel na pele (mm^2)
    rgb = srgb_para_linear(pixels[np.ix_(iy, js)] / 255.0)
    c = np.log(np.maximum(rgb[..., 1], 1e-5) / np.maximum(rgb[..., 0], 1e-5))
    c_pele = float(np.median(c[(d >= 28) & (d <= 34)]))
    c_areola = float(np.median(c[(d >= 8) & (d <= 14)]))
    c_mamilo = float(np.median(c[d <= 2.5]))
    limiar = 0.5 * (c_pele + c_areola)
    pigmento = (c < limiar) & (d <= 30)                               # pigmento de areola (inclui o mamilo)
    # 1) diametro equivalente pela area na pele
    diam_area = 2.0 * np.sqrt(area[pigmento].sum() / np.pi)
    # 2) paquimetro: borda a borda passando pelo mamilo, em 12 direcoes; a borda e onde log(G/R) cruza o
    #    limiar ao longo do raio (interpolacao bilinear nos texels), levada a superficie
    col0, lin0 = float(js[0]), float(iy[0])

    def c_em(ss, yy):
        cc, ll = tp.texel_de(torso, W, H, ss, yy)
        x, z = cc - col0, ll - lin0
        x0, z0 = np.floor(x).astype(int), np.floor(z).astype(int)
        fx, fz = x - x0, z - z0
        return ((c[z0, x0] * (1 - fx) + c[z0, x0 + 1] * fx) * (1 - fz)
                + (c[z0 + 1, x0] * (1 - fx) + c[z0 + 1, x0 + 1] * fx) * fz)

    t_raio = np.arange(12.0, 30.0, 0.05)
    cordas = []
    for ang in np.arange(12) * np.pi / 12:
        bordas = []
        for sinal in (1.0, -1.0):
            ss, yy = sm + sinal * t_raio * np.cos(ang), ym + sinal * t_raio * np.sin(ang)
            v = c_em(ss, yy)
            k = int(np.nonzero(v >= limiar)[0][0])
            f = (limiar - v[k - 1]) / (v[k] - v[k - 1])
            bordas.append(torso.ponto(ss[k - 1] + f * (ss[k] - ss[k - 1]), yy[k - 1] + f * (yy[k] - yy[k - 1])))
        cordas.append(float(np.linalg.norm(bordas[0] - bordas[1])))
    # 3) perfil radial: raio (distancia 3D a ponta) em que metade dos texels tem pigmento
    passos = np.arange(14.0, 26.0, 0.25)
    frac = np.array([pigmento[(d >= a) & (d < a + 0.25)].mean() for a in passos])
    i = int(np.nonzero(frac < 0.5)[0][0])
    r50 = passos[i - 1] + 0.125 + 0.25 * (frac[i - 1] - 0.5) / (frac[i - 1] - frac[i])
    mamilo = (c < 0.5 * (c_areola + c_mamilo)) & (d <= 12)
    w = area[mamilo]
    sc, yc = float((S[mamilo] * w).sum() / w.sum()), float((Y[mamilo] * w).sum() / w.sum())
    return {"diam_area": float(diam_area), "diam_paquimetro": float(np.mean(cordas)),
            "paquimetro_min_max": (min(cordas), max(cordas)), "diam_radial_ponta": float(2 * r50),
            "diam_mamilo": float(2.0 * np.sqrt(w.sum() / np.pi)),
            "erro_centro_mamilo": float(np.linalg.norm(torso.ponto(sc, yc) - p_n)),
            "c": (c_pele, c_areola, c_mamilo)}


@pytest.mark.parametrize("lado", ["dir", "esq"])
def test_areola_40mm_e_mamilo_no_ponto_geometrico(t01, pixels_t01, capsys, lado):
    mama = t01.mama_dir if lado == "dir" else t01.mama_esq
    m = _medir(pixels_t01, t01, mama)
    with capsys.disabled():
        print(f"\n[T10] t01 {lado}: areola O {m['diam_area']:.2f} mm (area na pele) / {m['diam_paquimetro']:.2f} mm "
              f"(paquimetro de borda a borda, {m['paquimetro_min_max'][0]:.2f}-{m['paquimetro_min_max'][1]:.2f}) / "
              f"{m['diam_radial_ponta']:.2f} mm (2 x raio 3D a ponta do mamilo); mamilo O {m['diam_mamilo']:.2f} mm, "
              f"centro a {m['erro_centro_mamilo']:.3f} mm do param_mamilo; log(G/R) pele/areola/mamilo = "
              f"{tuple(round(v, 3) for v in m['c'])}")
    assert m["c"][0] > m["c"][1] > m["c"][2]  # pele -> areola -> mamilo cada vez mais "vermelho-escuro"
    # criterio T10 (definicao do plano e do desenho): 2 x a distancia 3D do ponto do mamilo a borda
    # do pigmento, medida nos texels levados a superficie = 40 +- 1 mm
    assert abs(m["diam_radial_ponta"] - 40.0) <= 1.0
    assert abs(m["diam_mamilo"] - 10.0) <= 1.0
    assert m["erro_centro_mamilo"] <= 1.0
    # coerencia (nao e o criterio): na cupula curva do t01 (raio de curvatura de ~20-30 mm no apice) o
    # diametro equivalente pela area fica ~1 mm abaixo e a corda de borda a borda ~2-3 mm abaixo
    assert 38.5 <= m["diam_area"] <= 40.5
    assert 35.0 <= m["diam_paquimetro"] <= m["diam_area"]


# ----------------------------------------------------------------------------- geometria e variantes

def test_superficie_separavel_igual_a_avaliar(t01):
    W, H = tp.dimensoes(t01, 4.0)
    s, y = tp.coordenadas_texels(t01, W, H)
    P = tp.superficie_grade(t01, s, y)
    rng = np.random.default_rng(7)
    js, iy = rng.integers(0, W, 5000), rng.integers(0, H, 5000)
    assert np.abs(P[iy, js] - t01.avaliar(s[js], y[iy])).max() < 1e-6
    # inverso das coordenadas de texel
    col, lin = tp.texel_de(t01, W, H, s[js], y[iy])
    assert np.allclose(col, js) and np.allclose(lin, iy)


def test_esquematico_delega_a_textura_neutra(t01):
    img, bloco = tp.textura_pele(42, t01, realismo="esquematico")
    assert img.tobytes() == textura_neutra(42).tobytes()
    assert bloco["realismo"] == "esquematico" and bloco["origem"] == "sintetico"
    assert bloco["sh9"][1:] == [0.0] * 8  # luz uniforme: nada assado na textura neutra
    with pytest.raises(ValueError):
        tp.textura_pele(42, t01, realismo="foto")
    with pytest.raises(ValueError):
        tp.textura_pele(42, t01, fototipo="VII")


def test_fototipos_do_mais_claro_ao_mais_escuro(t01):
    """A pele frontal (sem mama) escurece de I a VI; a areola e sempre mais escura que a pele."""
    lums = []
    for f in tp.FOTOTIPOS:
        img, bloco = tp.textura_pele(5, t01, fototipo=f, px_por_mm=1.0)
        assert bloco["fototipo"] == f and img.size == tp.dimensoes(t01, 1.0)
        arr = srgb_para_linear(np.asarray(img) / 255.0) @ np.array([0.2126, 0.7152, 0.0722])
        W, H = img.size
        s, y = tp.coordenadas_texels(t01, W, H)
        faixa = arr[np.ix_(np.abs(y + 60) < 15, np.abs(s) < 40)]           # esterno alto, sem mama
        col, lin = tp.texel_de(t01, W, H, *t01.mama_dir.param_mamilo())
        areola = arr[int(round(lin)) - 8:int(round(lin)) + 9, int(round(col)) - 8:int(round(col)) + 9]
        assert np.median(areola) < 0.8 * np.median(faixa), f
        lums.append(float(np.median(faixa)))
    assert all(b < a for a, b in zip(lums, lums[1:], strict=False)), lums


def test_nenhuma_leitura_de_imagem_no_gerador_sintetico():
    """Equivalente a `git grep -n "Image.open\\|\\.jpg\\|\\.jpeg\\|imread" services/mesh/mesh/sintetico` vazio."""
    padrao = re.compile(r"Image\.open|\.jpg|\.jpeg|imread")
    achados = [f"{p.name}:{i}" for p in sorted(RAIZ_SINTETICO.glob("*.py"))
               for i, linha in enumerate(p.read_text(encoding="utf-8").splitlines(), 1) if padrao.search(linha)]
    assert achados == []


def test_parametros_sem_textura_continuam_esquematicos():
    p = dict(esquemas.presets_torso()[T01])
    p.pop("textura")
    q = esquemas.completar_parametros(p)
    assert q["textura"] == {"realismo": "esquematico", "fototipo": "III", "px_por_mm": 4.0, "areola_mm": 40.0,
                            "mamilo_mm": 10.0}
    esquemas.validar("torso_parametros", q)
    for ruim in ({"realismo": "foto"}, {"realismo": "fotografico", "fototipo": "VII"},
                 {"realismo": "fotografico", "px_por_mm": 20}, {"fototipo": "III"}):
        with pytest.raises(esquemas.ErroContrato):
            esquemas.validar("torso_parametros", {**q, "textura": ruim})


def test_png_sem_metadados_e_bytes_estaveis(dir_sinteticos):
    """O PNG da textura so tem pixels (nenhum texto/EXIF) — nada alem do que o codigo desenhou."""
    with Image.open(io.BytesIO((dir_sinteticos / T01 / "textura.png").read_bytes())) as im:
        assert im.format == "PNG" and not im.text and "exif" not in im.info
