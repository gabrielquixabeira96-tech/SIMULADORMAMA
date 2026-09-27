#!/usr/bin/env bash
# Gera o registro de validacao da versao corrente (RDC 657 art. 5; contratos §15) POR COMANDO:
#  1. services/mesh: Marco 0 (escala ±1 mm), Bland-Altman do pipeline, volume, Marco 2 (monotonicidade,
#     simetria, IMF, pre-computo) → docs/validacao/v<V>-services-mesh.{md,json}
#  2. pytest (junit), Vitest web e contratos (json), Playwright completo (json) com os relatorios de
#     componente do web → docs/validacao/v<V>-web-marcos-0-1.* e v<V>-web-marco2-latencia.*
#  3. scripts/registro_validacao.py consolida tudo em docs/validacao/v<V>.{md,json}
# Requer: Postgres local, venv do services/mesh e os torsos em data/sinteticos (o passo 1 gera se faltar).
# Uso: bash scripts/validacao.sh [--sem-e2e]
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
V="$(tr -d '[:space:]' < VERSION)"
# Commit validado, capturado ANTES de gerar qualquer artefato (RDC 657 art. 5): o registro cita
# exatamente este commit e marca "-dirty" se a arvore tinha alteracao nao commitada.
export VALIDACAO_COMMIT="$(git describe --always --dirty --abbrev=12)"
echo "== commit validado: $VALIDACAO_COMMIT"
ART="$RAIZ/test-results/validacao-v$V"
mkdir -p "$ART"
rm -f "$ART/gltf-validator.json"  # nunca reaproveita resultado de uma execucao anterior
SEM_E2E=0
[[ "${1:-}" == "--sem-e2e" ]] && SEM_E2E=1
PY="$RAIZ/services/mesh/.venv/bin/python"
[[ -x "$PY" ]] || bash scripts/mesh.sh venv
bash scripts/db.sh start criar >/dev/null

echo "== 1/4 services/mesh: Marco 0, volume, Marco 2, glTF-Validator"
SINT="$RAIZ/data/sinteticos"
# Torsos e morphs (catalogo de teste, nao clinico) que o glTF-Validator (Khronos) confere; gera so o que faltar.
for p in t01_simetrico_300 t02_assimetrico t03_pequeno_ptose; do
  [[ -f "$SINT/$p/gabarito.json" && -f "$SINT/$p/torso.glb" && -f "$SINT/$p/denso.obj" ]] \
    || ( cd services/mesh && "$PY" -m mesh.cli torso --preset "$p" --saida "$SINT" )
  compgen -G "$SINT/$p/morphs/*.glb" >/dev/null \
    || ( cd services/mesh && "$PY" -m mesh.cli morphs --sintetico "$SINT/$p" --catalogo tests/fixtures/catalogo_teste.json )
done
# Resultado (arquivos, erros, avisos, versao) vai para `gltf_validator` no v<V>-services-mesh.json; erro ou
# aviso nao interrompe a geracao, mas reprova o registro consolidado.
node scripts/validar_gltf.mjs --json "$ART/gltf-validator.json" "$SINT"/*/morphs/*.glb "$SINT"/*/torso.glb || true
( cd services/mesh && "$PY" - "$SINT" "$RAIZ/docs/validacao/v$V-services-mesh" "$ART/gltf-validator.json" <<'PY'
import json, sys
from pathlib import Path
from mesh.validacao import _markdown_marco2, metricas_marco2, relatorio_marco0
sint, saida, gltf_json = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
cat = Path("tests/fixtures/catalogo_teste.json").resolve()
res = relatorio_marco0(sint, gerar_se_faltar=True)
m2 = metricas_marco2(sint, cat)
gltf = None
if gltf_json.is_file():
    g = json.loads(gltf_json.read_text(encoding="utf-8"))
    gltf = {k: g[k] for k in ("arquivos", "erros", "avisos", "versao")}
md = res["markdown"].replace("<!-- MARCO2 -->", _markdown_marco2(m2, cat.name, gltf))
Path(f"{saida}.md").write_text(md, encoding="utf-8")
ba = res["bland_altman"]
Path(f"{saida}.json").write_text(json.dumps({
    "esquema": "validacao_componente/services-mesh",
    "resumo": res["resumo"],
    "bland_altman_pipeline": {k: ba[k] for k in ("n", "vies_mm", "dp_mm", "loa_inferior_mm", "loa_superior_mm", "dentro_de_2mm", "erro_abs_max_mm")},
    "marco2": m2,
    "gltf_validator": gltf,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("ok", saida)
PY
)

echo "== 2/4 pytest (services/mesh)"
( cd services/mesh && "$PY" -m pytest -q --junitxml="$ART/pytest.xml" ) || true

echo "== 3/4 Vitest (web e contratos)"
pnpm --filter @simulador/contratos exec vitest run --reporter=default --reporter=json --outputFile="$ART/vitest-contratos.json" || true
pnpm --filter web exec vitest run --reporter=default --reporter=json --outputFile="$ART/vitest-web.json" || true

if [[ $SEM_E2E -eq 0 ]]; then
  echo "== 4/4 Playwright completo (A e B) + relatorios de componente do web"
  ( cd apps/web && NEXT_PUBLIC_GANCHOS_TESTE=1 pnpm exec next build >/dev/null \
      && RELATORIO_VALIDACAO=1 PLAYWRIGHT_JSON_OUTPUT_NAME="$ART/playwright.json" pnpm exec playwright test --reporter=list,json ) || true
fi

python3 scripts/registro_validacao.py --artefatos "$ART"
