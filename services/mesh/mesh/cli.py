"""CLI do services/mesh.

  python -m mesh.cli torso --preset t01_simetrico_300 --saida data/sinteticos
  python -m mesh.cli torso --parametros p.json --saida data/sinteticos
  python -m mesh.cli torso --todos --saida data/sinteticos [--se-desatualizado]
  python -m mesh.cli morphs --todos --sinteticos data/sinteticos [--catalogo arq.json] [--implantes a,b]
  python -m mesh.cli validar --sinteticos data/sinteticos [--relatorio docs/validacao/<arquivo>.md]
  python -m mesh.cli foto-sintetica --todos --sinteticos data/sinteticos [--vistas frente,obliqua_dir,perfil_dir]
  python -m mesh.cli reconstruir --sintetico data/sinteticos/t01_simetrico_300 --saida <dir> [--vistas ...] [--avaliar]
  python -m mesh.cli fotos-exemplo --todos --sinteticos data/sinteticos [--se-desatualizado]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from mesh import esquemas


def _cmd_torso(a: argparse.Namespace) -> int:
    from mesh.sintetico.gerador import gerar_torso, torso_atualizado

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
        if a.se_desatualizado and torso_atualizado(saida / p["nome"], p):
            print(f"[ok] {p['nome']}: atualizado (textura {esquemas.completar_parametros(p)['textura']['realismo']}); "
                  "nada a regerar")
            continue
        g = gerar_torso(p, saida, escrever_densa=not a.sem_densa)
        d = g["distancias"]
        print(f"[ok] {g['nome']}: {g['malha']['decimada']['n_vertices']} vertices (decimada), "
              f"SSN-N dir {d['ssn_n_dir']['euclidiana_mm']:.2f}/{d['ssn_n_dir']['geodesica_mm']:.2f} mm, "
              f"volume dir/esq {g['volumes']['dir']['adicionado_ml']}/{g['volumes']['esq']['adicionado_ml']} mL "
              f"-> {saida / g['nome']} ({g['_duracao_s']} s)")
    return 0


def _cmd_morphs(a: argparse.Namespace) -> int:
    import uuid

    from mesh.simulacao import catalogo
    from mesh.simulacao.morphs import gerar_morphs

    if a.todos:
        pastas = [Path(a.sinteticos) / n for n in esquemas.presets_torso()]
    elif a.sintetico:
        pastas = [Path(a.sintetico)]
    else:
        print("informe --sintetico <pasta> ou --todos", file=sys.stderr)
        return 2
    todos, avisos = catalogo.carregar([Path(c) for c in a.catalogo] if a.catalogo else None)
    for av in avisos:
        print(f"[aviso] {av}", file=sys.stderr)
    ids = a.implantes.split(",") if a.implantes else list(todos)
    faltando = [i for i in ids if i not in todos]
    if faltando:
        print(f"implantes fora do catalogo: {faltando}", file=sys.stderr)
        return 2
    for pasta in pastas:
        gab = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
        m = gerar_morphs(pasta, gab["landmarks"], [todos[i] for i in ids], lados=a.lados,
                         malha_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"mesh:sinteticos/{gab['nome']}")),
                         arquivo_obj="torso.obj", arquivo_glb="torso.glb", quadro="anatomico")
        tam = sum(m["_bytes"].values()) / 1e6
        print(f"[ok] {gab['nome']}: {m['_n_targets']} targets em {len(m['arquivos'])} .glb ({tam:.1f} MB) "
              f"-> {pasta / 'morphs'} ({m['_duracao_s']} s)")
    return 0


def _cmd_validar(a: argparse.Namespace) -> int:
    from mesh.validacao import _markdown_marco2, metricas_marco2, relatorio_marco0

    res = relatorio_marco0(Path(a.sinteticos), gerar_se_faltar=True)
    print(json.dumps(res["resumo"], ensure_ascii=False, indent=2))
    cat = Path(a.catalogo_morphs)
    m2 = metricas_marco2(Path(a.sinteticos), cat)
    print(json.dumps({k: v for k, v in m2.items() if k != "series"}, ensure_ascii=False, indent=2))
    if a.relatorio:
        md = res["markdown"].replace("<!-- MARCO2 -->", _markdown_marco2(m2, cat.name))
        Path(a.relatorio).write_text(md, encoding="utf-8")
        print(f"[ok] relatorio em {a.relatorio}")
    return 0 if res["resumo"]["aprovado_marco0"] and m2["monotonicidade"] else 1


def _cmd_foto_sintetica(a: argparse.Namespace) -> int:
    from mesh.foto.sintetica import fotos_sinteticas

    pastas = [Path(a.sinteticos) / n for n in esquemas.presets_torso()] if a.todos else [Path(a.sintetico)]
    vistas = tuple(a.vistas.split(","))
    for pasta in pastas:
        regs = fotos_sinteticas(pasta, vistas, largura=a.largura)
        for v, r in regs.items():
            print(f"[ok] {pasta.name}/{r['arquivo']}: {r['largura_px']}x{r['altura_px']} px, "
                  f"focal {r['focal_35mm']:.1f} mm (35 mm eq.), {len(r['visiveis'])}/10 landmarks visiveis ({v})")
    return 0


def reconstruir_sintetico(pasta: Path, saida: Path, vistas, segmentar: bool = False) -> dict:
    """Reconstroi um torso sintetico a partir das fotos sinteticas (`pasta/fotos/`, geradas por
    `foto-sintetica`) pelo pipeline real (`servico.reconstruir_foto`, desenho B): landmarks 2D exatos (na
    frontal todos; nas outras vistas os visiveis), mascara exata (ou a segmentacao com `segmentar`) e escala
    `ssn_n_fita` do gabarito. `saida` e a pasta da malha (recriada); DATA_DIR passa a ser `saida.parent`.
    Devolve o `reconstrucao/1.0`."""
    import os
    import shutil

    from mesh import servico

    g = json.loads((pasta / "gabarito.json").read_text(encoding="utf-8"))
    saida = Path(saida).resolve()
    if saida.exists():
        shutil.rmtree(saida)
    os.environ["DATA_DIR"] = str(saida.parent)
    (saida / "original").mkdir(parents=True, exist_ok=True)
    fotos = []
    for v in vistas:
        reg = json.loads((pasta / "fotos" / f"registro_{v}.json").read_text(encoding="utf-8"))
        shutil.copy(pasta / reg["arquivo"], saida / "original" / f"foto_{v}.jpg")
        ids = list(reg["landmarks_2d"]) if v == "frente" else reg["visiveis"]
        item = {"vista": v, "arquivo": f"original/foto_{v}.jpg", "largura_px": reg["largura_px"],
                "altura_px": reg["altura_px"], "focal_35mm": reg["focal_35mm"],
                "landmarks_2d": {k: reg["landmarks_2d"][k] for k in ids}}
        if not segmentar:
            shutil.copy(pasta / reg["mascara"], saida / "original" / f"mascara_{v}.png")
            item["mascara"] = f"original/mascara_{v}.png"
        fotos.append(item)
    req = {"malha_dir": saida.name, "fotos": fotos,
           "escala": {"metodo": "ssn_n_fita", "valor_mm": g["distancias"]["ssn_n_dir"]["euclidiana_mm"], "lado": "dir"}}
    return servico.reconstruir_foto(req)["reconstrucao"]


def _cmd_reconstruir(a: argparse.Namespace) -> int:
    """Reconstroi um torso sintetico a partir das fotos sinteticas e grava a malha em --saida (fora de
    DATA_DIR: so para inspecao); com --avaliar, grava tambem avaliacao.json contra o gabarito."""
    pasta = Path(a.sintetico)
    r = reconstruir_sintetico(pasta, Path(a.saida), a.vistas.split(","), a.segmentar)
    print(json.dumps({k: r[k] for k in ("reprojecao_rms_px", "residuo_silhueta_mm", "incerteza_por_eixo_mm",
                                        "incerteza_volume_pct", "qualidade", "avisos", "estimado")},
                     ensure_ascii=False, indent=2))
    print(f"[ok] {Path(a.saida).resolve()}/reconstrucao.json ({r['diagnostico']['tempos_reconstrucao']['total_s']} s)")
    if a.avaliar:
        from mesh.foto.avaliar import avaliar_reconstrucao

        av = avaliar_reconstrucao(Path(a.saida), pasta)
        print(json.dumps({k: av[k] for k in ("rms_mm", "volume_erro_pct", "landmarks_erro_mm", "reprojecao_rms_px")},
                         ensure_ascii=False))
    return 0


# "Fotos de exemplo" da demo (plano foto3d, P4-lite): variante -> vistas. A variante so frontal vai so
# para o t01 (profundidade "so ilustracao", o caso sem perfil).
VARIANTES_FOTO = {"foto": ("frente", "obliqua_dir", "perfil_dir"), "foto_frente": ("frente",)}
VARIANTES_POR_TORSO = {"t01_simetrico_300": ("foto", "foto_frente")}


def _impressao_codigo() -> str:
    """sha256 do codigo que produz as fotos de exemplo (mesh/foto, superficie, textura, projecao): mudou o
    codigo, as pastas `foto*/` ficam desatualizadas."""
    import hashlib

    base = Path(__file__).resolve().parent
    h = hashlib.sha256()
    for f in sorted([*base.joinpath("foto").glob("*.py"), base / "sintetico" / "superficie.py",
                     base / "sintetico" / "textura_pele.py", base / "sintetico" / "gerador.py"]):
        h.update(f.name.encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def _cmd_fotos_exemplo(a: argparse.Namespace) -> int:
    """Prepara `<torso>/foto/` (frente + oblíqua D + perfil D) e, no t01, `<torso>/foto_frente/` pelo pipeline
    real: fotos sinteticas -> /reconstruir-foto (ajuste + textura projetada) -> avaliacao.json contra o gabarito.
    Com --se-desatualizado, pula a variante cuja avaliacao.json ja corresponde ao gabarito e ao codigo atuais."""
    import time

    from mesh.foto.avaliar import avaliar_reconstrucao, sha256_gabarito
    from mesh.foto.sintetica import fotos_sinteticas

    base = Path(a.sinteticos)
    nomes = list(esquemas.presets_torso()) if a.todos else [a.torso]
    impressao = _impressao_codigo()
    for nome in nomes:
        pasta = base / nome
        if not (pasta / "gabarito.json").is_file():
            print(f"[erro] {pasta}: torso sintetico ausente (rode mesh.cli torso)", file=sys.stderr)
            return 1
        gab_sha = sha256_gabarito(pasta)
        variantes = VARIANTES_POR_TORSO.get(nome, ("foto",))
        fotos_ok = False
        for var in variantes:
            saida = pasta / var
            av_p = saida / "avaliacao.json"
            if a.se_desatualizado and av_p.is_file() and (saida / "reconstrucao.json").is_file():
                av = json.loads(av_p.read_text(encoding="utf-8"))
                if av.get("gabarito_sha256") == gab_sha and av.get("codigo_sha256") == impressao:
                    print(f"[ok] {nome}/{var}: atualizado (pulado)")
                    continue
            if not fotos_ok:
                fotos_sinteticas(pasta, VARIANTES_FOTO["foto"], largura=a.largura)
                fotos_ok = True
            t0 = time.perf_counter()
            rec = reconstruir_sintetico(pasta, saida, VARIANTES_FOTO[var])
            av = avaliar_reconstrucao(saida, pasta, gravar=False)
            av["codigo_sha256"] = impressao
            av_p.write_text(json.dumps(av, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            rms, vol = av["rms_mm"], av["volume_erro_pct"]
            print(f"[ok] {nome}/{var}: {len(rec['fotos'])} foto(s), rms x/y/z {rms['x']:.2f}/{rms['y']:.2f}/"
                  f"{rms['z']:.2f} mm, volume D/E {vol['dir']:+.1f}/{vol['esq']:+.1f} %, landmarks max "
                  f"{av['landmarks_erro_mm']['max']:.2f} mm, reprojecao {av['reprojecao_rms_px']:.2f} px, "
                  f"cobertura {rec['cobertura_observada_pct']:.1f} %, {time.perf_counter() - t0:.0f} s")
    return 0


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
    t.add_argument("--se-desatualizado", action="store_true",
                   help="so regera se faltar arquivo, se o gabarito nao tiver textura.esquema (torsos da v0.1.x) "
                        "ou se os parametros/versao mudaram")
    t.set_defaults(func=_cmd_torso)
    mo = sub.add_parser("morphs", help="pre-computa morph targets (contratos §10) de torsos sinteticos")
    gm = mo.add_mutually_exclusive_group()
    gm.add_argument("--sintetico", help="pasta de um torso (com gabarito.json e torso.obj)")
    gm.add_argument("--todos", action="store_true", help="os 3 presets em --sinteticos")
    mo.add_argument("--sinteticos", default="data/sinteticos")
    mo.add_argument("--catalogo", action="append", help="arquivo(s) catalogo/1.0; padrao: config/catalogo/*.json")
    mo.add_argument("--implantes", help="ids separados por virgula; padrao: todos do catalogo")
    mo.add_argument("--lados", choices=["ambos", "separados"], default="separados")
    mo.set_defaults(func=_cmd_morphs)
    v = sub.add_parser("validar", help="mede os 3 torsos presets e gera o relatorio do Marco 0/1")
    v.add_argument("--sinteticos", default="data/sinteticos")
    v.add_argument("--relatorio", default=None)
    v.add_argument("--catalogo-morphs", default=str(Path(__file__).resolve().parents[1] / "tests" / "fixtures"
                                                   / "catalogo_teste.json"))
    v.set_defaults(func=_cmd_validar)
    fs = sub.add_parser("foto-sintetica", help="fotos sinteticas (jpg + mascara + registro) de torsos sinteticos")
    gf = fs.add_mutually_exclusive_group(required=True)
    gf.add_argument("--sintetico", help="pasta de um torso (com gabarito.json, torso.obj, textura.png)")
    gf.add_argument("--todos", action="store_true", help="os 3 presets em --sinteticos")
    fs.add_argument("--sinteticos", default="data/sinteticos")
    fs.add_argument("--vistas", default="frente,obliqua_dir,perfil_dir")
    fs.add_argument("--largura", type=int, default=2000)
    fs.set_defaults(func=_cmd_foto_sintetica)
    rc = sub.add_parser("reconstruir", help="reconstroi um torso sintetico a partir das fotos sinteticas")
    rc.add_argument("--sintetico", required=True)
    rc.add_argument("--saida", required=True, help="pasta da malha reconstruida (criada)")
    rc.add_argument("--vistas", default="frente,obliqua_dir,perfil_dir")
    rc.add_argument("--segmentar", action="store_true", help="ignora a mascara exata e segmenta (sem pesos)")
    rc.add_argument("--avaliar", action="store_true", help="grava avaliacao.json contra o gabarito")
    rc.set_defaults(func=_cmd_reconstruir)
    fe = sub.add_parser("fotos-exemplo", help="fotos de exemplo da demo: <torso>/foto[_frente]/ pelo pipeline real")
    ge = fe.add_mutually_exclusive_group(required=True)
    ge.add_argument("--torso", help="nome de um preset")
    ge.add_argument("--todos", action="store_true")
    fe.add_argument("--sinteticos", default="data/sinteticos")
    fe.add_argument("--largura", type=int, default=2000)
    fe.add_argument("--se-desatualizado", action="store_true")
    fe.set_defaults(func=_cmd_fotos_exemplo)
    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
