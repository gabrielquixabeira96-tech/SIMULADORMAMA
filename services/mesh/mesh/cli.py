"""CLI do services/mesh.

  python -m mesh.cli torso --preset t01_simetrico_300 --saida data/sinteticos
  python -m mesh.cli torso --parametros p.json --saida data/sinteticos
  python -m mesh.cli torso --todos --saida data/sinteticos
  python -m mesh.cli validar --sinteticos data/sinteticos [--relatorio docs/validacao/<arquivo>.md]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from mesh import esquemas


def _cmd_torso(a: argparse.Namespace) -> int:
    from mesh.sintetico.gerador import gerar_torso

    presets = esquemas.presets_torso()
    if a.todos:
        lista = list(presets.values())
    elif a.preset:
        if a.preset not in presets:
            print(f"preset desconhecido: {a.preset} (disponiveis: {', '.join(presets)})", file=sys.stderr)
            return 2
        lista = [presets[a.preset]]
    elif a.parametros:
        lista = [json.loads(Path(a.parametros).read_text(encoding="utf-8"))]
    else:
        print("informe --preset, --parametros ou --todos", file=sys.stderr)
        return 2
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)
    for p in lista:
        g = gerar_torso(p, saida, escrever_densa=not a.sem_densa)
        d = g["distancias"]
        print(f"[ok] {g['nome']}: {g['malha']['decimada']['n_vertices']} vertices (decimada), "
              f"SSN-N dir {d['ssn_n_dir']['euclidiana_mm']:.2f}/{d['ssn_n_dir']['geodesica_mm']:.2f} mm, "
              f"volume dir/esq {g['volumes']['dir']['adicionado_ml']}/{g['volumes']['esq']['adicionado_ml']} mL "
              f"-> {saida / g['nome']} ({g['_duracao_s']} s)")
    return 0


def _cmd_validar(a: argparse.Namespace) -> int:
    from mesh.validacao import relatorio_marco0

    res = relatorio_marco0(Path(a.sinteticos), gerar_se_faltar=True)
    print(json.dumps(res["resumo"], ensure_ascii=False, indent=2))
    if a.relatorio:
        Path(a.relatorio).write_text(res["markdown"], encoding="utf-8")
        print(f"[ok] relatorio em {a.relatorio}")
    return 0 if res["resumo"]["aprovado_marco0"] else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m mesh.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("torso", help="gera torso sintetico + gabarito (contratos §4)")
    g = t.add_mutually_exclusive_group()
    g.add_argument("--preset")
    g.add_argument("--parametros")
    g.add_argument("--todos", action="store_true")
    t.add_argument("--saida", default="data/sinteticos")
    t.add_argument("--sem-densa", action="store_true", help="nao grava denso.obj")
    t.set_defaults(func=_cmd_torso)
    v = sub.add_parser("validar", help="mede os 3 torsos presets e gera o relatorio do Marco 0/1")
    v.add_argument("--sinteticos", default="data/sinteticos")
    v.add_argument("--relatorio", default=None)
    v.set_defaults(func=_cmd_validar)
    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
