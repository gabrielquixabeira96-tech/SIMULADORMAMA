#!/usr/bin/env bash
# CI local: lint + testes de web, contratos e Python + checagens de contrato/LGPD/licencas.
# O banco (Postgres de teste) e OBRIGATORIO: sem ele a CI falha, a menos que venha --sem-db
# explicito — e entao o resumo e test-results/ci-resumo.json marcam "sem banco" (nao vale como
# validacao). Uso: bash scripts/ci.sh [--sem-db] [--sem-e2e]
# CI honesta (v0.1.2, PT1): a validacao de schema usa o Python do venv do services/mesh (que tem
# jsonschema) e sem jsonschema a etapa FALHA; os torsos sinteticos sao gerados quando faltam e a
# integracao web x services/mesh real e exigida (EXIGIR_MESH_REAL=1). Testes pulados vao para
# test-results/ci-resumo.json e derrubam "vale_como_validacao".
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
# Privacidade: sem telemetria anonima do Next.js em build/test (A4).
export NEXT_TELEMETRY_DISABLED=1

SEM_DB=0; SEM_E2E=0
for a in "$@"; do
  case "$a" in
    --sem-db) SEM_DB=1 ;;
    --sem-e2e) SEM_E2E=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 2 ;;
  esac
done

FALHAS=0
SCHEMA_VALIDADO=0   # 1 so se validar_config.py rodou de fato com jsonschema
MESH_REAL_EXIGIDO=0 # 1 quando o Vitest web roda com EXIGIR_MESH_REAL=1
TESTES_PULADOS=-1   # -1 = desconhecido (relatorio JSON do Vitest ausente)
ok()    { printf '\033[32m[ok]\033[0m %s\n' "$*"; }
pular() { printf '\033[33m[pulado]\033[0m %s\n' "$*"; }
falha() { printf '\033[31m[FALHA]\033[0m %s\n' "$*"; FALHAS=$((FALHAS+1)); }
titulo(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# ------------------------------------------------------------------ 0. ambiente
# Dependencias Node e venv Python ANTES de qualquer checagem que dependa delas (licencas, testes).
titulo "Ambiente"
if command -v pnpm >/dev/null; then
  [[ -d node_modules ]] || pnpm install --frozen-lockfile
  ok "node_modules presente"
else
  falha "pnpm ausente"
fi
PY="services/mesh/.venv/bin/python"
if [[ -f services/mesh/pyproject.toml ]]; then
  if [[ ! -x "$PY" || ! -x services/mesh/.venv/bin/pip-licenses ]]; then
    bash scripts/mesh.sh venv >/dev/null && ok "venv do services/mesh criado" || falha "instalacao do venv"
  else ok "venv do services/mesh presente"; fi
fi

# ------------------------------------------------------------------ 1. repositorio
titulo "Repositorio"
VERSAO="$(tr -d '[:space:]' < VERSION)"
[[ "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && ok "VERSION=$VERSAO" || falha "VERSION invalida: '$VERSAO'"
[[ -f "docs/validacao/v$VERSAO.md" ]] && ok "registro de validacao docs/validacao/v$VERSAO.md existe" \
  || falha "falta docs/validacao/v$VERSAO.md (restricao 8, RDC 657 art. 5)"
grep -q '"gru1"' vercel.json && ok "vercel.json fixa regiao gru1" || falha "vercel.json sem gru1"
grep -qE '^data/\*' .gitignore && grep -qxF '**/data/**' .gitignore && ok ".gitignore ignora data/ (raiz e qualquer nivel)" || falha ".gitignore nao ignora data/ em todos os niveis"
grep -qE '^\.env\.\*' .gitignore && ok ".gitignore ignora .env*" || falha ".gitignore nao ignora .env*"
if grep -nE '^(ANTHROPIC_API_KEY|DATABASE_URL)=.*(sk-|@db\.)' .env.example >/dev/null 2>&1; then
  falha ".env.example parece conter segredo real"; else ok ".env.example sem segredos"; fi
# Dados de paciente jamais rastreados
if git ls-files | grep -E '^data/(pacientes|sinteticos)/' >/dev/null; then falha "arquivos de data/ rastreados pelo git"; else ok "nenhum arquivo de data/ rastreado"; fi

# ------------------------------------------------------------------ 2. contratos (JSON + schemas)
titulo "Contratos"
# Python com jsonschema: o do venv do services/mesh (criado em §0); o python3 do sistema so serve
# se tiver jsonschema. Sem nenhum dos dois a etapa FALHA — validar so a sintaxe nao e validacao.
PY_SCHEMA=""
for cand in "$PY" python3; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import jsonschema" 2>/dev/null; then PY_SCHEMA="$cand"; break; fi
done
if [[ -n "$PY_SCHEMA" ]]; then
  if "$PY_SCHEMA" scripts/validar_config.py; then
    SCHEMA_VALIDADO=1
    ok "config/*.json validos contra config/schemas (jsonschema via $PY_SCHEMA)"
  else
    falha "config invalida (scripts/validar_config.py via $PY_SCHEMA)"
  fi
else
  falha "jsonschema ausente (nem $PY nem python3 o importam): schemas NAO validados; rode 'bash scripts/mesh.sh venv'"
  for f in $(find config docs/validacao -name '*.json'); do
    python3 -m json.tool "$f" >/dev/null || falha "JSON invalido: $f"
  done
fi

# ------------------------------------------------------------------ 3. licencas proibidas (ADR 0009)
titulo "Licencas"
# So NOMES de pacote em manifestos/lockfiles e no venv (docs e ADRs podem citar os nomes proibidos).
python3 scripts/checar_proibidos.py && ok "nenhum pacote proibido (scripts/checar_proibidos.py)" || falha "pacote proibido encontrado (ADR 0009)"
# Inventario completo: toda licenca instalada (Node e Python) na lista permitida; qualquer GPL/LGPL falha.
bash scripts/licencas.sh --checar && ok "licencas de todas as dependencias instaladas (Node e Python) permitidas (scripts/licencas.sh --checar)" \
  || falha "inventario de licencas falhou ou achou licenca fora da lista (bash scripts/licencas.sh --checar)"

# ------------------------------------------------------------------ 4. web (Next.js)
titulo "Web (apps/web)"
if [[ -f apps/web/package.json ]]; then
  if command -v pnpm >/dev/null; then
    pnpm --filter web run lint      && ok "lint web"      || falha "lint web"
    pnpm --filter web run typecheck && ok "typecheck web" || falha "typecheck web"
    pnpm --filter @simulador/contratos run typecheck && ok "typecheck contratos" || falha "typecheck contratos"
    pnpm --filter @simulador/contratos run test && ok "testes de contratos (vitest: paridade zod x config/schemas)" || falha "testes de contratos"
    # Relatorio JSON do Vitest (conta testes pulados) alem da saida normal.
    VITEST_JSON="$RAIZ/test-results/vitest-web.json"
    mkdir -p test-results; rm -f "$VITEST_JSON"
    VITEST_ARGS=(--reporter=default --reporter=json "--outputFile.json=$VITEST_JSON")
    if [[ $SEM_DB -eq 0 ]]; then
      # banco obrigatorio: sem ele o globalSetup do Vitest tambem falha (nada de auto-pular)
      if bash scripts/db.sh start criar >/dev/null 2>&1; then ok "postgres local pronto"; else falha "postgres local indisponivel (use --sem-db so para rodar sem validar o banco)"; fi
      # Integracao real (tests/integracao/meshReal.test.ts) e obrigatoria: gera os torsos
      # sinteticos que faltarem (data/ nao e versionado; ~1 min) e exige-os no Vitest.
      TORSOS_OK=1
      for t in t01_simetrico_300 t02_assimetrico t03_pequeno_ptose; do
        for a in torso.obj torso.mtl textura.png gabarito.json; do [[ -f "data/sinteticos/$t/$a" ]] || TORSOS_OK=0; done
      done
      if [[ $TORSOS_OK -eq 1 ]]; then ok "torsos sinteticos presentes (data/sinteticos)"
      elif DATA_DIR="$RAIZ/data" bash scripts/mesh.sh torsos >/dev/null; then ok "torsos sinteticos gerados (bash scripts/mesh.sh torsos)"
      else falha "geracao dos torsos sinteticos (bash scripts/mesh.sh torsos)"; fi
      MESH_REAL_EXIGIDO=1
      EXIGIR_MESH_REAL=1 pnpm --filter web run test "${VITEST_ARGS[@]}" && ok "testes web (vitest, com banco e services/mesh real)" || falha "testes web"
    else
      pular "BANCO: --sem-db explicito; testes de banco e integracao real PULADOS (esta execucao nao vale como validacao)"
      SEM_DB=1 pnpm --filter web run test "${VITEST_ARGS[@]}" && ok "testes web (vitest, SEM banco)" || falha "testes web"
    fi
    # Testes pulados: qualquer um derruba "vale_como_validacao"; na execucao completa, pular a
    # integracao real e FALHA (nao so aviso).
    MESH_REAL_PASSOU=0; MESH_REAL_PULADOS=0
    if [[ -f "$VITEST_JSON" ]]; then
      read -r TESTES_PULADOS MESH_REAL_PASSOU MESH_REAL_PULADOS < <(python3 - "$VITEST_JSON" <<'PYV'
import json, sys
d = json.load(open(sys.argv[1]))
pulados = d.get("numPendingTests", 0) + d.get("numTodoTests", 0)
passou = pul = 0
for f in d.get("testResults", []):
    if f.get("name", "").endswith("tests/integracao/meshReal.test.ts"):
        for t in f.get("assertionResults", []):
            passou += t.get("status") == "passed"
            pul += t.get("status") in ("pending", "skipped", "todo")
print(pulados, passou, pul)
PYV
) || true
      if ! [[ "$TESTES_PULADOS" =~ ^[0-9]+$ && "$MESH_REAL_PASSOU" =~ ^[0-9]+$ && "$MESH_REAL_PULADOS" =~ ^[0-9]+$ ]]; then
        TESTES_PULADOS=-1; MESH_REAL_PASSOU=0; MESH_REAL_PULADOS=0
        falha "relatorio JSON do vitest ilegivel ($VITEST_JSON)"
      elif [[ "$TESTES_PULADOS" -eq 0 ]]; then ok "vitest web: 0 testes pulados"
      else pular "vitest web: $TESTES_PULADOS teste(s) PULADO(S) (esta execucao nao vale como validacao)"; fi
      if [[ $MESH_REAL_EXIGIDO -eq 1 ]]; then
        if [[ "$MESH_REAL_PASSOU" -gt 0 && "$MESH_REAL_PULADOS" -eq 0 ]]; then ok "integracao real (meshReal.test.ts): $MESH_REAL_PASSOU testes passaram, 0 pulados"
        else falha "integracao real (meshReal.test.ts) nao rodou por inteiro: $MESH_REAL_PASSOU passaram, $MESH_REAL_PULADOS pulados"; fi
      fi
    else
      falha "relatorio JSON do vitest ausente ($VITEST_JSON): nao da para contar testes pulados"
    fi
    if [[ $SEM_E2E -eq 0 ]]; then
      pnpm --filter web --if-present run test:e2e && ok "e2e web (playwright, desenhos A e B)" || falha "e2e web"
    else pular "e2e (--sem-e2e)"; fi
  else
    falha "pnpm ausente"
  fi
else
  pular "apps/web/package.json ainda nao existe"
fi

# ------------------------------------------------------------------ 5. python (services/mesh)
titulo "Python (services/mesh)"
if [[ -f services/mesh/pyproject.toml ]]; then
  ( cd services/mesh && "$RAIZ/$PY" -m ruff check . )   && ok "ruff"   || falha "ruff"
  ( cd services/mesh && "$RAIZ/$PY" -m pytest -q )      && ok "pytest" || falha "pytest"
else
  pular "services/mesh/pyproject.toml ainda nao existe"
fi

# ------------------------------------------------------------------ resumo
titulo "Resumo"
mkdir -p test-results
python3 - "$VERSAO" "$SEM_DB" "$SEM_E2E" "$FALHAS" "$(git describe --always --dirty 2>/dev/null || echo desconhecido)" \
  "$SCHEMA_VALIDADO" "$MESH_REAL_EXIGIDO" "$TESTES_PULADOS" > test-results/ci-resumo.json <<'PYJ'
import json, sys, datetime
v, sem_db, sem_e2e, falhas, commit, schema, mesh_real, pulados = sys.argv[1:9]
pulados = int(pulados)
print(json.dumps({"versao": v, "commit": commit, "data": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                  "sem_db": sem_db == "1", "sem_e2e": sem_e2e == "1", "falhas": int(falhas),
                  "schemas_validados": schema == "1", "mesh_real_exigido": mesh_real == "1",
                  "testes_pulados": pulados if pulados >= 0 else None,
                  "vale_como_validacao": sem_db != "1" and sem_e2e != "1" and falhas == "0"
                                         and schema == "1" and mesh_real == "1" and pulados == 0}, ensure_ascii=False, indent=2))
PYJ
[[ $SEM_DB -eq 1 ]] && printf '\033[33m[ATENCAO]\033[0m CI rodada SEM BANCO (--sem-db): registrado em test-results/ci-resumo.json\n'
if [[ $FALHAS -eq 0 ]]; then ok "CI passou (versao $VERSAO)"; exit 0; else falha "$FALHAS falha(s)"; exit 1; fi
