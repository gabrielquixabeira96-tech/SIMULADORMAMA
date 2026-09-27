#!/usr/bin/env python3
"""Consolida o registro de validacao da versao corrente (contratos §15; RDC 657 art. 5).

Le SOMENTE saidas de comandos (nada digitado a mao):
  docs/validacao/v<V>-services-mesh.json      (scripts/validacao.sh passo 1: Marco 0, volume, Marco 2)
  docs/validacao/v<V>-web-marcos-0-1.json     (e2e validacao.spec.ts: Marco 0 no viewer, Marco 1 cliques)
  docs/validacao/v<V>-web-marco2-latencia.json (e2e latencia.spec.ts)
  <artefatos>/pytest.xml, vitest-web.json, vitest-contratos.json, playwright.json
e os textos versionados docs/validacao/mudancas-v<V>.md ("O que mudou") e docs/validacao/pendencias-v<V>.md
("Desvios e pendências", completado por linhas com numeros medidos, p.ex. o p95 da latencia);
grava docs/validacao/v<V>.json (validacao/1.0) e docs/validacao/v<V>.md e insere/atualiza (idempotente)
a linha da versao no indice docs/validacao/README.md.
Uso: python3 scripts/registro_validacao.py --artefatos test-results/validacao-v<V>
"""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DOCS = RAIZ / "docs" / "validacao"


def ler(p: Path) -> dict | None:
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


def cmd(*a: str) -> str:
    try:
        return subprocess.run(a, cwd=RAIZ, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def commit_descrito(raiz: Path = RAIZ) -> str | None:
    """`git describe --always --dirty` (RDC 657 art. 5: o registro cita o commit EXATO validado e
    marca `-dirty` se a arvore tinha alteracao nao commitada). `VALIDACAO_COMMIT` (gravado pelo
    scripts/validacao.sh ANTES de gerar qualquer artefato) tem precedencia."""
    import os

    env = os.environ.get("VALIDACAO_COMMIT", "").strip()
    if env:
        return env
    try:
        return subprocess.run(["git", "describe", "--always", "--dirty", "--abbrev=12"], cwd=raiz, capture_output=True,
                              text=True, check=True).stdout.strip() or None
    except Exception:  # noqa: BLE001
        return None


def contagem_vitest(p: Path) -> dict | None:
    j = ler(p)
    if not j:
        return None
    return {"passaram": j["numPassedTests"], "falharam": j["numFailedTests"], "pulados": j.get("numPendingTests", 0) + j.get("numTodoTests", 0)}


def contagem_pytest(p: Path) -> tuple[dict | None, dict[str, str]]:
    if not p.is_file():
        return None, {}
    raiz = ET.parse(p).getroot()
    suites = [raiz] if raiz.tag == "testsuite" else list(raiz)
    tot = fal = pul = 0
    casos: dict[str, str] = {}
    for s in suites:
        tot += int(s.get("tests", 0))
        fal += int(s.get("failures", 0)) + int(s.get("errors", 0))
        pul += int(s.get("skipped", 0))
        for c in s.iter("testcase"):
            estado = "falhou" if c.find("failure") is not None or c.find("error") is not None else "pulado" if c.find("skipped") is not None else "passou"
            casos[c.get("name", "")] = estado
    return {"passaram": tot - fal - pul, "falharam": fal, "pulados": pul}, casos


def contagem_playwright(p: Path) -> tuple[dict | None, dict[str, str]]:
    j = ler(p)
    if not j:
        return None, {}
    st = j["stats"]
    casos: dict[str, str] = {}

    def andar(suite: dict) -> None:
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                casos[f"[{t.get('projectName')}] {spec['title']}"] = t.get("status", "?")
        for s in suite.get("suites", []):
            andar(s)

    for s in j.get("suites", []):
        andar(s)
    return {"passaram": st.get("expected", 0) + st.get("flaky", 0), "falharam": st.get("unexpected", 0), "pulados": st.get("skipped", 0)}, casos


LIMITE_LATENCIA_MS = 100.0
ROTULO_LATENCIA = {
    "slider_comparacao_2_paineis": "A comparação lado a lado (2 painéis)",
    "geral_1_painel": "A interação com 1 painel (critério do Marco 2)",
}
COMPONENTES = ("services-mesh", "web-marcos-0-1", "web-marco2-latencia")


def linhas_medidas(lat: dict | None, gltf: dict | None) -> list[str]:
    """Pendencias que dependem de numeros medidos (nada fixo no texto): latencia p95 >= 100 ms por
    interacao e resultado do glTF-Validator."""
    out = []
    for k, x in ((lat or {}).get("resultados") or {}).items():
        p95 = x.get("p95_ms")
        if p95 is not None and p95 >= LIMITE_LATENCIA_MS:
            rot = ROTULO_LATENCIA.get(k, f"A interação `{k}`")
            out.append(f"- {rot} fica acima de {LIMITE_LATENCIA_MS:.0f} ms no ambiente medido (p95 = {p95:.1f} ms; "
                       f"n = {x.get('n')}).")
    if not gltf:
        out.append("- glTF-Validator (Khronos) não executado nesta geração (`node scripts/validar_gltf.mjs`).")
    elif gltf["erros"] or gltf["avisos"]:
        out.append(f"- glTF-Validator {gltf['versao']}: {gltf['erros']} erros e {gltf['avisos']} avisos em "
                   f"{gltf['arquivos']} arquivos `.glb`.")
    return out


def texto_pendencias(v: str, docs: Path = DOCS) -> str | None:
    """Conteudo de docs/validacao/pendencias-v<V>.md (sem um titulo `#`/`##` inicial, se houver)."""
    p = docs / f"pendencias-v{v}.md"
    if not p.is_file():
        return None
    linhas = p.read_text(encoding="utf-8").strip().splitlines()
    while linhas and (linhas[0].startswith("#") or not linhas[0].strip()):
        linhas.pop(0)
    return "\n".join(linhas).strip()


def linha_indice(v: str, data: str, status: str, n_ok: int, n_total: int, docs: Path = DOCS) -> str:
    comp = []
    for c in COMPONENTES:
        if (docs / f"v{v}-{c}.md").is_file():
            j = f" ([json](v{v}-{c}.json))" if (docs / f"v{v}-{c}.json").is_file() else ""
            comp.append(f"[{c}](v{v}-{c}.md){j}")
    return (f"| {v} | {data} | {status} ({n_ok}/{n_total} critérios) | [v{v}.md](v{v}.md) · [json](v{v}.json) | "
            f"{' · '.join(comp) or '—'} |")


def _ident(x: str) -> tuple[int, int, str]:
    """Identificador comparavel: numerico (pelo valor) < alfanumerico (lexico ASCII), como no SemVer."""
    return (0, int(x), "") if x.isdigit() else (1, 0, x)


def _chave_versao(v: str) -> tuple:
    """Chave de ordenacao TOTAL estilo SemVer 2.0 para `X.Y.Z[-pre][+build]` (prefixo `v` opcional).

    Nucleo comparado campo a campo (numeros pelo valor; campos ausentes contam como 0), e uma
    pre-release vem ANTES da release de mesmo nucleo (0.2.0-rc1 < 0.2.0). Entre pre-releases,
    identificadores separados por `.`: numerico < alfanumerico, e o prefixo mais curto vem antes
    (rc < rc.1 < rc.2 < rc.10 < rc1). Metadado de build (`+...`) e ignorado. Nunca mistura int com
    str na mesma posicao (cada campo vira uma tupla de mesmo formato), logo nunca levanta TypeError.
    """
    v = v.strip()
    if v[:1] in ("v", "V"):
        v = v[1:]
    v = v.split("+", 1)[0]
    nucleo, _, pre = v.partition("-")
    campos = [_ident(x) for x in nucleo.split(".")]
    campos += [(0, 0, "")] * (3 - len(campos))
    # release (sem pre) > qualquer pre-release do mesmo nucleo
    return (tuple(campos), (1,) if not pre else (0, tuple(_ident(x) for x in pre.split("."))))


def atualizar_indice(indice: Path, v: str, linha: str) -> None:
    """Insere ou substitui a linha `| <v> | ...` da tabela do indice, mantendo a ordem decrescente de versao.
    Idempotente: rodar de novo com a mesma linha nao muda o arquivo."""
    linhas = indice.read_text(encoding="utf-8").splitlines()
    try:
        sep = next(i for i, l in enumerate(linhas) if l.startswith("|---") and i > 0 and linhas[i - 1].startswith("| Versão"))
    except StopIteration as e:
        raise SystemExit(f"tabela de versões não encontrada em {indice}") from e
    fim = sep + 1
    while fim < len(linhas) and linhas[fim].startswith("|"):
        fim += 1
    corpo = [l for l in linhas[sep + 1:fim] if l.split("|")[1].strip() != v]
    pos = next((i for i, l in enumerate(corpo) if _chave_versao(l.split("|")[1].strip()) < _chave_versao(v)), len(corpo))
    corpo.insert(pos, linha)
    novo = linhas[:sep + 1] + corpo + linhas[fim:]
    indice.write_text("\n".join(novo) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--artefatos", required=True)
    a = ap.parse_args()
    art = Path(a.artefatos)
    v = (RAIZ / "VERSION").read_text().strip()
    mesh = ler(DOCS / f"v{v}-services-mesh.json")
    web01 = ler(DOCS / f"v{v}-web-marcos-0-1.json")
    lat = ler(DOCS / f"v{v}-web-marco2-latencia.json")
    t_py, casos_py = contagem_pytest(art / "pytest.xml")
    t_web = contagem_vitest(art / "vitest-web.json")
    t_con = contagem_vitest(art / "vitest-contratos.json")
    t_e2e, casos_e2e = contagem_playwright(art / "playwright.json")
    gltf = mesh.get("gltf_validator") if mesh else None

    ba = web01["marco1"]["bland_altman_geral"] if web01 else None
    nimf = web01["marco1"]["n_imf"] if web01 else None
    erro_m0 = max(mesh["resumo"]["marco0_erro_max_gabarito_mm"], web01["marco0"]["erro_max_mm"]) if mesh and web01 else None
    m2 = mesh["marco2"] if mesh else None
    regressao = {"passou": True, "falhou": False}.get(casos_py.get("test_regressao_geometrica_snapshot", ""), None)
    e2e_ab = {
        d: casos_e2e.get(f"[desenho-{d}] fluxo completo do upload ao PDF — desenho {d}" + (" (nada calculado no relatório nem no PDF)" if d == "A" else ""))
        for d in ("A", "B")
    }
    ba_obj = lambda x: None if not x else {"n": x["n"], "vies_mm": x["vies_mm"], "dp_mm": x["dp_mm"], "loa_mm": [x["loa_inferior_mm"], x["loa_superior_mm"]], "criterio_2mm": x["dentro_de_2mm"]}  # noqa: E731

    criterios = {
        "M0 escala ±1 mm": erro_m0 is not None and erro_m0 <= 1.0,
        "M1 LoA ±2 mm": bool(ba and ba["dentro_de_2mm"]),
        "M2 latência p95 < 100 ms": bool(lat and lat["aprovado"]),
        "M2 monotonicidade": bool(m2 and m2["monotonicidade"]),
        "M2 simetria < 0,1 mm": bool(m2 and m2["simetria_max_mm"] < 0.1),
        "M2 regressão geométrica": regressao is True,
        "M2b E2E upload→PDF (A e B)": all(s == "expected" for s in e2e_ab.values()),
        "glTF-Validator: 0 erros e 0 avisos nos .glb": bool(gltf and gltf["arquivos"] > 0 and gltf["erros"] == 0 and gltf["avisos"] == 0),
        "testes sem falha": all(t is not None and t["falharam"] == 0 for t in (t_py, t_web, t_con, t_e2e)),
    }
    commit = commit_descrito()
    arvore_suja = commit is None or commit.endswith("-dirty")
    criterios["árvore limpa no commit validado (git describe sem -dirty)"] = not arvore_suja
    status = "aprovado" if all(criterios.values()) else "reprovado"
    node = cmd("node", "--version").lstrip("v")
    py = cmd(str(RAIZ / "services/mesh/.venv/bin/python"), "--version").replace("Python ", "")
    registro = {
        "esquema": "validacao/1.0",
        "versao_software": v,
        "data": date.today().isoformat(),
        "commit": commit,
        "arvore_suja": arvore_suja,
        "desenho_testado": ["A", "B"],
        "ambiente": {
            "os": platform.system().lower(),
            "node": node,
            "python": py,
            "navegador": web01["ambiente"]["navegador"] if web01 else None,
            "webgl": "SwiftShader (software, Chromium headless)",
            "cpu": lat["maquina"]["cpu"] if lat else None,
            "n_cpus": lat["maquina"]["n_cpus"] if lat else None,
        },
        "parametros": {
            "torsos": ["t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose"],
            "decimacao_alvo_vertices": 40000,
            "geodesica": "mmp",
            "config_tepid": json.loads((RAIZ / "config/tepid.json").read_text())["versao"],
            "config_simulacao": json.loads((RAIZ / "config/simulacao.json").read_text())["versao"],
            "marco1_operador": "simulado (projeção do gabarito + jitter ±1 px)",
            "marco1_repeticoes": web01["parametros"]["repeticoes"] if web01 else None,
            "llm": "mock determinístico (sem ANTHROPIC_API_KEY)",
            "catalogo_morphs_validacao": "services/mesh/tests/fixtures/catalogo_teste.json (exemplo não clínico)",
        },
        "resultados": {
            "marco0_erro_max_gabarito_mm": erro_m0,
            "marco0_escala": {
                "services_mesh_erro_max_mm": mesh["resumo"]["marco0_erro_max_gabarito_mm"] if mesh else None,
                "web_viewer_erro_max_mm": web01["marco0"]["erro_max_mm"] if web01 else None,
                "web_por_torso": [{k: t[k] for k in ("torso", "caixa_obj_mm", "erro_caixa_processada_mm", "erro_max_distancias_mm")} for t in web01["marco0"]["por_torso"]] if web01 else None,
            },
            "marco1_bland_altman": ba_obj(ba) or {"n": None, "vies_mm": None, "dp_mm": None, "loa_mm": [None, None], "criterio_2mm": None},
            "marco1_n_imf": ba_obj(nimf) or {"n": None, "vies_mm": None, "dp_mm": None, "loa_mm": [None, None], "criterio_2mm": None},
            "volume": {"erro_max_pct": mesh["resumo"]["volume_erro_max_pct"], "por_torso": {k: v2["decimada"]["volume_erro_pct"] for k, v2 in mesh["resumo"]["por_torso"].items()}, "meta_pct": 10} if mesh else {},
            "marco2_latencia_p95_ms": lat["resultados"]["geral_1_painel"]["p95_ms"] if lat else None,
            "marco2_latencia": {k: {kk: x[kk] for kk in ("n", "p50_ms", "p95_ms", "max_ms")} for k, x in lat["resultados"].items()} if lat else {},
            "marco2_monotonicidade": m2["monotonicidade"] if m2 else None,
            "marco2_simetria_max_mm": m2["simetria_max_mm"] if m2 else None,
            "marco2_imf": {"manter_max_mm": m2["imf_manter_max_mm"], "rebaixar_erro_max_mm": m2["imf_rebaixar_erro_max_mm"]} if m2 else {},
            "marco2_regressao": regressao,
            "marco2b_e2e": {d: (s == "expected") if s else None for d, s in e2e_ab.items()},
            "testes": {"web_unit": t_web, "web_e2e": t_e2e, "python": t_py, "contratos": t_con},
        },
        "status": status,
    }
    (DOCS / f"v{v}.json").write_text(json.dumps(registro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    R = registro["resultados"]
    notas = DOCS / f"mudancas-v{v}.md"
    mudancas = notas.read_text(encoding="utf-8").strip() if notas.is_file() else (
        "## O que mudou (desde v0.0.1)\n\nMarcos 0, 1, 2 e 2b implementados: gerador de torso sintético e antropometria (services/mesh), "
        "viewer/upload/calibração/landmarks/medidas/TEPID/flag A-B/banco com auditoria (apps/web), catálogo real de 186 implantes "
        "(não verificado), modelo geométrico e morph targets, simulação com envelope de incerteza, camada de LLM (mock/Anthropic) "
        "com números travados, relatório e PDF do atendimento.")
    tst = lambda t: "—" if not t else f"{t['passaram']} passaram, {t['falharam']} falharam, {t['pulados']} pulados"  # noqa: E731
    bam = lambda x: f"n = {x['n']}; viés = {x['vies_mm']:+.3f} mm; DP = {x['dp_mm']:.3f} mm; LoA 95 % = [{x['loa_mm'][0]:+.3f}; {x['loa_mm'][1]:+.3f}] mm; dentro de ±2 mm: {'sim' if x['criterio_2mm'] else 'NÃO'}" if x and x["n"] else "—"  # noqa: E731
    lat_l = "\n".join(f"| {k} | {x['n']} | {x['p50_ms']:.1f} | {x['p95_ms']:.1f} | {x['max_ms']:.1f} |" for k, x in R["marco2_latencia"].items())
    esc_l = "\n".join(f"| {t['torso']} | {' × '.join(str(c) for c in t['caixa_obj_mm'])} | {t['erro_caixa_processada_mm']:.3f} | {t['erro_max_distancias_mm']:.3f} |" for t in (R["marco0_escala"]["web_por_torso"] or []))
    vol_l = "\n".join(f"| {k} | {x['dir']:+.1f} % | {x['esq']:+.1f} % |" for k, x in R["volume"].get("por_torso", {}).items())
    crit_l = "\n".join(f"| {k} | {'sim' if ok else 'NÃO'} |" for k, ok in criterios.items())
    pend_arq = texto_pendencias(v)
    if pend_arq is None:
        print(f"AVISO: docs/validacao/pendencias-v{v}.md ausente; a seção 'Desvios e pendências' sai incompleta", file=sys.stderr)
        pend_arq = f"- **Arquivo `docs/validacao/pendencias-v{v}.md` ausente:** desvios e pendências desta versão não registrados."
    pend_med = linhas_medidas(lat, gltf)
    pendencias = pend_arq + ("\n\nMedido nesta execução:\n\n" + "\n".join(pend_med) if pend_med else "")
    gltf_l = (f"{gltf['versao']}, {gltf['arquivos']} arquivos `.glb` (morphs e torso), {gltf['erros']} erros, {gltf['avisos']} avisos"
              if gltf else "não executado")
    md = f"""---
esquema: validacao/1.0
versao_software: {v}
data: {registro['data']}
commit: {registro['commit']}
arvore_suja: {str(arvore_suja).lower()}
desenho_testado: [A, B]
ambiente: {{ os: {registro['ambiente']['os']}, node: "{node}", python: "{py}", navegador: "{registro['ambiente']['navegador']}", webgl: "SwiftShader (software)" }}
parametros: {{ torsos: [t01_simetrico_300, t02_assimetrico, t03_pequeno_ptose], decimacao_alvo_vertices: 40000, geodesica: mmp, config_tepid: "{registro['parametros']['config_tepid']}", config_simulacao: "{registro['parametros']['config_simulacao']}" }}
resultados:
  marco0_erro_max_gabarito_mm: {R['marco0_erro_max_gabarito_mm']}
  marco1_bland_altman: {{ n: {R['marco1_bland_altman']['n']}, vies_mm: {R['marco1_bland_altman']['vies_mm']}, dp_mm: {R['marco1_bland_altman']['dp_mm']}, loa_mm: {R['marco1_bland_altman']['loa_mm']}, criterio_2mm: {str(R['marco1_bland_altman']['criterio_2mm']).lower()} }}
  marco2_latencia_p95_ms: {R['marco2_latencia_p95_ms']}
  marco2_monotonicidade: {str(R['marco2_monotonicidade']).lower()}
  marco2_simetria_max_mm: {R['marco2_simetria_max_mm']}
  testes: {{ web_unit: "{tst(t_web)}", web_e2e: "{tst(t_e2e)}", python: "{tst(t_py)}", contratos: "{tst(t_con)}" }}
status: {status}
---

# Registro de validação — v{v} (consolidado)

Gerado por `bash scripts/validacao.sh` → `scripts/registro_validacao.py` a partir das saídas dos testes (nenhum número digitado à mão). Commit validado: `{registro['commit']}` (`git describe --always --dirty`; árvore {'SUJA — não vale como registro' if arvore_suja else 'limpa'}). Sidecar de máquina: `v{v}.json` (`validacao/1.0`). Só torsos sintéticos paramétricos; nenhum dado de paciente. Registros de componente com o detalhe: [`v{v}-services-mesh.md`](v{v}-services-mesh.md), [`v{v}-web-marcos-0-1.md`](v{v}-web-marcos-0-1.md), [`v{v}-web-marco2-latencia.md`](v{v}-web-marco2-latencia.md).

## Critérios dos marcos

| critério | atingido |
|---|---|
{crit_l}

**Status: {status}.**

## Marco 0 — escala contra o gabarito (±1 mm)

- services/mesh (cálculo, landmarks do gabarito, 3 cenários por torso): erro máx. {R['marco0_escala']['services_mesh_erro_max_mm']} mm.
- apps/web (viewer + pipeline do app, malha processada pelo serviço): erro máx. {R['marco0_escala']['web_viewer_erro_max_mm']} mm.

| torso | caixa torso.obj (mm) | erro caixa na tela (mm) | erro máx. distâncias (mm) |
|---|---|---|---|
{esc_l}

## Marco 1 — landmarks por clique, Bland-Altman (LoA ±2 mm)

- **Geral:** {bam(R['marco1_bland_altman'])}
- **N-IMF (à parte):** {bam(R['marco1_n_imf'])}
- Operador simulado (projeção do gabarito para pixels + jitter uniforme ±1 px), {registro['parametros']['marco1_repeticoes']} repetições × 3 torsos × 7 distâncias × (euclidiana + geodésica MMP). O Bland-Altman com operador humano segue pendente.

## Volume (estimador `plano_base_elipse` v2)

Erro relativo contra o volume adicionado real (malha decimada); máx. |erro| = {R['volume'].get('erro_max_pct', '—')} % (meta ±10 %; faixa ±15 % exibida na UI).

| torso | dir | esq |
|---|---|---|
{vol_l}

## Marco 2 — simulação

- Monotonicidade (volume maior → mamilo mais projetado, 3 torsos × 2 planos × 2 IMF): {'sim' if R['marco2_monotonicidade'] else 'NÃO'}.
- Simetria no torso simétrico: máx. {R['marco2_simetria_max_mm']} mm (critério < 0,1 mm).
- IMF: `manter` move o sulco no máx. {R['marco2_imf'].get('manter_max_mm')} mm (≤ 1); `rebaixar` erra no máx. {R['marco2_imf'].get('rebaixar_erro_max_mm')} mm contra o configurado.
- glTF-Validator (Khronos, `node scripts/validar_gltf.mjs`): {gltf_l}.
- Regressão geométrica (snapshot dos morphs do t01, pytest): {'passou' if R['marco2_regressao'] else 'NÃO passou' if R['marco2_regressao'] is False else '—'}.
- Latência de interação (Chromium headless, **WebGL por software — não é o iPad**), input → quadro rasterizado:

| interação | n | p50 (ms) | p95 (ms) | máx. (ms) |
|---|---|---|---|---|
{lat_l}

## Marco 2b — E2E do upload ao PDF

Playwright contra o stack real (services/mesh + Next.js + Postgres; LLM em mock): upload OBJ → processar → régua → landmarks → medidas → TEPID → 2 implantes + simulação com envelope → anamnese → relatório → PDF baixado e com o texto conferido (versão, parâmetros, simulações mostradas, aviso, placeholder ICP-Brasil; em A, nenhum número calculado).

- Desenho A: {'passou' if R['marco2b_e2e'].get('A') else 'NÃO passou'} · Desenho B: {'passou' if R['marco2b_e2e'].get('B') else 'NÃO passou'}

## Contagem de testes

| suíte | resultado |
|---|---|
| pytest (services/mesh) | {tst(t_py)} |
| Vitest apps/web (unit, API A/B, banco, UI, integração com o serviço real) | {tst(t_web)} |
| Vitest packages/contratos | {tst(t_con)} |
| Playwright apps/web (desenhos A e B; pulados = spec de outro desenho) | {tst(t_e2e)} |

{mudancas}

## Como reproduzir

```bash
pnpm install && bash scripts/mesh.sh venv && bash scripts/mesh.sh torsos
bash scripts/db.sh start criar
bash scripts/validacao.sh          # regenera este registro e os de componente
bash scripts/ci.sh                 # CI completo (lint, testes, e2e, licenças)
```

## Desvios e pendências

{pendencias}
"""
    (DOCS / f"v{v}.md").write_text(md, encoding="utf-8")
    indice = DOCS / "README.md"
    if indice.is_file():
        atualizar_indice(indice, v, linha_indice(v, registro["data"], status, sum(criterios.values()), len(criterios)))
    print(json.dumps({"status": status, "criterios": criterios}, ensure_ascii=False, indent=2))
    return 0 if status == "aprovado" else 1


if __name__ == "__main__":
    sys.exit(main())
