#!/usr/bin/env bash
# CI local: lint + testes de web, contratos e Python + checagens de contrato/LGPD/licencas.
# O banco (Postgres de teste) e OBRIGATORIO: sem ele a CI falha, a menos que venha --sem-db
# explicito — e entao o resumo e test-results/ci-resumo.json marcam "sem banco" (nao vale como
# validacao). Uso: bash scripts/ci.sh [--sem-db] [--sem-e2e]
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

SEM_DB=0; SEM_E2E=0
for a in "$@"; do
  case "$a" in
    --sem-db) SEM_DB=1 ;;
    --sem-e2e) SEM_E2E=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 2 ;;
  esac
done

FALHAS=0
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
if command -v python3 >/dev/null; then
  if python3 -c "import jsonschema" 2>/dev/null; then
    python3 scripts/validar_config.py && ok "config/*.json validos contra config/schemas" || falha "config invalida"
  else
    pular "python 'jsonschema' ausente (pip install jsonschema); validando apenas sintaxe JSON"
    for f in $(find config docs/validacao -name '*.json'); do
      python3 -m json.tool "$f" >/dev/null && ok "JSON sintaticamente valido: $f" || falha "JSON invalido: $f"
    done
  fi
else
  falha "python3 ausente"
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
    if [[ $SEM_DB -eq 0 ]]; then
      # banco obrigatorio: sem ele o globalSetup do Vitest tambem falha (nada de auto-pular)
      if bash scripts/db.sh start criar >/dev/null 2>&1; then ok "postgres local pronto"; else falha "postgres local indisponivel (use --sem-db so para rodar sem validar o banco)"; fi
      pnpm --filter web run test && ok "testes web (vitest, com banco)" || falha "testes web"
    else
      pular "BANCO: --sem-db explicito; testes de banco PULADOS (esta execucao nao vale como validacao)"
      SEM_DB=1 pnpm --filter web run test && ok "testes web (vitest, SEM banco)" || falha "testes web"
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
python3 - "$VERSAO" "$SEM_DB" "$SEM_E2E" "$FALHAS" "$(git describe --always --dirty 2>/dev/null || echo desconhecido)" > test-results/ci-resumo.json <<'PYJ'
import json, sys, datetime
v, sem_db, sem_e2e, falhas, commit = sys.argv[1:6]
print(json.dumps({"versao": v, "commit": commit, "data": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                  "sem_db": sem_db == "1", "sem_e2e": sem_e2e == "1", "falhas": int(falhas),
                  "vale_como_validacao": sem_db != "1" and sem_e2e != "1" and falhas == "0"}, ensure_ascii=False, indent=2))
PYJ
[[ $SEM_DB -eq 1 ]] && printf '\033[33m[ATENCAO]\033[0m CI rodada SEM BANCO (--sem-db): registrado em test-results/ci-resumo.json\n'
if [[ $FALHAS -eq 0 ]]; then ok "CI passou (versao $VERSAO)"; exit 0; else falha "$FALHAS falha(s)"; exit 1; fi
