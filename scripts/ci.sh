#!/usr/bin/env bash
# CI local: lint + testes de web e Python + checagens de contrato/LGPD/licencas.
# Passos cujo alvo ainda nao existe sao PULADOS com aviso (nao falham), para que a CI
# funcione desde o Marco 0. Uso: bash scripts/ci.sh [--sem-db] [--sem-e2e]
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

# ------------------------------------------------------------------ 1. repositorio
titulo "Repositorio"
VERSAO="$(tr -d '[:space:]' < VERSION)"
[[ "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && ok "VERSION=$VERSAO" || falha "VERSION invalida: '$VERSAO'"
[[ -f "docs/validacao/v$VERSAO.md" ]] && ok "registro de validacao docs/validacao/v$VERSAO.md existe" \
  || falha "falta docs/validacao/v$VERSAO.md (restricao 8, RDC 657 art. 5)"
grep -q '"gru1"' vercel.json && ok "vercel.json fixa regiao gru1" || falha "vercel.json sem gru1"
grep -qE '^data/\*' .gitignore && ok ".gitignore ignora data/" || falha ".gitignore nao ignora data/"
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
PROIBIDOS='rbsm|irbsm|lirbsm|smplx|smpl-x|smpl_x|pymeshlab|sam-3d-body|sam_3d_body|vggt|flux-dev|flux_dev|depth-anything-v2|depth_anything_v2'
ARQS_DEP="$(ls pnpm-lock.yaml apps/web/package.json packages/*/package.json services/mesh/pyproject.toml services/mesh/requirements*.txt 2>/dev/null || true)"
if [[ -n "$ARQS_DEP" ]]; then
  if grep -inE "$PROIBIDOS" $ARQS_DEP >/dev/null; then falha "dependencia proibida encontrada (ADR 0009)"; grep -inE "$PROIBIDOS" $ARQS_DEP || true; else ok "nenhuma dependencia proibida em: $(echo $ARQS_DEP | tr '\n' ' ')"; fi
else
  pular "nenhum manifesto de dependencias ainda"
fi
# Inventario completo: toda licenca instalada (Node e Python) na lista permitida; qualquer GPL/LGPL falha.
if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null; then
  [[ -d node_modules ]] || pnpm install --frozen-lockfile
  bash scripts/licencas.sh --checar && ok "licencas de todas as dependencias instaladas permitidas (scripts/licencas.sh --checar)" \
    || falha "licenca fora da lista permitida (rode bash scripts/licencas.sh --checar)"
else
  pular "inventario de licencas (sem pnpm-lock.yaml)"
fi

# ------------------------------------------------------------------ 4. web (Next.js)
titulo "Web (apps/web)"
if [[ -f apps/web/package.json ]]; then
  if command -v pnpm >/dev/null; then
    [[ -d node_modules ]] || pnpm install --frozen-lockfile
    pnpm --filter web --if-present run lint      && ok "lint web"      || falha "lint web"
    pnpm --filter web --if-present run typecheck && ok "typecheck web" || falha "typecheck web"
    if [[ $SEM_DB -eq 0 ]]; then bash scripts/db.sh start criar >/dev/null 2>&1 && ok "postgres local pronto" || pular "postgres local indisponivel; testes de banco devem se auto-pular"; fi
    pnpm --filter web --if-present run test      && ok "testes web (vitest)" || falha "testes web"
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
  PY="services/mesh/.venv/bin/python"
  if [[ ! -x "$PY" ]]; then
    python3 -m venv services/mesh/.venv && "$PY" -m pip install -q -e "services/mesh[dev]" || falha "instalacao do venv"
  fi
  ( cd services/mesh && "$RAIZ/$PY" -m ruff check . )   && ok "ruff"   || falha "ruff"
  ( cd services/mesh && "$RAIZ/$PY" -m pytest -q )      && ok "pytest" || falha "pytest"
else
  pular "services/mesh/pyproject.toml ainda nao existe"
fi

# ------------------------------------------------------------------ resumo
titulo "Resumo"
if [[ $FALHAS -eq 0 ]]; then ok "CI passou (versao $VERSAO)"; exit 0; else falha "$FALHAS falha(s)"; exit 1; fi
