#!/usr/bin/env bash
# Regenera THIRD_PARTY_LICENSES.md a partir das dependencias instaladas (ADR 0009) e FALHA se
# alguma licenca estiver fora da lista permitida (qualquer GPL/LGPL/AGPL e afins).
# - Node: `pnpm licenses list --json` (workspace inteiro, prod + dev).
# - Python: `pip-licenses` do services/mesh/.venv. Sem venv, a secao Python existente e PRESERVADA
#   (so ao regenerar; com --checar, sem venv FALHA).
# - Falha tambem se `pnpm licenses list` falhar ou vier vazio.
# - Paragrafos escritos a mao (linhas fora das tabelas) de cada secao gerada sao preservados.
# Uso: bash scripts/licencas.sh [--checar]   (--checar: so verifica, nao reescreve o arquivo)
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
SAIDA="THIRD_PARTY_LICENSES.md"
CHECAR=0
[[ "${1:-}" == "--checar" ]] && CHECAR=1

NODE_JSON="$(mktemp)"; PY_JSON="$(mktemp)"; NODE_ERR="$(mktemp)"
trap 'rm -f "$NODE_JSON" "$PY_JSON" "$NODE_ERR"' EXIT
erro() { echo "ERRO (licencas.sh): $*" >&2; exit 1; }
# Inventario Node: falha se o comando falhar ou vier vazio (nunca "verde" sem inventario; revisao v0.1.1).
[[ -f pnpm-lock.yaml ]] || erro "pnpm-lock.yaml ausente"
command -v pnpm >/dev/null || erro "pnpm ausente"
pnpm licenses list --json > "$NODE_JSON" 2> "$NODE_ERR" || { cat "$NODE_ERR" >&2; erro "'pnpm licenses list' falhou"; }
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(d,dict) and sum(len(v) for v in d.values())>0 else 1)' "$NODE_JSON" \
  || erro "'pnpm licenses list' devolveu inventario vazio ou invalido"
# Inventario Python: obrigatorio no modo --checar (a CI cria o venv ANTES desta etapa).
if [[ -x services/mesh/.venv/bin/pip-licenses ]]; then
  services/mesh/.venv/bin/pip-licenses --format=json --with-urls --order=name > "$PY_JSON" || erro "pip-licenses falhou"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(d,list) and d else 1)' "$PY_JSON" \
    || erro "pip-licenses devolveu inventario vazio"
elif [[ $CHECAR -eq 1 ]]; then
  erro "services/mesh/.venv sem pip-licenses: rode 'bash scripts/mesh.sh venv' antes de checar"
else
  echo 'null' > "$PY_JSON"
fi

python3 - "$NODE_JSON" "$PY_JSON" "$SAIDA" "$CHECAR" "$(tr -d '[:space:]' < VERSION)" <<'PY'
import json, re, sys, datetime, os
node_json, py_json, saida, checar, versao = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1", sys.argv[5]

# Identificadores aceitos (ADR 0009) e sinonimos usados por pip-licenses/pnpm.
PERMITIDAS = {
    "MIT", "MIT-0", "MIT License", "MIT-CMU", "BSD", "BSD License", "BSD-2-Clause", "BSD-3-Clause",
    "Apache-2.0", "Apache 2.0", "Apache Software License", "Apache License 2.0", "ISC", "ISC License (ISCL)",
    "0BSD", "Zlib", "PostgreSQL", "Python-2.0", "PSF-2.0", "Python Software Foundation License",
    "MPL-2.0", "Mozilla Public License 2.0 (MPL 2.0)", "Unlicense", "CC0-1.0", "CC-BY-4.0", "BlueOak-1.0.0",
}
PROPRIOS = {"mesh", "web", "@simulador/contratos", "simulador-mamario"}

def licenca_ok(lic: str) -> bool:
    if lic.strip() in PERMITIDAS:
        return True
    s = lic.strip().strip("()")
    if re.search(r"\b(A?GPL|LGPL|SSPL|BUSL|CC-BY-NC|Commons Clause)", s, re.I):
        return False
    partes = [p.strip().strip("()") for p in re.split(r"\s+(?:AND|OR)\s+|;\s*", s) if p.strip()]
    return bool(partes) and all(p in PERMITIDAS for p in partes)

node = json.load(open(node_json)) or {}
py = json.load(open(py_json))

problemas = []
linhas_node = []
contagem_node = {}
for lic, pacotes in sorted(node.items()):
    for p in pacotes:
        if p["name"] in PROPRIOS:
            continue
        contagem_node[lic] = contagem_node.get(lic, 0) + 1
        linhas_node.append((p["name"], ", ".join(p.get("versions", [])), lic))
        if not licenca_ok(lic):
            problemas.append(f"node: {p['name']} ({lic})")
linhas_node.sort(key=lambda x: x[0].lower())

linhas_py = None
if py is not None:
    linhas_py = []
    for p in py:
        if p["Name"] in PROPRIOS:
            continue
        linhas_py.append((p["Name"], p["Version"], p["License"], p.get("URL", "")))
        if not licenca_ok(p["License"]):
            problemas.append(f"python: {p['Name']} ({p['License']})")

# ---- secoes existentes (para preservar texto manual) ----
anterior = open(saida, encoding="utf-8").read() if os.path.exists(saida) else ""
def secao(titulo_prefixo: str) -> str | None:
    m = re.search(r"^## " + re.escape(titulo_prefixo) + r".*?(?=^## |\Z)", anterior, re.M | re.S)
    return m.group(0) if m else None
def prosa(bloco: str | None) -> str:
    if not bloco:
        return ""
    corpo = bloco.split("\n", 1)[1] if "\n" in bloco else ""
    linhas = [l for l in corpo.splitlines() if not l.startswith("|") and not l.startswith("_Gerado")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(linhas)).strip()

agora = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
out = []
out.append("# Licenças de terceiros\n")
out.append(f"Gerado por `scripts/licencas.sh` em {agora} para a versão {versao}. Política: ADR 0009 (`docs/adr/0009-licencas.md`). "
           "O script falha se alguma dependência instalada tiver licença fora da lista abaixo.\n")
out.append("## Permitidas\n")
out.append("MIT, MIT-0, BSD-2/3-Clause, Apache-2.0, ISC, 0BSD, Zlib, PostgreSQL, Python-2.0/PSF-2.0, MIT-CMU (HPND), BlueOak-1.0.0, Unlicense, "
           "MPL-2.0 (arquivo separado, sem modificação), CC0-1.0 / CC-BY-4.0 (dados/assets, com atribuição). Expressões AND/OR só se todos os termos forem permitidos.\n")
out.append("## Proibidas (nunca presentes)\n")
out.append("RBSM, iRBSM, liRBSM; SMPL, SMPL-X e topologias derivadas; Depth Anything 2 Base/Large; Depth Anything 3 Giant/Large/Nested; FLUX dev; "
           "VGGT original; SAM 3D Body (\"SAM License\"); `pymeshlab` (GPL-3); `gdist` (LGPL); `sharp`/libvips (LGPL-3.0, removido por override no "
           "`pnpm-workspace.yaml`); qualquer GPL/LGPL/AGPL/SSPL/BUSL/CC-NC/\"research only\".\n")

out.append("## Node (apps/web, packages/*) — instaladas\n")
nota_node = prosa(secao("Node"))
if nota_node:
    out.append(nota_node + "\n")
resumo = " · ".join(f"{k} {v}" for k, v in sorted(contagem_node.items(), key=lambda x: -x[1]))
out.append(f"_Gerado de `pnpm licenses list`: {len(linhas_node)} pacotes ({resumo})._\n")
out.append("| Pacote | Versão | Licença |\n|---|---|---|")
out.extend(f"| {n} | {v} | {l} |" for n, v, l in linhas_node)
out.append("")

out.append("## services/mesh (Python 3.11) — instaladas\n")
bloco_py = secao("services/mesh")
if linhas_py is None:
    if bloco_py:
        out.append(bloco_py.split("\n", 1)[1].strip() + "\n")  # preservada sem alteração (sem venv)
    else:
        out.append("_sem venv do services/mesh (bash scripts/mesh.sh venv)_\n")
else:
    nota_py = prosa(bloco_py)
    if nota_py:
        out.append(nota_py + "\n")
    out.append(f"_Gerado de `pip-licenses` em `services/mesh/.venv`: {len(linhas_py)} pacotes._\n")
    out.append("| Pacote | Versão | Licença | URL |\n|---|---|---|---|")
    out.extend(f"| {n} | {v} | {l} | {u} |" for n, v, l, u in linhas_py)
    out.append("")

texto = "\n".join(out).rstrip() + "\n"
if problemas:
    print("ATENCAO: licencas fora da lista permitida (ADR 0009):", file=sys.stderr)
    for p in problemas:
        print("  - " + p, file=sys.stderr)
if not checar:
    open(saida, "w", encoding="utf-8").write(texto)
    print(f"{saida} regenerado: node={len(linhas_node)} python={'preservado' if linhas_py is None else len(linhas_py)}")
sys.exit(1 if problemas else 0)
PY
