"""Validacao de acuracia do Marco 0 (±1 mm contra o gabarito) e Bland-Altman do pipeline.

Tres cenarios por torso preset, todos pela camada de servico (as mesmas funcoes da API HTTP):

- `decimada`: `torso.obj` (malha decimada pelo pipeline, ~40 mil vertices) enviada como upload em mm
  -> /processar (sem nova decimacao) -> /medir.
- `processar_denso_m`: `denso.obj` (~150 mil vertices) convertido para **metros** e enviado como
  upload com `unidade_origem: "m"` -> /processar (conversao de unidade + recorte + decimacao por
  quadricas para 30–50 mil) -> /medir.
- `reescala_regua`: `torso.obj` com escala errada (x0,8) -> /processar -> calibracao por dois
  pontos de uma "regua" de comprimento conhecido (os dois mamilos do gabarito) -> /reescalar ->
  /medir.

Os landmarks sao as posicoes do gabarito levadas ao quadro da malha enviada e projetadas na
superficie processada (o que um clique perfeito faria); `vertice` = vertice mais proximo.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from mesh import esquemas, servico
from mesh.malha.geometria import Proximidade, soldar
from mesh.malha.io import MalhaRender, escrever_obj, ler_malha
from mesh.medir import antropometria as antro
from mesh.medir.bland_altman import bland_altman
from mesh.versao import RAIZ_REPO, VERSAO_SOFTWARE, versao_pygeodesic

TOL_MM = 1.0
ESCALA_ERRADA = 0.8
MALHA_ID = "00000000-0000-4000-8000-000000000001"


@contextmanager
def data_dir_temporario():
    antigo = os.environ.get("DATA_DIR")
    with tempfile.TemporaryDirectory(prefix="mesh_validacao_") as tmp:
        os.environ["DATA_DIR"] = tmp
        try:
            yield Path(tmp)
        finally:
            if antigo is None:
                os.environ.pop("DATA_DIR", None)
            else:
                os.environ["DATA_DIR"] = antigo


def _upload(data: Path, nome: str, malha: MalhaRender) -> str:
    rel = f"sinteticos_validacao/{nome}/{MALHA_ID}"
    pasta = data / rel / "original"
    pasta.mkdir(parents=True, exist_ok=True)
    tem_tex = malha.textura is not None and malha.uv is not None
    if tem_tex:
        malha.textura.save(pasta / "textura.png")
    escrever_obj(pasta / "scan.obj", malha, "scan.mtl", "textura.png" if tem_tex else None)
    return rel


def landmarks_projetados(malha_dir_abs: Path, posicoes: dict[str, np.ndarray]) -> dict:
    m = ler_malha(malha_dir_abs / "processada.obj")
    Vw, Fw, _ = soldar(m.V, m.F)
    prox = Proximidade(Vw, Fw)
    nomes = list(posicoes)
    q, _, _, _ = prox.consultar(np.array([posicoes[n] for n in nomes]))
    arvore = cKDTree(m.V)
    _, iv = arvore.query(q)
    return {n: {"posicao": q[i].tolist(), "vertice": int(iv[i]), "origem": "gabarito"} for i, n in enumerate(nomes)}


def medir_cenarios(pasta_torso: Path) -> dict:
    """Roda os 3 cenarios num torso gerado e devolve medidas, erros e pares para Bland-Altman."""
    gab = json.loads((pasta_torso / "gabarito.json").read_text(encoding="utf-8"))
    pos_gab = {k: np.asarray(v["posicao"]) for k, v in gab["landmarks"].items()}
    torso = ler_malha(pasta_torso / "torso.obj")
    saida: dict = {"nome": gab["nome"], "cenarios": {}}
    with data_dir_temporario() as data:
        cenarios = {}
        # 1. decimada, em mm
        rel = _upload(data, "decimada", torso)
        meta = servico.processar({"malha_dir": rel, "arquivo_original": "original/scan.obj", "unidade_origem": "mm",
                                  "recorte": {"modo": "abaixo_do_pescoco"}})
        cenarios["decimada"] = (rel, meta, pos_gab)
        # 2. densa em metros -> processar decimando
        if (pasta_torso / "denso.obj").is_file():
            densa = ler_malha(pasta_torso / "denso.obj")
            densa_m = MalhaRender(V=densa.V / 1000.0, F=densa.F, uv=densa.uv, textura=densa.textura)
            rel = _upload(data, "denso_m", densa_m)
            meta = servico.processar({"malha_dir": rel, "arquivo_original": "original/scan.obj",
                                      "unidade_origem": "m", "recorte": {"modo": "abaixo_do_pescoco"}})
            cenarios["processar_denso_m"] = (rel, meta, pos_gab)
        # 3. escala errada + regua + reescalar
        errada = MalhaRender(V=torso.V * ESCALA_ERRADA, F=torso.F, uv=torso.uv, textura=torso.textura)
        rel = _upload(data, "reescala", errada)
        servico.processar({"malha_dir": rel, "arquivo_original": "original/scan.obj", "unidade_origem": "mm",
                           "recorte": {"modo": "abaixo_do_pescoco"}})
        p1, p2 = pos_gab["mamilo_dir"] * ESCALA_ERRADA, pos_gab["mamilo_esq"] * ESCALA_ERRADA
        regua_mm = float(np.linalg.norm(pos_gab["mamilo_esq"] - pos_gab["mamilo_dir"]))
        fator = regua_mm / float(np.linalg.norm(p2 - p1))
        meta = servico.reescalar({"malha_dir": rel, "fator": fator,
                                  "regua": {"regua_mm": regua_mm, "pontos": [p1.tolist(), p2.tolist()]}})
        cenarios["reescala_regua"] = (rel, meta, {k: v * ESCALA_ERRADA * fator for k, v in pos_gab.items()})

        pares = []
        for nome_c, (rel, meta, pos) in cenarios.items():
            lm = landmarks_projetados(data / rel, pos)
            eu_web = {k: round(v, 4) for k, v in antro.euclidianas(lm).items() if v is not None}
            r = servico.medir({"malha_dir": rel, "landmarks": lm, "distancias_euclidianas_web": eu_web,
                               "incluir_geodesica": True, "incluir_volume": True})
            erros = {}
            for k, d in r["distancias"].items():
                G = gab["distancias"][k]
                erros[k] = {"euclidiana_mm": round(d["euclidiana_mm"] - G["euclidiana_mm"], 3),
                            "geodesica_mm": round(d["geodesica_mm"] - G["geodesica_mm"], 3)}
                for tipo in ("euclidiana_mm", "geodesica_mm"):
                    pares.append({"medida": f"{k}:{tipo.split('_')[0]}", "referencia_mm": G[tipo],
                                  "medido_mm": d[tipo], "torso": gab["nome"], "operador": nome_c})
            vol = {}
            for lado in ("dir", "esq"):
                est = r["volumes"][lado]
                real = gab["volumes"][lado]["adicionado_ml"]
                vol[lado] = {"adicionado_ml": real, "estimado_ml": est["valor_ml"], "incerteza_ml": est["incerteza_ml"],
                             "erro_relativo_pct": round(100 * (est["valor_ml"] / real - 1), 1) if real else None}
            saida["cenarios"][nome_c] = {
                "n_vertices": meta["processada"]["n_vertices"],
                "fator_escala_acumulado": meta["fator_escala_acumulado"],
                "erros_mm": erros,
                "erro_max_mm": max(max(abs(e["euclidiana_mm"]), abs(e["geodesica_mm"])) for e in erros.values()),
                "volumes": vol,
                "avisos": meta["avisos"] + r["avisos"],
            }
        saida["pares"] = pares
    return saida


def metricas_marco2(sinteticos: Path, catalogo_arquivo: Path) -> dict:
    """Monotonicidade, simetria (t01), IMF e tempo/tamanho do pre-computo de morphs (catalogo dado)."""
    import time
    import uuid

    from mesh.malha.geometria import normais_vertices
    from mesh.simulacao import catalogo
    from mesh.simulacao.geometrico import SimuladorGeometrico, montar_campo, previsto
    from mesh.simulacao.morphs import gerar_morphs

    imps, _ = catalogo.carregar([catalogo_arquivo])
    cfg = esquemas.config_simulacao()
    reb = cfg["imf"]["rebaixar"]
    sim = SimuladorGeometrico()
    redondos = sorted([i for i in imps.values() if i["forma"] == "redonda" and i["perfil"] == "moderado"],
                      key=lambda i: i["volume_ml"])
    res: dict = {"monotonicidade": True, "series": {}, "simetria_max_mm": 0.0, "imf_manter_max_mm": 0.0,
                 "imf_rebaixar_erro_max_mm": 0.0, "precomputo": {}}
    for nome in esquemas.presets_torso():
        pasta = sinteticos / nome
        gab = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
        lm = gab["landmarks"]
        for plano in ("subglandular", "dual_plane"):
            for imf in ("manter", "rebaixar"):
                serie = [previsto(sim.campos(lm, i, plano, imf, "ambos", cfg), lm)["delta_projecao_mamilo_mm"]["dir"]
                         for i in redondos]
                res["series"][f"{nome}:{plano}:{imf}"] = serie
                res["monotonicidade"] &= all(b > a for a, b in zip(serie, serie[1:], strict=False))
        for i in imps.values():
            for plano in ("subglandular", "dual_plane"):
                for lado in ("dir", "esq"):
                    pm = previsto([montar_campo(lm, lado, i, plano, "manter", cfg)], lm)
                    pr = previsto([montar_campo(lm, lado, i, plano, "rebaixar", cfg)], lm)
                    esp = -min(reb["mm_por_100ml"]["valor"] * i["volume_ml"] / 100, reb["maximo_mm"]["valor"])
                    res["imf_manter_max_mm"] = max(res["imf_manter_max_mm"], abs(pm["delta_y_sulco_mm"][lado]))
                    res["imf_rebaixar_erro_max_mm"] = max(res["imf_rebaixar_erro_max_mm"],
                                                          abs(pr["delta_y_sulco_mm"][lado] - esp))
        if nome == "t01_simetrico_300":
            m = ler_malha(pasta / "torso.obj")
            Vw, Fw, _ = soldar(m.V, m.F)
            Nw = normais_vertices(Vw, Fw)
            E = np.array([-1.0, 1.0, 1.0])
            for i in imps.values():
                for plano in ("subglandular", "dual_plane"):
                    for imf in ("manter", "rebaixar"):
                        campos = sim.campos(lm, i, plano, imf, "ambos", cfg)
                        D = sum(c.deslocamento(Vw, Nw) for c in campos)
                        Dm = sum(c.deslocamento(Vw * E, Nw * E) for c in campos)
                        res["simetria_max_mm"] = max(res["simetria_max_mm"], float(np.abs(Dm - D * E).max()))
        with tempfile.TemporaryDirectory(prefix="mesh_morphs_") as tmp:  # nao sobrescreve os morphs do CLI
            copia = Path(tmp) / nome
            copia.mkdir()
            for arq in ("torso.obj", "torso.mtl", "textura.png", "torso.glb"):
                shutil.copy2(pasta / arq, copia / arq)
            t0 = time.perf_counter()
            man = gerar_morphs(copia, lm, list(imps.values()),
                               malha_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"mesh:validacao/{nome}")),
                               arquivo_obj="torso.obj", arquivo_glb="torso.glb", quadro="anatomico")
        res["precomputo"][nome] = {"targets": man["_n_targets"], "s": round(time.perf_counter() - t0, 2),
                                   "mb": round(sum(man["_bytes"].values()) / 1e6, 1)}
    res["simetria_max_mm"] = round(res["simetria_max_mm"], 4)
    return res


def _markdown_marco2(r: dict, catalogo_nome: str) -> str:
    L = ["## Marco 2 (Python) — modelo geométrico e morph targets (ADR 0014)", "",
         f"Catálogo: `{catalogo_nome}` (EXEMPLO NÃO CLÍNICO). Coeficientes de `config/simulacao.json`, todos "
         "`nao_calibrado`.", "",
         f"- Monotonicidade (redondos moderados em ordem de volume, projeção anterior do mamilo, 3 torsos × 2 planos "
         f"× 2 IMF): **{'sim' if r['monotonicidade'] else 'NÃO'}**.",
         f"- Simetria no t01 (campo espelhado − campo, todos os implantes/planos/IMF): máx. "
         f"**{r['simetria_max_mm']:.4f} mm** (critério < 0,1).",
         f"- `imf=manter`: deslocamento máx. do sulco em Y = {r['imf_manter_max_mm']:.2f} mm (critério ≤ 1); "
         f"`imf=rebaixar`: erro máx. contra min(mm_por_100ml·V/100, máximo) = {r['imf_rebaixar_erro_max_mm']:.2f} mm.",
         "", "| série (torso:plano:imf) | projeção do mamilo (mm), volume crescente |", "|---|---|"]
    for k, v in r["series"].items():
        L.append(f"| {k} | {' < '.join(f'{x:.2f}' for x in v)} |")
    L += ["", "| torso | targets | tempo de pré-cômputo (s) | tamanho dos 4 .glb (MB) |", "|---|---|---|---|"]
    for k, v in r["precomputo"].items():
        L.append(f"| {k} | {v['targets']} | {v['s']} | {v['mb']} |")
    L += ["", "Os `.glb` passam no Khronos glTF-Validator sem erros nem avisos (verificação manual desta versão).", ""]
    return "\n".join(L) + "\n"


def _commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ_REPO, capture_output=True,
                              text=True, check=True).stdout.strip() or None
    except Exception:  # noqa: BLE001
        return None


def relatorio_marco0(sinteticos: Path, gerar_se_faltar: bool = True) -> dict:
    from mesh.sintetico.gerador import gerar_torso

    presets = esquemas.presets_torso()
    resultados, pares = [], []
    for nome, p in presets.items():
        pasta = sinteticos / nome
        if gerar_se_faltar and not ((pasta / "gabarito.json").is_file() and (pasta / "torso.obj").is_file()
                                    and (pasta / "denso.obj").is_file()):
            sinteticos.mkdir(parents=True, exist_ok=True)
            gerar_torso(p, sinteticos)
        r = medir_cenarios(pasta)
        resultados.append(r)
        pares += r["pares"]
    ba = bland_altman(pares)
    erro_max = max(c["erro_max_mm"] for r in resultados for c in r["cenarios"].values())
    resumo = {
        "versao_software": VERSAO_SOFTWARE,
        "marco0_erro_max_gabarito_mm": round(erro_max, 3),
        "aprovado_marco0": bool(erro_max <= TOL_MM),
        "bland_altman_pipeline": {k: ba[k] for k in ("n", "vies_mm", "dp_mm", "loa_inferior_mm", "loa_superior_mm",
                                                     "dentro_de_2mm", "erro_abs_max_mm")},
        "volume_erro_max_pct": max(abs(v["volumes"][lado]["erro_relativo_pct"]) for r in resultados
                                   for v in r["cenarios"].values() for lado in ("dir", "esq")),
        "por_torso": {r["nome"]: {c: {"erro_max_mm": v["erro_max_mm"], "n_vertices": v["n_vertices"],
                                      "volume_erro_pct": {lado: v["volumes"][lado]["erro_relativo_pct"]
                                                          for lado in ("dir", "esq")}}
                                  for c, v in r["cenarios"].items()} for r in resultados},
    }
    return {"resumo": resumo, "resultados": resultados, "bland_altman": ba,
            "markdown": _markdown(resumo, resultados, ba)}


def _markdown(resumo: dict, resultados: list[dict], ba: dict) -> str:
    L = []
    L.append("---")
    L.append("esquema: validacao_componente/services-mesh")
    L.append(f"versao_software: {VERSAO_SOFTWARE}")
    L.append(f"data: {date.today().isoformat()}")
    L.append(f"commit_base: {_commit()}")
    L.append(f"ambiente: {{ os: {platform.system().lower()}, python: \"{platform.python_version()}\", "
             f"pygeodesic: \"{versao_pygeodesic()}\" }}")
    L.append("parametros: { torsos: [t01_simetrico_300, t02_assimetrico, t03_pequeno_ptose], "
             "decimacao_alvo_vertices: 40000, geodesica: mmp, gabarito_geodesica: malha_densa }")
    L.append(f"marco0_erro_max_gabarito_mm: {resumo['marco0_erro_max_gabarito_mm']}")
    L.append(f"marco0_criterio_1mm: {str(resumo['aprovado_marco0']).lower()}")
    L.append("---")
    L.append("")
    L.append(f"# Validacao do services/mesh — Marco 0 e Bland-Altman do pipeline (v{VERSAO_SOFTWARE})")
    L.append("")
    L.append("Registro complementar ao `v0.0.1.md` (orquestrador), gerado por "
             "`python -m mesh.cli validar --sinteticos data/sinteticos --relatorio <este arquivo>` "
             "(RDC 657, art. 5º: versão, data, parâmetros e resultados). Somente torsos sintéticos paramétricos; "
             "nenhum dado de paciente.")
    L.append("")
    L.append("## Critério do Marco 0 — erro contra o gabarito (tolerância ±1,0 mm)")
    L.append("")
    L.append("Erro = medido − gabarito, landmarks do gabarito projetados na malha processada. Euclidiana e "
             "geodésica (MMP exata, `pygeodesic`); gabarito geodésico calculado na malha densa (~300 mil faces).")
    L.append("")
    L.append("| torso | cenário | vértices | erro máx. (mm) | " + " | ".join(antro.DISTANCIAS) + " |")
    L.append("|---|---|---|---|" + "---|" * len(antro.DISTANCIAS))
    for r in resultados:
        for c, v in r["cenarios"].items():
            cel = [f"{v['erros_mm'][k]['euclidiana_mm']:+.2f} / {v['erros_mm'][k]['geodesica_mm']:+.2f}"
                   for k in antro.DISTANCIAS]
            L.append(f"| {r['nome']} | {c} | {v['n_vertices']} | {v['erro_max_mm']:.3f} | " + " | ".join(cel) + " |")
    L.append("")
    L.append("Células: erro euclidiano / erro geodésico, em mm.")
    L.append("")
    L.append(f"**Resultado:** erro máximo {resumo['marco0_erro_max_gabarito_mm']:.3f} mm → critério ±1 mm "
             f"{'ATINGIDO' if resumo['aprovado_marco0'] else 'NÃO atingido'}.")
    L.append("")
    L.append("## Bland-Altman do pipeline (medido × gabarito)")
    L.append("")
    L.append(f"n = {ba['n']} pares (3 torsos × 3 cenários × 7 distâncias × euclidiana/geodésica); "
             f"viés = {ba['vies_mm']:+.3f} mm; DP = {ba['dp_mm']:.3f} mm; LoA 95 % = "
             f"[{ba['loa_inferior_mm']:+.3f}; {ba['loa_superior_mm']:+.3f}] mm; dentro de ±2 mm: "
             f"{'sim' if ba['dentro_de_2mm'] else 'não'}.")
    L.append("")
    L.append("Isto valida o **cálculo** (landmarks perfeitos). O critério do Marco 1 exige cliques humanos no "
             "viewer (≥30 pares); esses pares entram pelo `POST /validar-bland-altman` quando o web estiver pronto.")
    L.append("")
    L.append("## Volume (estimador `plano_base_elipse` v2 — parede reconstruída; contratos §3.2, ADR 0012)")
    L.append("")
    L.append("| torso | lado | adicionado real (mL) | estimado (mL) | ± incerteza (mL) | erro relativo |")
    L.append("|---|---|---|---|---|---|")
    for r in resultados:
        v = r["cenarios"]["decimada"]["volumes"]
        for lado in ("dir", "esq"):
            x = v[lado]
            L.append(f"| {r['nome']} | {lado} | {x['adicionado_ml']} | {x['estimado_ml']} | {x['incerteza_ml']} | "
                     f"{x['erro_relativo_pct']:+.1f} % |")
    L.append("")
    L.append("v2: a altura de referência é a parede torácica reconstruída por um polinômio cúbico ajustado ao anel "
             "periférico da base (1,05–1,30 do raio elíptico), e não mais o plano base medial/lateral/sulco, que "
             "cortava a parede curva e contava a \"lente\" de parede como mama (v1: +35 a +45 % nestes torsos). "
             "Critério: erro ≤ ±10 % e faixa (±15 %) contendo o volume real.")
    L.append("")
    L.append("## Desvios e pendências")
    L.append("")
    L.append("- Geodésica parte da `posicao` exata do landmark (inserida como vértice na malha soldada), não do "
             "`vertice` mais próximo como diz o contratos §3.1/§4.3; com vértice mais próximo o erro de "
             "arredondamento (até ~2 mm por extremo numa malha de 40 mil vértices) estouraria ±1 mm.")
    L.append("- Com `X-Desenho: A`, `POST /medir` responde 403 `desligado_no_desenho_a` (defesa em profundidade; "
             "o contratos §7 diz que o Python só registra o cabeçalho).")
    L.append("- Estimador de volume v2 (ADR 0012) mantém o id `plano_base_elipse` por compatibilidade com o web.")
    L.append("- Heurística de unidade trocada (ADR 0013): escala log centrada em 500 mm (limiares 5 e 158).")
    L.append("- Bland-Altman com cliques humanos (critério real do Marco 1) depende do viewer.")
    L.append("")
    L.append("<!-- MARCO2 -->")
    L.append("")
    L.append("## Como reproduzir")
    L.append("")
    L.append("```bash")
    L.append("bash scripts/mesh.sh venv")
    L.append("cd services/mesh && .venv/bin/python -m mesh.cli torso --todos --saida ../../data/sinteticos")
    L.append(".venv/bin/python -m mesh.cli morphs --todos --sinteticos ../../data/sinteticos")
    L.append(".venv/bin/python -m mesh.cli validar --sinteticos ../../data/sinteticos \\")
    L.append("  --relatorio ../../docs/validacao/v0.0.1-services-mesh.md")
    L.append(".venv/bin/pytest -q")
    L.append("```")
    L.append("")
    return "\n".join(L) + "\n"
