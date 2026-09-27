#!/usr/bin/env bash
# Atalhos do services/mesh (Python). Uso: bash scripts/mesh.sh <venv|dev|torsos|test>
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$RAIZ/services/mesh"
PY="$DIR/.venv/bin/python"
PORTA="${MESH_PORT:-8765}"

[[ -f "$DIR/pyproject.toml" ]] || { echo "services/mesh/pyproject.toml ainda nao existe (agente Python)" >&2; exit 1; }

cmd_venv() {
  [[ -x "$PY" ]] || python3 -m venv "$DIR/.venv"
  "$PY" -m pip install -q --upgrade pip
  "$PY" -m pip install -q -e "$DIR[dev]"
  echo "venv pronto em $DIR/.venv"
}
cmd_dev()    { [[ -x "$PY" ]] || cmd_venv; cd "$DIR" && DATA_DIR="${DATA_DIR:-$RAIZ/data}" "$PY" -m mesh.servidor --host 127.0.0.1 --port "$PORTA"; }
cmd_torsos() { [[ -x "$PY" ]] || cmd_venv; cd "$DIR" && for p in t01_simetrico_300 t02_assimetrico t03_pequeno_ptose; do "$PY" -m mesh.cli torso --preset "$p" --saida "${DATA_DIR:-$RAIZ/data}/sinteticos"; done; }
cmd_test()   { [[ -x "$PY" ]] || cmd_venv; cd "$DIR" && "$PY" -m ruff check . && "$PY" -m pytest -q; }

case "${1:-}" in
  venv) cmd_venv ;; dev) cmd_dev ;; torsos) cmd_torsos ;; test) cmd_test ;;
  *) echo "uso: $0 <venv|dev|torsos|test>" >&2; exit 2 ;;
esac
