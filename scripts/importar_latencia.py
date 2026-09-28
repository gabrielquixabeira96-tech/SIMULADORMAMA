#!/usr/bin/env python3
"""Importa a medicao de latencia feita na pagina /benchmark (plano A14) e gera o registro de
componente `validacao_componente/web-marco2-latencia` marcado "medido em hardware real".

A pagina (apps/web/src/simulacao/BenchmarkLatencia.tsx) roda no aparelho-alvo (iPad/Safari) o
MESMO roteiro do e2e `apps/web/e2e/latencia.spec.ts` (apps/web/src/simulacao/benchmark.ts) e
oferece o JSON para baixar. Este script NAO mede nada: le as amostras brutas do arquivo, recalcula
p50/p95/max/media (posto mais proximo, o mesmo metodo do spec), confere com os resumos do arquivo
e grava .md + .json. So torso sintetico; nenhum dado de paciente.

Uso:
  python3 scripts/importar_latencia.py <medicao.json> [--rotulo ipad] [--saida docs/validacao]

Saida: <saida>/v<versao>-web-marco2-latencia-hardware[-<rotulo>].{md,json}
(nome diferente do registro do SwiftShader, `v<versao>-web-marco2-latencia.*`, que o
scripts/registro_validacao.py consolida).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESQUEMA = "validacao_componente/web-marco2-latencia"
CHAVES = ("slider", "troca_plano_imf", "troca_implante", "slider_comparacao_2_paineis")
ROTULOS = {
    "slider": "slider antes/depois (1 painel)",
    "troca_plano_imf": "troca de plano / IMF",
    "troca_implante": "troca de implante",
    "geral_1_painel": "todas as interacoes de 1 painel",
    "slider_comparacao_2_paineis": "slider na comparacao lado a lado (2 paineis)",
}


class ErroImportacao(Exception):
    pass


def percentil(xs: list[float], p: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, math.ceil(p / 100 * len(s)) - 1))]


def resumo(xs: list[float]) -> dict:
    if not xs:
        raise ErroImportacao("interacao sem amostras")
    return {
        "n": len(xs),
        "p50_ms": round(percentil(xs, 50), 2),
        "p95_ms": round(percentil(xs, 95), 2),
        "max_ms": round(max(xs), 2),
        "media_ms": round(sum(xs) / len(xs), 2),
    }


def resumir(amostras: dict, metrica: str) -> dict:
    def v(k: str) -> list[float]:
        xs = amostras.get(k)
        if not isinstance(xs, list):
            raise ErroImportacao(f"amostras_ms.{k} ausente")
        out = []
        for a in xs:
            x = a.get(metrica) if isinstance(a, dict) else None
            if not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0:
                raise ErroImportacao(f"amostra invalida em amostras_ms.{k}: {a!r}")
            out.append(float(x))
        return out

    r = {k: resumo(v(k)) for k in CHAVES}
    r["geral_1_painel"] = resumo(v("slider") + v("troca_plano_imf") + v("troca_implante"))
    return {k: r[k] for k in ("slider", "troca_plano_imf", "troca_implante", "geral_1_painel", "slider_comparacao_2_paineis")}


def commit_atual() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ, capture_output=True, text=True, check=True).stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def importar(entrada: dict) -> dict:
    if entrada.get("esquema") != ESQUEMA:
        raise ErroImportacao(f"esquema inesperado: {entrada.get('esquema')!r} (esperado {ESQUEMA})")
    if entrada.get("origem") != "pagina_benchmark":
        raise ErroImportacao("o arquivo nao veio da pagina /benchmark (campo origem)")
    versao = str(entrada.get("versao_software", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+", versao):
        raise ErroImportacao(f"versao_software invalida: {versao!r}")
    maquina = entrada.get("maquina") or {}
    if not maquina.get("user_agent"):
        raise ErroImportacao("maquina.user_agent ausente")
    par = entrada.get("parametros") or {}
    limite = float(par.get("limite_p95_ms", 100))
    limite2 = float(par.get("limite_p95_2_paineis_ms", 85))
    amostras = entrada.get("amostras_ms") or {}
    resultados = resumir(amostras, "rasterizado")
    raf = resumir(amostras, "quadro")
    # os resumos do arquivo tem de bater com as amostras brutas (nada digitado a mao)
    for k, x in (entrada.get("resultados") or {}).items():
        if k in resultados and any(abs(float(x[c]) - resultados[k][c]) > 0.011 for c in ("p50_ms", "p95_ms", "max_ms")):
            raise ErroImportacao(f"resultados.{k} nao confere com as amostras brutas")
    esperado_n = par.get("n_por_interacao") or {}
    for k, n in esperado_n.items():
        if k in resultados and resultados[k]["n"] != n:
            raise ErroImportacao(f"{k}: {resultados[k]['n']} amostras, roteiro pede {n}")
    aprovado = all(resultados[k]["p95_ms"] < limite for k in ("slider", "troca_plano_imf", "troca_implante", "geral_1_painel")) and resultados["slider_comparacao_2_paineis"]["p95_ms"] <= limite2
    return {
        "esquema": ESQUEMA,
        "versao_software": versao,
        "data": str(entrada.get("data") or dt.datetime.now(dt.timezone.utc).date().isoformat()),
        "commit_base": commit_atual(),
        "medido_em_hardware_real": True,
        "origem": "pagina_benchmark",
        "importado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "maquina": maquina,
        "parametros": {**par, "limite_p95_ms": limite, "limite_p95_2_paineis_ms": limite2},
        "resultados": resultados,
        "raf_apos_emissao": raf,
        "amostras_ms": amostras,
        "aprovado": aprovado,
    }


def markdown(r: dict) -> str:
    m = r["maquina"]
    res = r["resultados"]

    def linha(k: str, tab: dict) -> str:
        x = tab[k]
        return f"| {ROTULOS[k]} | {x['n']} | {x['p50_ms']:.1f} | {x['p95_ms']:.1f} | {x['max_ms']:.1f} | {x['media_ms']:.1f} |"

    def aspas(s: object) -> str:
        return json.dumps("" if s is None else str(s), ensure_ascii=False)

    def fm(k: str) -> str:
        x = res[k]
        return f"{{ n: {x['n']}, p50_ms: {x['p50_ms']}, p95_ms: {x['p95_ms']}, max_ms: {x['max_ms']} }}"

    lim, lim2 = r["parametros"]["limite_p95_ms"], r["parametros"]["limite_p95_2_paineis_ms"]
    return f"""---
esquema: {ESQUEMA}
versao_software: {r['versao_software']}
data: {r['data']}
commit_base: {r['commit_base']}
medido_em_hardware_real: true
desenho_testado: [A, B]
ambiente: {{ user_agent: {aspas(m.get('user_agent'))}, webgl_renderer: {aspas(m.get('webgl_renderer'))}, webgl_vendor: {aspas(m.get('webgl_vendor'))}, nucleos_logicos: {m.get('nucleos_logicos')}, device_pixel_ratio: {m.get('device_pixel_ratio')}, viewport: {aspas(m.get('viewport'))}, canvas_px: {aspas(m.get('canvas_px'))} }}
resultados:
  marco2_latencia_p95_ms: {res['geral_1_painel']['p95_ms']}
  slider: {fm('slider')}
  troca_plano_imf: {fm('troca_plano_imf')}
  troca_implante: {fm('troca_implante')}
  slider_comparacao_2_paineis: {fm('slider_comparacao_2_paineis')}
status: {'aprovado' if r['aprovado'] else 'reprovado'}
---

# Validacao do apps/web — Marco 2: latencia medida em HARDWARE REAL (v{r['versao_software']})

**Medido em hardware real** pela pagina `/benchmark` (roteiro de `apps/web/src/simulacao/benchmark.ts`, o mesmo do e2e `apps/web/e2e/latencia.spec.ts`) e importado por `scripts/importar_latencia.py` (p50/p95 recalculados das amostras brutas). So torso sintetico; nenhum dado de paciente.

- Navegador (userAgent): `{m.get('user_agent')}`
- GPU (WEBGL_debug_renderer_info): `{m.get('webgl_renderer')}` ({m.get('webgl_vendor')})
- Nucleos logicos: {m.get('nucleos_logicos')}; devicePixelRatio: {m.get('device_pixel_ratio')}; viewport: {m.get('viewport')}; canvas: {m.get('canvas_px')} px

## Metodo

- Latencia (metrica principal e criterio) = do disparo do evento (input do slider / clique no radio) ate o quadro rasterizado em todos os paineis visiveis (contador de quadros do viewer + rAF seguinte + `readPixels` de 1 px por canvas).
- Cada amostra parte de estado ocioso; {r['parametros'].get('aquecimento_descartado', '?')} interacoes de aquecimento descartadas.
- Criterios: p95 < {lim:g} ms nas interacoes de 1 painel e p95 <= {lim2:g} ms no slider com 2 paineis.

## Resultados (ms)

| interacao | n | p50 | p95 | max. | media |
|---|---|---|---|---|---|
{linha('slider', res)}
{linha('troca_plano_imf', res)}
{linha('troca_implante', res)}
{linha('geral_1_painel', res)}
{linha('slider_comparacao_2_paineis', res)}

**Resultado:** {'criterios ATINGIDOS' if r['aprovado'] else 'algum p95 acima do limite: criterio NAO ATINGIDO'} neste aparelho.

Secundaria — input ate o rAF apos o quadro emitido (nao espera a GPU):

| interacao | n | p50 | p95 | max. | media |
|---|---|---|---|---|---|
{linha('slider', r['raf_apos_emissao'])}
{linha('troca_plano_imf', r['raf_apos_emissao'])}
{linha('troca_implante', r['raf_apos_emissao'])}
{linha('slider_comparacao_2_paineis', r['raf_apos_emissao'])}

## Como reproduzir

1. No servidor: `BENCHMARK_HABILITADO=1` no `.env` (desligado por padrao) e reiniciar o app.
2. No aparelho: abrir `/benchmark` (com o token local, ADR 0003), tocar em "Rodar benchmark" e baixar o JSON.
3. `python3 scripts/importar_latencia.py <arquivo>.json --rotulo <aparelho>`.
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("entrada", type=Path)
    ap.add_argument("--rotulo", default="", help="sufixo do arquivo (ex.: ipad); so [a-z0-9-]")
    ap.add_argument("--saida", type=Path, default=RAIZ / "docs" / "validacao")
    a = ap.parse_args(argv)
    if a.rotulo and not re.fullmatch(r"[a-z0-9-]+", a.rotulo):
        print("--rotulo so aceita [a-z0-9-]", file=sys.stderr)
        return 2
    try:
        r = importar(json.loads(a.entrada.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, ErroImportacao, KeyError, TypeError, ValueError) as e:
        print(f"importar_latencia: {e}", file=sys.stderr)
        return 1
    a.saida.mkdir(parents=True, exist_ok=True)
    base = a.saida / f"v{r['versao_software']}-web-marco2-latencia-hardware{'-' + a.rotulo if a.rotulo else ''}"
    (base.parent / f"{base.name}.json").write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (base.parent / f"{base.name}.md").write_text(markdown(r), encoding="utf-8")
    print(f"{base}.md ({'aprovado' if r['aprovado'] else 'reprovado'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
