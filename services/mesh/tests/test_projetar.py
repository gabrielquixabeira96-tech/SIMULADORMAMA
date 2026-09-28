"""P2 (plano foto3d): projecao da foto no atlas UV — camera C1, z-buffer, ida e volta, cobertura,
oclusao, fusao de fotos e leitura de imagem so pelo caminho de entrada.

As "fotos" sao renders do torso sintetico t01 (substituto do template do P1, mesma UV do gerador)
pelo oraculo independente de `tests/foto_render.py`; nada e gravado fora de tmp nem versionado."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from scipy import ndimage

from mesh.foto.projetar import (
    LIMIAR_NAO_OBSERVADO,
    TAN_MAX,
    VIES_MM,
    Camera,
    FotoRegistrada,
    MalhaUV,
    fotos_do_registro,
    ler_foto,
    mapa_profundidade,
    projetar_fotos,
    texels_na_superficie,
)
from mesh.malha.geometria import normais_vertices
from tests.foto_render import amostrar_atlas, camera_clinica, renderizar, ssim

RAIZ_MESH = Path(__file__).resolve().parents[1] / "mesh"


# ----------------------------------------------------------------------------- camera (C1)

def test_camera_contrato_coluna_major_e_ida_e_volta():
    K = np.array([[1000.0, 0, 320], [0, 1000.0, 240], [0, 0, 1]])
    R = np.diag([1.0, -1.0, -1.0])  # camera em +Z olhando para -Z (frente da paciente)
    t = -R @ np.array([0.0, 0.0, 1000.0])
    d = {"K": list(K.reshape(-1, order="F")), "R": list(R.reshape(-1, order="F")), "t": list(t),
         "largura_px": 640, "altura_px": 480}
    assert d["K"][6:8] == [320.0, 240.0]  # coluna-major: o ponto principal vem na 3a coluna
    cam = Camera.de_contrato(d)
    np.testing.assert_allclose(cam.K, K)
    np.testing.assert_allclose(cam.centro, [0, 0, 1000.0])
    uv, z = cam.projetar(np.array([[0.0, 0.0, 0.0], [10.0, 20.0, 0.0]]))
    np.testing.assert_allclose(z, [1000.0, 1000.0])
    # +X (esquerda da paciente) aparece a direita da imagem; +Y (cranial) para cima
    np.testing.assert_allclose(uv, [[320.0, 240.0], [330.0, 220.0]])
    cam2 = Camera.de_contrato(cam.para_contrato())
    np.testing.assert_allclose(cam2.K, cam.K)
    np.testing.assert_allclose(cam2.R, cam.R)
    np.testing.assert_allclose(cam2.t, cam.t)
    with pytest.raises(ValueError):
        Camera.de_contrato({**d, "R": list(np.diag([1.0, 1.0, -1.0]).reshape(-1))})


def test_zbuffer_igual_ao_oraculo(cena_t01):
    """O z-buffer vetorizado do projetar = o do oraculo por face (mesma cobertura e profundidade)."""
    z = mapa_profundidade(cena_t01["mu"], cena_t01["cam"])
    z_ref = cena_t01["raster"][2]
    fin = np.isfinite(z) & np.isfinite(z_ref)
    assert np.count_nonzero(np.isfinite(z) != np.isfinite(z_ref)) <= 0.001 * fin.sum()
    assert np.abs(z[fin] - z_ref[fin]).max() < 1e-6


# ----------------------------------------------------------------------------- ida e volta

def test_ida_e_volta_ssim_na_regiao_observada(cena_t01, reconstrucao_t01):
    """Foto frontal -> textura projetada (+ preenchimento) -> re-render pela mesma camera -> SSIM."""
    c, rec = cena_t01, reconstrucao_t01["rec"]
    tex = np.asarray(rec.textura, dtype=np.float64)
    img2, _, _ = renderizar(c["malha"].V, c["malha"].F, c["malha"].uv, tex, c["cam"], raster=c["raster"])
    msk, uvp = c["mascara"], c["uv_px"]
    alfa = np.zeros(msk.shape)
    alfa[msk] = amostrar_atlas(rec.alfa[..., None].astype(np.float64), uvp[msk])[:, 0]
    foto = c["foto"].astype(np.float64)
    obs = ndimage.binary_erosion(msk & (alfa > 0), iterations=3)          # tudo que a foto cobriu
    plena = ndimage.binary_erosion(msk & (alfa >= 0.999), iterations=3)   # foto pura
    s_obs, s_plena = ssim(foto, img2, obs), ssim(foto, img2, plena)
    erro = float(np.abs(foto - img2)[obs].mean())
    print(f"SSIM observado={s_obs:.4f} pleno={s_plena:.4f} erro_medio={erro:.2f}/255 px={obs.sum()}")
    assert s_obs >= 0.92
    assert s_plena >= 0.95
    assert erro <= 6.0


def test_cobertura_frontal_entre_35_e_50(reconstrucao_t01):
    pct = reconstrucao_t01["bloco"]["cobertura_observada_pct"]
    print(f"cobertura frontal t01 = {pct} %")
    assert 35.0 <= pct <= 50.0
    assert pct == reconstrucao_t01["proj"].cobertura_observada_pct


# ----------------------------------------------------------------------------- oclusao

def _oraculo_visivel(P, N, cam, z_ref):
    uv, z = cam.projetar(P)
    j = np.clip(np.floor(uv[:, 0]).astype(int), 0, cam.largura_px - 1)
    i = np.clip(np.floor(uv[:, 1]).astype(int), 0, cam.altura_px - 1)
    vdir = cam.centro - P
    vdir /= np.linalg.norm(vdir, axis=1, keepdims=True)
    c = np.clip(np.einsum("kc,kc->k", N, vdir), 1e-6, 1.0)
    tan = np.minimum(np.sqrt(1 - c * c) / c, TAN_MAX)
    return z <= z_ref[i, j] + VIES_MM + cam.mm_por_px(z) * tan, c


def test_nenhum_texel_observado_esta_ocluso(cena_t01, reconstrucao_t01):
    """Contra o z-buffer do oraculo: 0 texels com observado > 0 atras de outra superficie; e a oclusao
    existe de fato (a parede lateral atras das mamas, vista de frente, fica de fora)."""
    c, proj = cena_t01, reconstrucao_t01["proj"]
    W, H = proj.tamanho
    pix, P, N = texels_na_superficie(c["mu"], W, H)
    vis, cos = _oraculo_visivel(P, N, c["cam"], c["raster"][2])
    obs = proj.observado.reshape(-1)[pix]
    violacoes = int(np.count_nonzero((obs > 0) & ~vis))
    oclusos_de_frente = int(np.count_nonzero(~vis & (cos > 0.2)))
    print(f"violacoes={violacoes} texels_oclusos_de_frente={oclusos_de_frente}")
    assert violacoes == 0
    assert oclusos_de_frente > 10000
    assert np.all(obs[~vis & (cos > 0.2)] == 0)


def _placa(x0, x1, y0, y1, z, u0, u1, n=12):
    xs, ys = np.linspace(x0, x1, n), np.linspace(y0, y1, n)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    V = np.stack([X.ravel(), Y.ravel(), np.full(X.size, z)], 1)
    uv = np.stack([u0 + (X.ravel() - x0) / (x1 - x0) * (u1 - u0), (Y.ravel() - y0) / (y1 - y0)], 1)
    idx = np.arange(n * n).reshape(n, n)
    a, b, cc, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    F = np.concatenate([np.stack([a, b, cc], -1).reshape(-1, 3), np.stack([a, cc, d], -1).reshape(-1, 3)])
    return V, F, uv


def test_oclusor_explicito_nao_recebe_cor_do_que_esta_atras():
    """Placa pequena (verde) 50 mm a frente de uma grande (vermelha): a regiao da grande escondida pela
    pequena fica com observado = 0; o resto recebe a cor certa."""
    Vb, Fb, uvb = _placa(-100, 100, -100, 100, 0.0, 0.0, 0.5)
    Vf, Ff, uvf = _placa(-30, 30, -30, 30, 50.0, 0.5, 1.0)
    V = np.concatenate([Vb, Vf])
    F = np.concatenate([Fb, Ff + len(Vb)])
    uv = np.concatenate([uvb, uvf])
    m = MalhaUV(V=V, F=F, uv=uv, N=normais_vertices(V, F))
    R = np.diag([1.0, -1.0, -1.0])
    cam = Camera(K=np.array([[2000.0, 0, 300], [0, 2000.0, 300], [0, 0, 1]]), R=R,
                 t=-R @ np.array([0.0, 0.0, 1000.0]), largura_px=600, altura_px=600)
    atlas = np.zeros((100, 200, 3))
    atlas[:, :100] = [0.8, 0.1, 0.1]
    atlas[:, 100:] = [0.1, 0.8, 0.1]
    img, msk, _ = renderizar(V, F, uv, atlas, cam)
    foto = np.round(img * 255).astype(np.uint8)
    proj = projetar_fotos(m, [FotoRegistrada(foto, cam, None)], (200, 100))
    obs, cor = proj.observado, proj.cor
    # texels da placa de tras: u in [0, 0.5) -> colunas 0..99; x = -100 + (j + 0,5)/100 * 200
    j = np.arange(100)
    x = -100 + (j + 0.5) / 100 * 200
    i = np.arange(100)
    y = -100 + (1 - (i + 0.5) / 100) * 200
    X, Y = np.meshgrid(x, y)
    sombra = 30.0 * 1000.0 / 950.0      # a placa da frente projetada no plano z = 0
    atras = (np.abs(X) < sombra - 1.5) & (np.abs(Y) < sombra - 1.5)
    livre = ((np.abs(X) > sombra + 3) | (np.abs(Y) > sombra + 3)) & (np.abs(X) < 85) & (np.abs(Y) < 85)
    assert atras.sum() > 500 and livre.sum() > 2000
    assert np.all(obs[:, :100][atras] == 0)
    assert np.all(obs[:, :100][livre] > 0.99)
    assert np.abs(cor[:, :100][livre] - [0.8, 0.1, 0.1]).max() < 0.01
    assert np.all(obs[5:95, 105:195] > 0.99)                   # a placa da frente, inteira
    assert np.abs(cor[5:95, 105:195].reshape(-1, 3) - [0.1, 0.8, 0.1]).max() < 0.01
    assert proj.por_foto[0]["texels_oclusos"] > 0
    # a mesma cena como trimesh.Trimesh com UV (a forma que o template do P1 pode entregar)
    import trimesh

    tm = trimesh.Trimesh(V, F, process=False, visual=trimesh.visual.TextureVisuals(uv=uv))
    proj_tm = projetar_fotos(tm, [FotoRegistrada(foto, cam, None)], (200, 100))
    assert np.array_equal(proj_tm.observado, obs) and np.array_equal(proj_tm.cor, cor)


# ----------------------------------------------------------------------------- varias fotos

def test_fusao_de_duas_fotos_equaliza_ganho(cena_t01):
    """Frente + perfil D; o perfil com exposicao 0,8x: os 3 ganhos RGB do perfil voltam a ~1,25 e a
    cobertura sobe (o flanco direito passa a ser observado)."""
    c = cena_t01
    m = c["malha"]
    fotos = []
    for vista, ganho in (("frente", 1.0), ("perfil_dir", 0.8)):
        cam = camera_clinica(c["gab"]["landmarks"], vista, 800)
        img, msk, _ = renderizar(m.V, m.F, m.uv, c["atlas"], cam)
        lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4) * ganho
        srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        fotos.append(FotoRegistrada(np.round(np.clip(srgb, 0, 1) * 255).astype(np.uint8), cam, msk, vista))
    W, H = m.textura.size
    so_frente = projetar_fotos(c["mu"], fotos[:1], (W, H))
    duas = projetar_fotos(c["mu"], fotos, (W, H))
    g = duas.por_foto[1]["ganhos_rgb"]
    print(f"ganhos perfil={g} cobertura frente={so_frente.cobertura_observada_pct} duas={duas.cobertura_observada_pct}")
    np.testing.assert_allclose(g, 1.25, atol=0.03)
    assert duas.cobertura_observada_pct > so_frente.cobertura_observada_pct + 5
    # onde as duas fotos se sobrepoem, a cor fundida bate com a verdade (a exposicao foi corrigida)
    ambos = (so_frente.observado > 0.5) & (duas.observado > so_frente.observado + 0.2)
    verdade = c["atlas"][ambos]
    assert ambos.sum() > 1000
    assert np.abs(duas.cor[ambos] - verdade).mean() * 255 < 6


# ----------------------------------------------------------------------------- LGPD / leitura

def test_ler_foto_so_de_original_foto_da_propria_malha(tmp_path):
    (tmp_path / "original").mkdir()
    Image.fromarray(np.full((8, 8, 3), 128, np.uint8)).save(tmp_path / "original" / "foto_frente.jpg")
    Image.fromarray(np.full((8, 8, 3), 128, np.uint8)).save(tmp_path / "textura.png")
    assert ler_foto(tmp_path, "original/foto_frente.jpg").size == (8, 8)
    for ruim in ("textura.png", "original/foto_frente.png", "original/../textura.png", "/etc/foto_frente.jpg",
                 "original/foto_costas.jpg", "../original/foto_frente.jpg"):
        with pytest.raises(ValueError):
            ler_foto(tmp_path, ruim)


def test_fotos_do_registro_c1(tmp_path):
    (tmp_path / "original").mkdir()
    Image.fromarray(np.full((48, 64, 3), 90, np.uint8)).save(tmp_path / "original" / "foto_frente.jpg")
    R = np.diag([1.0, -1.0, -1.0])
    cam = Camera(K=np.array([[100.0, 0, 32], [0, 100.0, 24], [0, 0, 1]]), R=R, t=np.array([0, 0, 1000.0]),
                 largura_px=64, altura_px=48)
    c1 = [{"vista": "frente", "arquivo": "original/foto_frente.jpg", **cam.para_contrato()}]
    msk = np.ones((48, 64), bool)
    (f,) = fotos_do_registro(tmp_path, c1, {"frente": msk})
    assert f.vista == "frente" and f.mascara is msk and f.rgb().shape == (48, 64, 3)
    np.testing.assert_allclose(f.camera.K, cam.K)
    with pytest.raises(ValueError):
        fotos_do_registro(tmp_path, [{**c1[0], "arquivo": "textura.png"}])


# Leitores/escritores de imagem permitidos em mesh/foto, por funcao (depois da integracao P1 + P2):
# - P2 (projetar/preencher): so `projetar.ler_foto` (original/foto_<vista>.jpg da malha; criterio 6 do P2);
# - P1: `reconstruir._carregar_foto`/`_carregar_mascara` (caminhos da requisicao resolvidos dentro de
#   malha_dir por `caminhos.resolver`) e `sintetica.foto_sintetica` (a textura do torso SINTETICO e as fotos
#   sinteticas que ele grava em fotos/).
LEITORES_PERMITIDOS = {
    ("projetar.py", "ler_foto"),
    ("reconstruir.py", "_carregar_foto"),
    ("reconstruir.py", "_carregar_mascara"),
    ("sintetica.py", "foto_sintetica"),
}


def test_image_open_so_no_caminho_de_entrada():
    """`git grep Image.open|imread|.jpg` em mesh/foto: so nas funcoes de entrada conhecidas (lista acima)."""
    achados = []
    for arq in sorted((RAIZ_MESH / "foto").glob("*.py")):
        funcao = None
        for n, linha in enumerate(arq.read_text(encoding="utf-8").splitlines(), 1):
            m = re.match(r"def (\w+)\(", linha)
            if m:
                funcao = m.group(1)
            if re.search(r"Image\.open|imread|\.jpe?g[\"']", linha) and not linha.lstrip().startswith(("#", '"')):
                achados.append((arq.name, funcao, n))
    assert any(a[:2] == ("projetar.py", "ler_foto") for a in achados), "o leitor de foto do P2 sumiu?"
    fora = [f"{a}:{n} ({f})" for a, f, n in achados if (a, f) not in LEITORES_PERMITIDOS]
    assert fora == []
    # o P2 (projecao + preenchimento) nao le imagem nenhuma fora de ler_foto
    assert not [a for a in achados if a[0] in ("projetar.py", "preencher.py") and a[1] != "ler_foto"]


def test_limiar_do_nao_observado():
    assert LIMIAR_NAO_OBSERVADO == 0.15
