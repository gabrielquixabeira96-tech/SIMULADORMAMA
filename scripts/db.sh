#!/usr/bin/env bash
# Postgres 16 local (ADR 0007). Uso: bash scripts/db.sh <start|stop|criar|resetar|psql|status> [...]
# Varios comandos podem ser encadeados: bash scripts/db.sh start criar
set -euo pipefail

DB_USER="${DB_USER:-simulador}"
DB_PASS="${DB_PASS:-simulador}"
DB_NAME="${DB_NAME:-simulador}"
DB_NAME_TEST="${DB_NAME_TEST:-simulador_test}"
PORTA="${DB_PORT:-5432}"

como_postgres() {
  # roda um comando como usuario postgres (root -> su; usuario comum -> sudo)
  if [[ "$(id -u)" -eq 0 ]]; then su postgres -c "$*"; else sudo -u postgres bash -c "$*"; fi
}

tem_nativo() { command -v pg_lsclusters >/dev/null 2>&1 && pg_lsclusters 2>/dev/null | grep -qE '^16'; }
tem_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
pronto()     { pg_isready -h 127.0.0.1 -p "$PORTA" >/dev/null 2>&1; }

cmd_start() {
  if pronto; then echo "postgres ja esta no ar em 127.0.0.1:$PORTA"; return 0; fi
  if tem_nativo; then
    echo "iniciando PostgreSQL 16 nativo (service postgresql start)"
    if [[ "$(id -u)" -eq 0 ]]; then service postgresql start; else sudo service postgresql start; fi
  elif tem_docker; then
    echo "iniciando via docker compose (alternativa do ADR 0007)"
    docker compose up -d db
  else
    echo "ERRO: nem PostgreSQL 16 nativo nem daemon Docker disponiveis." >&2
    echo "      Instale: apt install postgresql-16   ou   suba o Docker e rode: docker compose up -d db" >&2
    return 1
  fi
  for _ in $(seq 1 30); do pronto && break; sleep 1; done
  pronto || { echo "ERRO: postgres nao respondeu em 30 s" >&2; return 1; }
  echo "postgres pronto em 127.0.0.1:$PORTA"
}

cmd_stop() {
  if tem_nativo; then
    if [[ "$(id -u)" -eq 0 ]]; then service postgresql stop; else sudo service postgresql stop; fi
  elif tem_docker; then docker compose stop db; fi
}

sql_admin() {
  # executa SQL como superusuario, no nativo (peer auth) ou no docker
  if tem_nativo; then como_postgres "psql -v ON_ERROR_STOP=1 -p $PORTA -tAc \"$1\""
  else docker compose exec -T db psql -U "$DB_USER" -v ON_ERROR_STOP=1 -tAc "$1"; fi
}

cmd_criar() {
  pronto || cmd_start
  if tem_nativo; then
    if [[ "$(sql_admin "select 1 from pg_roles where rolname='$DB_USER'")" != "1" ]]; then
      sql_admin "create role $DB_USER login password '$DB_PASS'"
      echo "role $DB_USER criada"
    fi
    for db in "$DB_NAME" "$DB_NAME_TEST"; do
      if [[ "$(sql_admin "select 1 from pg_database where datname='$db'")" != "1" ]]; then
        sql_admin "create database $db owner $DB_USER encoding 'UTF8'"
        echo "banco $db criado"
      fi
    done
  else
    # no docker o POSTGRES_DB ja existe; garante o de teste
    if [[ "$(sql_admin "select 1 from pg_database where datname='$DB_NAME_TEST'")" != "1" ]]; then
      sql_admin "create database $DB_NAME_TEST owner $DB_USER encoding 'UTF8'"
    fi
  fi
  echo "DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:$PORTA/$DB_NAME"
}

cmd_resetar() {
  pronto || cmd_start
  for db in "$DB_NAME" "$DB_NAME_TEST"; do
    sql_admin "drop database if exists $db with (force)"
  done
  cmd_criar
}

cmd_psql() { PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$PORTA" -U "$DB_USER" -d "$DB_NAME" "$@"; }
cmd_status() { pronto && echo "no ar (127.0.0.1:$PORTA)" || echo "fora do ar"; }

[[ $# -ge 1 ]] || { echo "uso: $0 <start|stop|criar|resetar|psql|status> [...]" >&2; exit 2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    start) cmd_start ;;
    stop) cmd_stop ;;
    criar) cmd_criar ;;
    resetar) cmd_resetar ;;
    status) cmd_status ;;
    psql) shift; cmd_psql "$@"; exit $? ;;
    *) echo "comando desconhecido: $1" >&2; exit 2 ;;
  esac
  shift
done
