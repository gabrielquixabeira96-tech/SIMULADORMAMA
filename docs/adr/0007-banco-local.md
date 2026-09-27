# ADR 0007 — Banco local: PostgreSQL 16 nativo

Status: aceito · Data: 2026-09-26

## Contexto

`PROMPT.md`: "Postgres local via Supabase CLI ou Docker". Verificação do ambiente de desenvolvimento (Linux cloud, 2 CPUs, 7 GB RAM) em 2026-09-26:

- Docker: cliente 29.4.3 presente, **daemon não sobe por padrão** (`/var/run/docker.sock` ausente). `dockerd` iniciado manualmente completa a inicialização, mas não persiste entre sessões, exige `root`, e `docker pull postgres` depende de proxy de saída. Supabase CLI (`supabase start`) depende de ~8 contêineres e da mesma condição.
- PostgreSQL **16.13 nativo** já instalado (`/usr/lib/postgresql/16`, cluster `16/main`, porta 5432), sobe com `service postgresql start` em ~1 s, `psql` e `pg_dump` presentes.
- Sem contas externas permitidas.

## Decisão

1. **Local = PostgreSQL 16 nativo** no cluster `16/main`, banco `simulador`, role `simulador` (senha `simulador`, só local), `DATABASE_URL=postgres://simulador:simulador@127.0.0.1:5432/simulador`. Script `scripts/db.sh` (`start | stop | criar | resetar | psql`) idempotente; a CI chama `scripts/db.sh start criar` antes dos testes de banco e pula esses testes com aviso se o Postgres não estiver disponível.
2. **Mesmo DDL em qualquer Postgres ≥ 15** (migrations SQL, ADR 0002); nada específico de Supabase (sem `auth.users`, sem RLS nesta fase). Migrar para Supabase `sa-east-1` na fase 3 é trocar `DATABASE_URL`.
3. `docker-compose.yml` na raiz com `postgres:16-alpine` e as mesmas credenciais, como **alternativa documentada** para máquinas onde o daemon funciona (o iMac/notebook de Gabriel). O README mostra os dois caminhos.
4. Sem PGlite/SQLite: o web usa `pg` (wire protocol), e paridade de tipos (`jsonb`, `timestamptz`, `gen_random_uuid`) com produção importa mais que conveniência.

## Alternativas

- Supabase CLI local: fidelidade máxima com produção, mas inviável sem daemon Docker persistente. Rejeitada para o ambiente atual; permitida em máquinas locais.
- Docker `postgres:16` como padrão: funcionaria só após `dockerd` manual a cada sessão. Mantida como alternativa.
- PGlite (Postgres em WASM, Apache-2.0): sem servidor, mas não fala o protocolo de rede do `pg` sem camadas extras; divergências sutis. Rejeitada.
- SQLite: incompatível com o DDL e com o alvo `sa-east-1`. Rejeitada.

## Consequências

- Testes de banco rodam em Postgres real, sem mocks de banco.
- Dependência de `service postgresql` no ambiente cloud; se a imagem base mudar, `scripts/db.sh` detecta ausência e orienta (`apt install postgresql-16` ou Docker).
- Senha trivial só existe localmente; `.env.example` deixa isso explícito e `.env*` está no `.gitignore`.
