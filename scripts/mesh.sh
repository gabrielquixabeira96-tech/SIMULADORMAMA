#!/usr/bin/env bash
# Atalhos do services/mesh (Python). Uso: bash scripts/mesh.sh <venv|dev|torsos|fotos|test>
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
# torsos: regera so o preset desatualizado (sem gabarito, sem `textura.esquema` — torsos da v0.1.x com a
# textura neutra —, com parametros ou versao diferentes); MESH_TORSOS_FORCAR=1 regera todos. Regerar um
# torso apaga os morphs/ dele (a CI e o demo_sandbox.sh os refazem quando faltam).
cmd_torsos() {
  [[ -x "$PY" ]] || cmd_venv
  local se=(--se-desatualizado)
  [[ "${MESH_TORSOS_FORCAR:-0}" == "1" ]] && se=()
  cd "$DIR" && for p in t01_simetrico_300 t02_assimetrico t03_pequeno_ptose; do
    "$PY" -m mesh.cli torso --preset "$p" --saida "${DATA_DIR:-$RAIZ/data}/sinteticos" "${se[@]}"
  done
}
# fotos: "fotos de exemplo" da demo (plano foto3d) pelo pipeline real — fotos sinteticas de cada torso
# (frente, obliqua D, perfil D) -> /reconstruir-foto (ajuste do template + foto projetada no atlas) ->
# avaliacao.json contra o gabarito, em <torso>/foto/ (e <t01>/foto_frente/, so a frontal). Pula a pasta
# cuja avaliacao ja corresponde ao gabarito e ao codigo atuais; MESH_FOTOS_FORCAR=1 refaz todas. Exige os
# torsos (rode `torsos` antes).
cmd_fotos() {
  [[ -x "$PY" ]] || cmd_venv
  local se=(--se-desatualizado)
  [[ "${MESH_FOTOS_FORCAR:-0}" == "1" ]] && se=()
  cd "$DIR" && "$PY" -m mesh.cli fotos-exemplo --todos --sinteticos "${DATA_DIR:-$RAIZ/data}/sinteticos" "${se[@]}"
}
cmd_test()   { [[ -x "$PY" ]] || cmd_venv; cd "$DIR" && "$PY" -m ruff check . && "$PY" -m pytest -q; }

case "${1:-}" in
  venv) cmd_venv ;; dev) cmd_dev ;; torsos) cmd_torsos ;; fotos) cmd_fotos ;; test) cmd_test ;;
  *) echo "uso: $0 <venv|dev|torsos|fotos|test>" >&2; exit 2 ;;
esac
