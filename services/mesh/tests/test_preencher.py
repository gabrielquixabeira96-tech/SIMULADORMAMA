"""P2 (plano foto3d): preenchimento do nao observado (cor casada, areola), gravacao em malha_dir
(textura.png, observado.png, .glb com extras), SH9 da textura projetada, tempo e determinismo."""

from __future__ import annotations

import hashlib

import numpy as np
from PIL import Image
from scipy import ndimage

from mesh import esquemas
from mesh.foto.preencher import (
    _lab,
    fototipo_estimado,
    preencher,
    uv_dos_landmarks,
)
from mesh.foto.projetar import LIMIAR_NAO_OBSERVADO
from mesh.malha.glb import ler_json_glb
from tests.foto_render import base_recolorida, texturizar_cena

PX_POR_MM = 4.0


def _lum255(rgb8: np.ndarray) -> np.ndarray:
    return np.asarray(rgb8, dtype=np.float64) @ np.array([0.2126, 0.7152, 0.0722])


def _media_local(Z, M, sigma):
    num = ndimage.gaussian_filter(Z * M, sigma, mode=("nearest", "wrap"))
    den = ndimage.gaussian_filter(M.astype(np.float64), sigma, mode=("nearest", "wrap"))
    return num / np.maximum(den, 1e-9), den


def _costura(tex8: np.ndarray, observado: np.ndarray, banda_mm: float = 10.0) -> float:
    """Diferenca media de luminancia (0..255) entre as faixas de 10 mm dos dois lados da borda
    observado/preenchido: medias locais (gaussiana de 5 mm) de cada lado, nos texels da borda."""
    Y = _lum255(tex8)
    obs = observado > 0
    b = banda_mm * PX_POR_MM
    d_in, d_out = ndimage.distance_transform_edt(obs), ndimage.distance_transform_edt(~obs)
    dentro, fora = obs & (d_in <= b), ~obs & (d_out <= b)
    m_in, g_in = _media_local(Y, dentro, b / 2)
    m_out, g_out = _media_local(Y, fora, b / 2)
    borda = (g_in > 0.1) & (g_out > 0.1) & ((d_in == 1) | (d_out == 1))
    assert borda.sum() > 1000
    return float(np.abs(m_in - m_out)[borda].mean())


def test_costura_observado_preenchido(cena_t01, reconstrucao_t01):
    rec = reconstrucao_t01["rec"]
    tex = np.asarray(rec.textura)
    dif = _costura(tex, rec.alfa)
    ref = _costura(np.round(cena_t01["atlas"] * 255), rec.alfa)  # a mesma medida na textura verdadeira
    print(f"costura: {dif:.2f}/255 (a verdade, sem costura nenhuma, da {ref:.2f}/255)")
    assert dif <= 4.0


def test_preenchido_casado_com_a_pele_observada_vizinha(cena_t01, reconstrucao_t01):
    """Texels preenchidos a ate 20 mm da borda: |L* - L* medio da pele observada vizinha| <= 12/255
    (L* em escala 0..255), mesmo com a base procedural num tom bem diferente."""
    rec = reconstrucao_t01["rec"]
    tex = np.asarray(rec.textura, dtype=np.float64) / 255.0
    L = _lab(tex[::2, ::2])[..., 0] * 2.55
    alfa = rec.alfa[::2, ::2]
    obs, prench = alfa >= 0.999, alfa == 0
    perto = prench & (ndimage.distance_transform_edt(~(alfa > 0)) <= 20 * PX_POR_MM / 2)
    viz, _ = _media_local(L, obs, 20 * PX_POR_MM / 2)
    dif = np.abs(L - viz)[perto]
    print(f"|dL*| preenchido vs observado vizinho: media={dif.mean():.2f} p95={np.percentile(dif, 95):.2f} (/255)")
    assert dif.mean() <= 12.0
    # e a base (recolorida, mais escura) nao passou: sem o casamento a diferenca seria grande
    base = np.asarray(base_recolorida(cena_t01["atlas"]), dtype=np.float64)
    Lb = _lab(base[::2, ::2] / 255.0)[..., 0] * 2.55
    assert np.abs(Lb - viz)[perto].mean() > 2 * dif.mean()


def test_areola_procedural_ausente_quando_o_mamilo_foi_visto(reconstrucao_t01):
    rec = reconstrucao_t01["rec"]
    assert rec.info["areola_dir"] == rec.info["areola_esq"] == "observada"
    assert not any(a.startswith("areola_procedural") for a in rec.avisos)


def test_areola_procedural_quando_o_mamilo_nao_foi_visto(cena_t01, reconstrucao_t01):
    """Mamilo "nas costas" (nao observado): a areola procedural da base entra, com contraste, e avisa."""
    proj = reconstrucao_t01["proj"]
    H, W = proj.observado.shape
    # base com uma "areola" escura num ponto das costas (u = 0,02) e o mamilo fingido la
    base = np.asarray(base_recolorida(cena_t01["atlas"])).copy()
    ci, cj = H // 2, int(0.02 * W)
    ii, jj = np.ogrid[:H, :W]
    disco = (ii - ci) ** 2 + (jj - cj) ** 2 < (15 * PX_POR_MM) ** 2
    base[disco] = (base[disco] * 0.55).astype(np.uint8)
    uv = ((cj + 0.5) / W, 1 - (ci + 0.5) / H)
    rec = preencher(proj, Image.fromarray(base), mamilos_uv={"mamilo_dir": uv})
    assert "areola_procedural_dir" in rec.avisos
    tex = _lum255(np.asarray(rec.textura))
    anel = ~disco & ((ii - ci) ** 2 + (jj - cj) ** 2 < (35 * PX_POR_MM) ** 2)
    assert tex[disco].mean() < 0.8 * tex[anel].mean()
    # com os mamilos de verdade (vistos na foto frontal), nenhum aviso
    mam = {k: v for k, v in uv_dos_landmarks(cena_t01["mu"], cena_t01["gab"]["landmarks"]).items()
           if k.startswith("mamilo_")}
    rec2 = preencher(proj, Image.fromarray(base), mamilos_uv=mam)
    assert not any(a.startswith("areola_procedural") for a in rec2.avisos)


def test_sem_textura_base_avisa_e_preenche(reconstrucao_t01):
    proj = reconstrucao_t01["proj"]
    rec = preencher(proj, None)
    assert "preenchimento_sem_textura_base" in rec.avisos
    tex = np.asarray(rec.textura)
    assert tex[rec.alfa == 0].min() > 0  # nada preto: tudo recebeu a cor extrapolada
    assert _costura(tex, rec.alfa) <= 4.0


def test_fototipo_estimado_do_t01(reconstrucao_t01):
    assert fototipo_estimado(reconstrucao_t01["proj"]) == "III"  # o t01 foi gerado no fototipo III


# ----------------------------------------------------------------------------- gravacao

def test_texturizar_grava_so_os_arquivos_do_contrato(reconstrucao_t01):
    d = reconstrucao_t01["dir"]
    assert sorted(p.name for p in d.iterdir()) == ["observado.png", "processada.glb", "textura.png"]
    bloco = reconstrucao_t01["bloco"]
    esquemas.validar("textura_reconstruida", bloco)
    with Image.open(d / "observado.png") as im:
        assert im.mode == "L"
        obs = np.asarray(im)
    with Image.open(d / "textura.png") as im:
        assert im.size == obs.shape[::-1] == (bloco["largura_px"], bloco["altura_px"])
    # 0 = preenchido; o que tem 0 e exatamente o nao observado (observado < 0,15)
    proj = reconstrucao_t01["proj"]
    assert np.array_equal(obs == 0, np.round(reconstrucao_t01["rec"].alfa * 255) == 0)
    assert np.all(obs[proj.observado < LIMIAR_NAO_OBSERVADO] == 0)
    assert abs(100.0 * np.count_nonzero(obs > 0) / obs.size - bloco["cobertura_observada_pct"]) < 0.5
    gltf = ler_json_glb(d / "processada.glb")
    ex = gltf["asset"]["extras"]
    assert ex["unidade"] == "mm" and ex["quadro"] == "anatomico"
    assert ex["reconstrucao"] == {"fotos": 1, "cobertura_observada_pct": bloco["cobertura_observada_pct"]}
    assert ex["textura"] == {"origem": "foto_projetada", "observado": "observado.png",
                             "cobertura_observada_pct": bloco["cobertura_observada_pct"],
                             "limiar_nao_observado": LIMIAR_NAO_OBSERVADO}
    assert ex["iluminacao"] == bloco["iluminacao"]


def test_sh9_da_textura_projetada_recupera_a_luz_assada(reconstrucao_t01):
    ilum = reconstrucao_t01["bloco"]["iluminacao"]
    print(f"SH9 ajustado na textura projetada: r2={ilum['r2']} origem={ilum['origem']}")
    assert ilum["origem"] == "ajuste"
    assert ilum["r2"] >= 0.85


def test_tempo_projecao_e_preenchimento(reconstrucao_t01):
    """<= 30 s (1 foto de 2000 px, atlas 3392 x 1900), com a gravacao do .glb incluida."""
    dur = reconstrucao_t01["duracao_s"]
    print(f"texturizar_malha: {dur:.1f} s; {reconstrucao_t01['bloco']['duracao_s']}")
    assert dur <= 30.0


def test_deterministico(cena_t01, reconstrucao_t01, tmp_path):
    (bloco, _, _), _ = texturizar_cena(cena_t01, tmp_path)
    a = reconstrucao_t01["dir"]
    for arq in ("textura.png", "observado.png", "processada.glb"):
        assert (hashlib.sha256((a / arq).read_bytes()).hexdigest()
                == hashlib.sha256((tmp_path / arq).read_bytes()).hexdigest()), arq
    assert bloco["sha256"] == reconstrucao_t01["bloco"]["sha256"]
