#!/usr/bin/env bash
# Regenera THIRD_PARTY_LICENSES.md a partir das dependencias instaladas (ADR 0009).
# Requer: pnpm (web) e services/mesh/.venv com pip-licenses (MIT). Passos sem alvo sao pulados.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
SAIDA="THIRD_PARTY_LICENSES.md"
PERMITIDAS='^(MIT|BSD-2-Clause|BSD-3-Clause|BSD|Apache-2.0|Apache 2.0|Apache Software License|ISC|0BSD|Zlib|PostgreSQL|Python-2.0|Python Software Foundation License|MPL-2.0|Unlicense|CC0-1.0|CC-BY-4.0|\(MIT OR Apache-2.0\)|\(MIT OR CC0-1.0\)|MIT OR Apache-2.0|BlueOak-1.0.0)$'

{
  echo "# Licenças de terceiros"
  echo
  echo "Gerado por \`scripts/licencas.sh\` em $(date -u +%Y-%m-%dT%H:%M:%SZ) para a versão $(tr -d '[:space:]' < VERSION)."
  echo "Política: ADR 0009 (\`docs/adr/0009-licencas.md\`). Apenas MIT, BSD, Apache-2.0, ISC, 0BSD, Zlib, PostgreSQL, Python-2.0, MPL-2.0 (sem modificação), CC0/CC-BY-4.0."
  echo
  echo "## Proibidos (nunca presentes)"
  echo
  echo "RBSM, iRBSM, liRBSM; SMPL/SMPL-X e topologias derivadas; Depth Anything 2 Base/Large; Depth Anything 3 Giant/Large/Nested; FLUX dev; VGGT original; SAM 3D Body; pymeshlab (GPL); qualquer GPL/AGPL/SSPL/BUSL/CC-NC."
  echo
  echo "## Node (apps/web, packages/*)"
  echo
  if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null; then
    echo '| Pacote | Versão | Licença |'; echo '|---|---|---|'
    pnpm licenses list --json --long 2>/dev/null | python3 -c '
import json,sys
d=json.load(sys.stdin)
for lic,pk in sorted(d.items()):
    for p in pk:
        print(f"| {p[\"name\"]} | {\", \".join(p.get(\"versions\",[]))} | {lic} |")'
  else
    echo "_ainda sem dependências Node instaladas (pnpm-lock.yaml ausente)_"
  fi
  echo
  echo "## Python (services/mesh)"
  echo
  if [[ -x services/mesh/.venv/bin/pip-licenses ]]; then
    services/mesh/.venv/bin/pip-licenses --format=markdown --with-urls --order=name
  else
    echo "_ainda sem venv do services/mesh (pip install pip-licenses no venv)_"
  fi
} > "$SAIDA"

# checagem: licencas fora da lista
if grep -E '^\| ' "$SAIDA" | grep -vE '^\| (Pacote|Name|---)' | awk -F'|' '{print $4}' | sed 's/^ *//;s/ *$//' | grep -vE "$PERMITIDAS" | grep -v '^$' ; then
  echo "ATENCAO: licencas fora da lista permitida acima (ADR 0009). Revisar." >&2
  exit 1
fi
echo "$SAIDA regenerado"
