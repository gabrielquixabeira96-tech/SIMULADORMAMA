#!/usr/bin/env bash
# Demonstracao sintetica (ADR 0018): sobe a pilha inteira (Next + services/mesh + Postgres local +
# DATA_DIR proprio) numa maquina Linux limpa -- alvo: Vercel Sandbox (observado em gru1: Ubuntu 26.04
# com apt, usuario ubuntu, HOME=/vercel, node22, Postgres 18, Python 3.14 do sistema -> Python 3.13 via
# uv; Amazon Linux/dnf continua aceito) -- so com torsos sinteticos, DEMO_SINTETICA=1, DESENHO=B e LLM
# em mock.
# Documentacao e riscos: docs/deploy-demo.md. NUNCA usar com dado real.
#
# Uso: bash scripts/demo_sandbox.sh <comando>
#   preparar       instala dependencias (pacotes do sistema so se faltarem; apt ou dnf), pnpm install,
#                  venv do services/mesh (Python 3.11-3.13; com so 3.14+ e pygeodesic sem wheel, usa
#                  Python 3.13 do uv; o uv, se ausente, vem do PyPI com versao e hash fixos), cluster
#                  Postgres proprio + banco marcado como demo, torsos, morphs e
#                  fotos de exemplo sinteticos (ADR 0021), next build
#   subir          sobe Postgres, mesh (127.0.0.1) e web (0.0.0.0:DEMO_PORTA) com DEMO_SINTETICA=1;
#                  na primeira vez gera APP_TOKEN_LOCAL aleatorio e o imprime UMA vez
#   parar          para web, mesh e Postgres (o estado fica em DEMO_DIR)
#   status         processos e /api/config (espera 401 sem token)
#   novo-token     troca o APP_TOKEN_LOCAL (imprime uma vez; rode 'parar' e 'subir' depois)
#   recriar-banco  apaga banco e dados de pacientes sinteticos da demo e recria o banco marcado
#   apagar         para tudo e apaga DEMO_DIR (banco, DATA_DIR, logs, token)
#
# Variaveis (opcionais, salvo DEMO_HOST_PUBLICO em 'subir'):
#   DEMO_HOST_PUBLICO  host publico da porta exposta (ex.: sb-xxxx.vercel.run); vai para
#                      APP_HOSTS_PERMITIDOS. Obrigatorio para escutar em 0.0.0.0.
#   DEMO_SO_LOOPBACK=1 escuta so em 127.0.0.1 e dispensa DEMO_HOST_PUBLICO (teste local)
#   DEMO_DIR           estado da demo (padrao: $HOME/simulador-demo; FORA do repositorio)
#   DEMO_PG_DIR        cluster Postgres (padrao: $DEMO_DIR/pg)
#   DEMO_PORTA (3000)  DEMO_PG_PORTA (5433)  DEMO_MESH_PORTA (8765)  DEMO_DESENHO (B)
#   DEMO_SEM_INSTALAR=1  nao tenta instalar pacotes do sistema (dnf/apt) nem o uv
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="${DEMO_DIR:-$HOME/simulador-demo}"
PG_DIR="${DEMO_PG_DIR:-$DEMO_DIR/pg}"
PG_SOCK="$PG_DIR/sock"
PG_DADOS="$PG_DIR/dados"
DATA_DIR_DEMO="$DEMO_DIR/data"
LOGS="$DEMO_DIR/logs"
RUN="$DEMO_DIR/run"
ENV_DEMO="$DEMO_DIR/demo.env"
PORTA="${DEMO_PORTA:-3000}"
PG_PORTA="${DEMO_PG_PORTA:-5433}"
MESH_PORTA="${DEMO_MESH_PORTA:-8765}"
DESENHO_DEMO="${DEMO_DESENHO:-B}"
DB_NOME="simulador_demo"
DB_ROLE="simulador_demo"
TORSOS=(t01_simetrico_300 t02_assimetrico t03_pequeno_ptose)
VENV="$RAIZ/services/mesh/.venv"
export NEXT_TELEMETRY_DISABLED=1

msg()  { printf '\033[1m[demo]\033[0m %s\n' "$*"; }
erro() { printf '\033[31m[demo] ERRO:\033[0m %s\n' "$*" >&2; exit 1; }
tem()  { command -v "$1" >/dev/null 2>&1; }
sudo_() { if [[ "$(id -u)" -eq 0 ]]; then "$@"; elif tem sudo; then sudo "$@"; else return 1; fi; }

# Seguranca do estado: DEMO_DIR nunca dentro do repositorio (o .gitignore nao cobre tudo nele).
case "$(realpath -m "$DEMO_DIR")/" in "$RAIZ"/*) erro "DEMO_DIR ($DEMO_DIR) nao pode ficar dentro do repositorio";; esac
# Entradas validadas antes de irem para comandos, SQL ou o ambiente do servidor.
[[ "$DESENHO_DEMO" =~ ^[AB]$ ]] || erro "DEMO_DESENHO invalido: '$DESENHO_DEMO' (A ou B)"
for _p in "$PORTA" "$PG_PORTA" "$MESH_PORTA"; do
  [[ "$_p" =~ ^[0-9]{1,5}$ && "$_p" -ge 1 && "$_p" -le 65535 ]] || erro "porta invalida: '$_p' (DEMO_PORTA, DEMO_PG_PORTA, DEMO_MESH_PORTA: 1-65535)"
done
# Marcador gravado pelo proprio script: 'apagar' so remove pastas que o tenham (nunca um DEMO_DIR errado).
MARCADOR=".simulador-demo-sintetica"
# Pasta que o script cria, grava ou apaga (DEMO_DIR, DEMO_PG_DIR): se ja existe, nao esta vazia e nao
# tem o marcador, nao e da demo -> recusa (nunca mkdir/chown/touch nem 'apagar' numa pasta alheia).
checar_pasta_demo() { # checar_pasta_demo CAMINHO NOME_DA_VARIAVEL
  if [[ -e "$1" && ! -f "$1/$MARCADOR" ]]; then
    [[ -d "$1" ]] || erro "$2 ($1) existe e nao e pasta"
    [[ -z "$(ls -A -- "$1")" ]] || erro "$2 ($1) existe, nao esta vazio e nao tem o marcador $MARCADOR: nao uso (aponte $2 para uma pasta nova)"
  fi
  return 0
}

# ------------------------------------------------------------------ ferramentas
pg_bin() {
  local d cands=("${PG_BIN:-}")
  tem initdb && cands+=("$(dirname "$(command -v initdb)")")
  # versao decrescente: Ubuntu/Debian (/usr/lib/postgresql/N), depois PGDG/Amazon Linux
  cands+=(/usr/lib/postgresql/18/bin /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin /usr/lib/postgresql/15/bin /usr/pgsql-16/bin /usr/bin)
  for d in "${cands[@]}"; do [[ -n "$d" && -x "$d/initdb" && -x "$d/pg_ctl" && -x "$d/psql" ]] && { echo "$d"; return 0; }; done
  return 1
}

# Python >= 3.11 com venv/ensurepip. Preferencia: 3.13/3.12/3.11 explicitos, o 3.13 do uv (se o uv ja
# existir; nada e instalado aqui) e so entao o python3 generico (que pode ser 3.14+, sem wheel do
# pygeodesic 0.1.11 -- ver python_uv e preparar_venv).
py_valido() { "$1" -c 'import sys, venv, ensurepip; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; }
py_versao() { "$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])'; }
UV_VENV="$DEMO_DIR/.uv"
uv_bin() { if tem uv; then command -v uv; elif [[ -x "$UV_VENV/bin/uv" ]]; then echo "$UV_VENV/bin/uv"; else return 1; fi; }

python_ok() {
  local p uv
  for p in python3.13 python3.12 python3.11; do
    tem "$p" && py_valido "$p" && { command -v "$p"; return 0; }
  done
  if uv="$(uv_bin)" && p="$("$uv" python find 3.13 2>/dev/null)" && py_valido "$p"; then echo "$p"; return 0; fi
  tem python3 && py_valido python3 && { command -v python3; return 0; }
  return 1
}

# Python 3.13 gerenciado pelo uv (MIT OR Apache-2.0; ferramenta de preparo, nao vai para o app).
# Se o uv faltar, instala do PyPI num venv proprio em $DEMO_DIR/.uv (apagado com 'apagar'), com
# versao fixa e --require-hashes (wheels manylinux x86_64/aarch64 de uv 0.12.19, sha256 do PyPI).
UV_VERSAO="0.12.19"
UV_HASHES=(
  a63d18a0aa38ee9f21a5406afbbaeb41303bcd954be9d6b7c1b95ac275e53958 # manylinux_2_17_x86_64
  b466eb0f74645883df52446d54474905e8515d75fdf0b313bf099dedc3237896 # manylinux_2_17_aarch64 (+musllinux)
  a36d92c137098fdb9dce27261c5fa8ef5519ba82dcd15d70864c4676d889738d # manylinux_2_28_aarch64
)
instalar_uv() {
  local req h
  [[ "${DEMO_SEM_INSTALAR:-0}" == "1" ]] && { msg "uv ausente e DEMO_SEM_INSTALAR=1" >&2; return 1; }
  if ! { tem python3 && py_valido python3; }; then msg "python3 com venv ausente: nao da para instalar o uv" >&2; return 1; fi
  msg "instalando uv==$UV_VERSAO do PyPI (hashes fixos) em $UV_VENV" >&2
  rm -rf -- "$UV_VENV"
  python3 -m venv "$UV_VENV" >&2 || return 1
  req="$UV_VENV/requisitos.txt"
  { printf 'uv==%s' "$UV_VERSAO"; for h in "${UV_HASHES[@]}"; do printf ' --hash=sha256:%s' "$h"; done; printf '\n'; } > "$req"
  "$UV_VENV/bin/pip" install -q --disable-pip-version-check --require-hashes --only-binary=:all: -r "$req" >&2 || return 1
}
python_uv() {
  local uv p
  if ! uv="$(uv_bin)"; then
    instalar_uv || return 1
    uv="$(uv_bin)" || return 1
  fi
  if ! p="$("$uv" python find 3.13 2>/dev/null)"; then
    msg "uv python install 3.13" >&2
    "$uv" python install 3.13 >&2 || return 1
    p="$("$uv" python find 3.13)" || return 1
  fi
  py_valido "$p" || return 1
  echo "$p"
}

# venv do services/mesh com o Python dado (recriado se a versao mudou); 1 se as dependencias nao importam
preparar_venv() {
  local py="$1"
  if [[ -x "$VENV/bin/python" && "$(py_versao "$VENV/bin/python" 2>/dev/null || true)" != "$(py_versao "$py")" ]]; then
    msg "venv do services/mesh com outra versao do Python: recriando"
    rm -rf -- "$VENV"
  fi
  if [[ ! -x "$VENV/bin/python" ]]; then
    msg "venv do services/mesh com $py (Python $(py_versao "$py"))"
    "$py" -m venv "$VENV" || return 1
  fi
  "$VENV/bin/python" -m pip install -q --upgrade pip || return 1
  "$VENV/bin/python" -m pip install -q -e "$RAIZ/services/mesh" || return 1
  "$VENV/bin/python" -c 'import numpy, scipy, trimesh, rtree, fast_simplification, pygeodesic, fastapi, uvicorn' || return 1
}

instalar_sistema() {
  [[ "${DEMO_SEM_INSTALAR:-0}" == "1" ]] && return 0
  local falta=0
  pg_bin >/dev/null || falta=1
  python_ok >/dev/null || falta=1
  for b in openssl curl gcc g++; do tem "$b" || falta=1; done
  [[ $falta -eq 0 ]] && { msg "pacotes do sistema ja presentes"; return 0; }
  if tem dnf; then
    msg "instalando pacotes (dnf: Postgres 16, compiladores, Python)"
    sudo_ dnf install -y -q postgresql16-server postgresql16 gcc gcc-c++ make openssl curl-minimal tar gzip || sudo_ dnf install -y -q postgresql16-server postgresql16 gcc gcc-c++ make openssl tar gzip
    python_ok >/dev/null || sudo_ dnf install -y -q python3.13 python3.13-devel || sudo_ dnf install -y -q python3.11 python3.11-devel || true
    # cabecalhos do Python para compilar pygeodesic/fast-simplification se nao houver wheel
    local py; py="$(python_ok || true)"; [[ -n "$py" ]] && sudo_ dnf install -y -q "$(basename "$py")-devel" 2>/dev/null || true
  elif tem apt-get; then
    # Ubuntu 26.04 (imagem observada no Vercel Sandbox): postgresql = 18, python3 = 3.14 (o 3.13 vem do uv)
    msg "instalando pacotes (apt: Postgres, compiladores, Python)"
    sudo_ env DEBIAN_FRONTEND=noninteractive apt-get update -qq \
      || erro "apt-get update falhou (sem sudo? rede bloqueada para os espelhos do Ubuntu?)"
    sudo_ env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib build-essential \
        python3 python3-venv python3-dev openssl curl ca-certificates \
      || erro "apt-get install falhou: instale Postgres >= 15, Python >= 3.11 (venv), gcc/g++, openssl e curl"
  else
    erro "sem dnf nem apt-get: instale Postgres >= 15, Python >= 3.11, gcc/g++, openssl e curl"
  fi
  pg_bin >/dev/null || erro "Postgres ainda nao encontrado depois da instalacao (procurei /usr/lib/postgresql/{18..15}/bin, /usr/pgsql-16/bin e /usr/bin; defina PG_BIN)"
}

pnpm_() {
  if tem pnpm; then pnpm "$@"
  else
    local v; v="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$RAIZ/package.json")"
    npx -y "pnpm@${v:-10}" "$@"
  fi
}

# Usuario dono do cluster: o proprio usuario; como root, 'postgres' (initdb recusa root).
PG_USER="$(id -un)"
if [[ "$(id -u)" -eq 0 ]]; then PG_USER="${DEMO_PG_USER:-postgres}"; fi
como_pg() { if [[ "$(id -u)" -eq 0 ]]; then runuser -u "$PG_USER" -- "$@"; else "$@"; fi; }
psql_admin() { como_pg "$PGBIN/psql" -h "$PG_SOCK" -p "$PG_PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
# SQL pela entrada padrao (nao aparece no argv/ps): usado para comandos com a senha do role.
psql_admin_stdin() { como_pg "$PGBIN/psql" -h "$PG_SOCK" -p "$PG_PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -f -; }
pg_pronto() { [[ -n "${PGBIN:-}" ]] && "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PG_PORTA" >/dev/null 2>&1; }

pg_start() {
  PGBIN="$(pg_bin)" || erro "Postgres nao encontrado (rode 'preparar')"
  if pg_pronto; then return 0; fi
  como_pg "$PGBIN/pg_ctl" -D "$PG_DADOS" -l "$PG_DIR/postgres.log" -w -t 60 \
    -o "-p $PG_PORTA -c listen_addresses=127.0.0.1 -k $PG_SOCK" start </dev/null >/dev/null 2>>"$LOGS/pg_ctl.log" \
    || { tail -n 30 "$PG_DIR/postgres.log" >&2 || true; erro "Postgres nao subiu"; }
}

pg_stop() {
  PGBIN="$(pg_bin 2>/dev/null)" || return 0
  [[ -d "$PG_DADOS" ]] && como_pg "$PGBIN/pg_ctl" -D "$PG_DADOS" -m fast stop >/dev/null 2>&1 || true
}

pg_cluster() {
  checar_pasta_demo "$PG_DIR" DEMO_PG_DIR # antes de qualquer mkdir/chown/touch
  PGBIN="$(pg_bin)" || erro "Postgres nao encontrado depois da instalacao"
  local maior; maior="$("$PGBIN/postgres" --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)?.*/\1/')"
  [[ "$maior" -ge 15 ]] || erro "Postgres $maior < 15 (ADR 0007)"
  if [[ ! -f "$PG_DADOS/PG_VERSION" ]]; then
    msg "criando cluster Postgres $maior em $PG_DADOS (porta $PG_PORTA, so 127.0.0.1)"
    mkdir -p "$PG_DIR"
    [[ "$(id -u)" -eq 0 ]] && chown "$PG_USER" "$PG_DIR"
    como_pg mkdir -p "$PG_DADOS" "$PG_SOCK"
    como_pg touch "$PG_DIR/$MARCADOR"
    como_pg chmod 700 "$PG_DADOS" "$PG_SOCK"
    como_pg test -w "$PG_DADOS" || erro "o usuario $PG_USER nao escreve em $PG_DADOS (como root, aponte DEMO_PG_DIR para um caminho acessivel a ele)"
    # socket local (pasta 0700 do dono do cluster): trust; TCP em 127.0.0.1: senha (scram)
    como_pg "$PGBIN/initdb" -D "$PG_DADOS" -U postgres -E UTF8 --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  fi
  pg_start
}

carregar_env() {
  [[ -f "$ENV_DEMO" ]] || erro "falta $ENV_DEMO (rode 'preparar')"
  set -a; # shellcheck disable=SC1090
  source "$ENV_DEMO"; set +a
}

escrever_var() { # escrever_var CHAVE VALOR -> substitui ou acrescenta em $ENV_DEMO
  local k="$1" v="$2" tmp; tmp="$(mktemp "$DEMO_DIR/.env.XXXXXX")"
  { grep -v "^$k=" "$ENV_DEMO" 2>/dev/null || true; printf '%s=%s\n' "$k" "$v"; } > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV_DEMO"
}

banco() {
  local senha
  if [[ -f "$ENV_DEMO" ]] && grep -q '^DATABASE_URL=' "$ENV_DEMO"; then
    senha="$(sed -n 's#^DATABASE_URL=postgres://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_DEMO")"
  else
    senha="$(openssl rand -hex 16)"
  fi
  [[ "$senha" =~ ^[0-9a-f]{32}$ ]] || erro "senha do banco em $ENV_DEMO fora do formato esperado (use 'recriar-banco' ou 'apagar')"
  local verbo="alter"
  [[ "$(psql_admin "select 1 from pg_roles where rolname='$DB_ROLE'")" == "1" ]] || verbo="create"
  # senha pela entrada padrao do psql, nunca no argv
  printf "%s role %s login password '%s';\n" "$verbo" "$DB_ROLE" "$senha" | psql_admin_stdin >/dev/null
  if [[ "$(psql_admin "select 1 from pg_database where datname='$DB_NOME'")" != "1" ]]; then
    psql_admin "create database $DB_NOME owner $DB_ROLE encoding 'UTF8'" >/dev/null
    msg "banco $DB_NOME criado"
  fi
  escrever_var DATABASE_URL "postgres://$DB_ROLE:$senha@127.0.0.1:$PG_PORTA/$DB_NOME"
  # migrations + marca de demo (so em banco vazio; a subida exige a marca)
  ( cd "$RAIZ/apps/web" && DATABASE_URL_TEST="postgres://$DB_ROLE:$senha@127.0.0.1:$PG_PORTA/$DB_NOME" \
      node --experimental-strip-types --no-warnings scripts/migrar.ts --teste --marcar-demo )
}

env_base() {
  checar_pasta_demo "$DEMO_DIR" DEMO_DIR
  mkdir -p "$DEMO_DIR" "$LOGS" "$RUN" "$DATA_DIR_DEMO"
  chmod 700 "$DEMO_DIR"
  touch "$DEMO_DIR/$MARCADOR"
  [[ -f "$ENV_DEMO" ]] || { : > "$ENV_DEMO"; chmod 600 "$ENV_DEMO"; }
  escrever_var DEMO_SINTETICA 1
  escrever_var DESENHO "$DESENHO_DEMO"
  escrever_var LLM_MODO mock
  escrever_var ANTHROPIC_API_KEY ""
  escrever_var DATA_DIR "$DATA_DIR_DEMO"
  escrever_var MESH_SERVICE_URL "http://127.0.0.1:$MESH_PORTA"
  escrever_var USUARIO_LOCAL_ID demo
  escrever_var LOG_LEVEL info
}

# ------------------------------------------------------------------ comandos
cmd_preparar() {
  # antes de instalar qualquer coisa (env_base e pg_cluster conferem de novo)
  checar_pasta_demo "$DEMO_DIR" DEMO_DIR
  checar_pasta_demo "$PG_DIR" DEMO_PG_DIR
  instalar_sistema
  tem node || erro "node ausente (o sandbox usa o runtime node22)"
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == "22" ]] || erro "node $(node -v): o projeto exige Node 22 (package.json engines)"
  env_base # cria DEMO_DIR (com o marcador) antes do venv do uv, que mora nele
  msg "pnpm install"
  ( cd "$RAIZ" && pnpm_ install --frozen-lockfile )

  local py; py="$(python_ok)" || py="$(python_uv)" || erro "Python >= 3.11 (com venv) nao encontrado, nem via uv"
  if ! preparar_venv "$py"; then
    # Python 3.14+ (Ubuntu 26.04): pygeodesic 0.1.11 nao tem wheel cp314 e a compilacao falha -> 3.13 do uv
    "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 14) else 1)' \
      || erro "dependencias do services/mesh nao importam com Python $(py_versao "$py") (pygeodesic sem wheel? instale gcc/g++ e os cabecalhos do Python)"
    msg "Python $(py_versao "$py") sem pygeodesic funcional: usando Python 3.13 do uv"
    py="$(python_uv)" || erro "nao consegui o Python 3.13 via uv (rede para PyPI e github.com liberada no preparo?)"
    rm -rf -- "$VENV"
    preparar_venv "$py" || erro "dependencias do services/mesh nao importam nem com o Python 3.13 do uv ($py)"
  fi

  pg_cluster
  banco

  msg "torsos sinteticos e morphs em $DATA_DIR_DEMO/sinteticos"
  for t in "${TORSOS[@]}"; do
    # regera o torso que faltar ou que for da v0.1.x (gabarito sem textura.esquema: textura neutra, ADR 0020);
    # regerar apaga os morphs/ dele, refeitos logo abaixo
    ( cd "$RAIZ/services/mesh" && "$VENV/bin/python" -m mesh.cli torso --preset "$t" --saida "$DATA_DIR_DEMO/sinteticos" --se-desatualizado >/dev/null )
    compgen -G "$DATA_DIR_DEMO/sinteticos/$t/morphs/*.glb" >/dev/null \
      || ( cd "$RAIZ/services/mesh" && "$VENV/bin/python" -m mesh.cli morphs --sintetico "$DATA_DIR_DEMO/sinteticos/$t" --catalogo tests/fixtures/catalogo_teste.json >/dev/null )
  done
  # "Fotos de exemplo" (plano foto3d, ADR 0021): <torso>/foto/ e t01/foto_frente/ pelo pipeline real
  # (fotos sinteticas -> /reconstruir-foto -> avaliacao.json); pula o que ja estiver atualizado (~2 min/torso)
  msg "fotos de exemplo (reconstrucao 3D a partir das fotos sinteticas) em $DATA_DIR_DEMO/sinteticos"
  ( cd "$RAIZ/services/mesh" && "$VENV/bin/python" -m mesh.cli fotos-exemplo --todos --sinteticos "$DATA_DIR_DEMO/sinteticos" --se-desatualizado >/dev/null ) \
    || erro "fotos de exemplo (mesh.cli fotos-exemplo) falharam"

  msg "next build da demo (DEMO_SINTETICA=1: teto de corpo 2 MB; sem ganchos de teste)"
  ( unset NEXT_PUBLIC_GANCHOS_TESTE; export DEMO_SINTETICA=1; cd "$RAIZ/apps/web" && pnpm_ exec next build >"$LOGS/build.log" 2>&1 ) \
    || { tail -n 40 "$LOGS/build.log" >&2; erro "next build falhou (log em $LOGS/build.log)"; }
  msg "pronto. Agora: DEMO_HOST_PUBLICO=<host da porta $PORTA> bash scripts/demo_sandbox.sh subir"
}

vivo() { [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

esperar() { # esperar URL CODIGOS PROCESSO SEGUNDOS
  local c
  for _ in $(seq 1 "$4"); do
    c="$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)"
    [[ " $2 " == *" $c "* ]] && return 0
    vivo "$3" || return 1
    sleep 1
  done
  return 1
}

cmd_subir() {
  carregar_env
  local host_escuta="0.0.0.0"
  if [[ "${DEMO_SO_LOOPBACK:-0}" == "1" ]]; then
    host_escuta="127.0.0.1"; escrever_var APP_HOSTS_PERMITIDOS ""
  else
    [[ -n "${DEMO_HOST_PUBLICO:-}" ]] || erro "defina DEMO_HOST_PUBLICO=<host publico da porta $PORTA> (ou DEMO_SO_LOOPBACK=1 para teste local)"
    [[ "$DEMO_HOST_PUBLICO" =~ ^[A-Za-z0-9.-]+$ ]] || erro "DEMO_HOST_PUBLICO invalido: '$DEMO_HOST_PUBLICO' (so o nome, sem https:// nem barra)"
    escrever_var APP_HOSTS_PERMITIDOS "$DEMO_HOST_PUBLICO"
  fi
  local novo=0
  if ! grep -qE '^APP_TOKEN_LOCAL=[0-9a-f]{64}$' "$ENV_DEMO"; then escrever_var APP_TOKEN_LOCAL "$(openssl rand -hex 32)"; novo=1; fi
  [[ -f "$RAIZ/.env" ]] && msg "AVISO: $RAIZ/.env existe; as variaveis da demo tem precedencia, mas confira que nao ha segredo nele"
  carregar_env
  pg_start

  if ! vivo mesh; then
    # so o comando vai para segundo plano (o $! e o pid do processo, nao de um subshell)
    ( cd "$RAIZ/services/mesh" || exit 1
      DATA_DIR="$DATA_DIR" nohup "$VENV/bin/python" -m mesh.servidor --host 127.0.0.1 --port "$MESH_PORTA" </dev/null >>"$LOGS/mesh.log" 2>&1 &
      echo $! > "$RUN/mesh.pid" )
    esperar "http://127.0.0.1:$MESH_PORTA/saude" "200" mesh 120 || { tail -n 30 "$LOGS/mesh.log" >&2; erro "services/mesh nao subiu"; }
    msg "services/mesh em 127.0.0.1:$MESH_PORTA"
  fi
  if ! vivo web; then
    ( cd "$RAIZ/apps/web" || exit 1
      NODE_ENV=production nohup node node_modules/next/dist/bin/next start -H "$host_escuta" -p "$PORTA" </dev/null >>"$LOGS/web.log" 2>&1 &
      echo $! > "$RUN/web.pid" )
    # 401 = no ar e exigindo token (a subida recusada encerra o processo)
    esperar "http://127.0.0.1:$PORTA/api/config" "401" web 120 || { tail -n 30 "$LOGS/web.log" >&2; erro "web nao subiu (subida recusada? veja $LOGS/web.log)"; }
    msg "web em $host_escuta:$PORTA (DEMO_SINTETICA=1, desenho $DESENHO, LLM mock)"
  fi
  local base="http://127.0.0.1:$PORTA"
  [[ -n "${DEMO_HOST_PUBLICO:-}" && "${DEMO_SO_LOOPBACK:-0}" != "1" ]] && base="https://$DEMO_HOST_PUBLICO"
  if [[ $novo -eq 1 ]]; then
    msg "TOKEN (impresso so desta vez; guarde fora do chat/log e nao compartilhe):"
    printf '\n    %s/?token=%s\n\n' "$base" "$APP_TOKEN_LOCAL"
  else
    msg "abra $base/?token=<token ja impresso> (ou leia APP_TOKEN_LOCAL em $ENV_DEMO)"
  fi
  msg "ENCERRE apos o teste: bash scripts/demo_sandbox.sh parar (e pare o sandbox)"
}

parar_proc() {
  if vivo "$1"; then
    local pid; pid="$(cat "$RUN/$1.pid")"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
    msg "$1 parado"
  fi
  rm -f "$RUN/$1.pid"
}

cmd_parar() { parar_proc web; parar_proc mesh; pg_stop; msg "Postgres parado"; }

cmd_status() {
  for p in web mesh; do vivo "$p" && msg "$p: no ar (pid $(cat "$RUN/$p.pid"))" || msg "$p: parado"; done
  PGBIN="$(pg_bin 2>/dev/null || true)"; pg_pronto && msg "postgres: no ar (127.0.0.1:$PG_PORTA)" || msg "postgres: parado"
  msg "GET /api/config sem token -> $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/api/config" || true) (esperado 401)"
}

cmd_novo_token() {
  [[ -f "$ENV_DEMO" ]] || erro "falta $ENV_DEMO (rode 'preparar')"
  local t; t="$(openssl rand -hex 32)"
  escrever_var APP_TOKEN_LOCAL "$t"
  msg "novo token (impresso so desta vez): $t"
  msg "rode 'parar' e 'subir' para valer; o cookie antigo deixa de funcionar"
}

cmd_recriar_banco() {
  checar_pasta_demo "$DEMO_DIR" DEMO_DIR
  carregar_env
  parar_proc web
  pg_start
  psql_admin "drop database if exists $DB_NOME with (force)" >/dev/null
  rm -rf "${DATA_DIR:?}/pacientes" "$DATA_DIR/validacao" "$DATA_DIR/benchmark"
  banco
  msg "banco e dados da demo recriados (torsos sinteticos mantidos); rode 'subir'"
}

cmd_apagar() {
  # so apaga pastas criadas por este script (marcador); nunca um DEMO_DIR/DEMO_PG_DIR apontado por engano
  local d
  for d in "$DEMO_DIR" "$PG_DIR"; do
    [[ ! -e "$d" || -f "$d/$MARCADOR" ]] || erro "$d existe mas nao tem o marcador $MARCADOR: nao apago (confira DEMO_DIR/DEMO_PG_DIR)"
  done
  cmd_parar || true
  for d in "$PG_DIR" "$DEMO_DIR"; do
    if [[ -d "$d" ]]; then rm -rf -- "$d"; msg "$d apagado"; fi
  done
}

case "${1:-}" in
  preparar) cmd_preparar ;;
  subir) cmd_subir ;;
  parar) cmd_parar ;;
  status) cmd_status ;;
  novo-token) cmd_novo_token ;;
  recriar-banco) cmd_recriar_banco ;;
  apagar) cmd_apagar ;;
  *) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
