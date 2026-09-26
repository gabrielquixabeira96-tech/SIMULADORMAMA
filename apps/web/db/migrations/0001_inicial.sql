-- 0001_inicial — DDL canônico (docs/contratos.md §17, contrato 1.0).
-- Nenhuma tabela guarda nome, documento, contato ou nascimento (LGPD; ADR 0002).

create extension if not exists pgcrypto;

create table pacientes (
  id           uuid primary key default gen_random_uuid(),
  pseudonimo   text not null unique check (pseudonimo ~ '^P-[0-9A-HJ-NP-Z]{6}$'),
  criado_em    timestamptz not null default now()
);

create table malhas (
  id                     uuid primary key default gen_random_uuid(),
  paciente_id            uuid not null references pacientes(id),
  malha_dir              text not null,                 -- relativo a DATA_DIR
  formato_origem         text not null check (formato_origem in ('obj','ply')),
  unidade_origem         text not null check (unidade_origem in ('m','cm','mm','desconhecida')),
  fator_escala_acumulado double precision not null default 1.0,
  n_vertices_original    integer,
  n_vertices_processada  integer,
  sha256_original        text,
  sha256_glb             text,
  meta                   jsonb not null,                -- malha_meta/1.0
  sintetica              boolean not null default false,
  criado_em              timestamptz not null default now()
);

create table medidas (
  id               uuid primary key default gen_random_uuid(),
  malha_id         uuid not null references malhas(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_software  text not null,
  esquema          text not null default 'medidas/1.0',
  payload          jsonb not null,                      -- medidas/1.0 completo
  criado_por       text not null default 'local',
  criado_em        timestamptz not null default now()
);

create table tepid (
  id               uuid primary key default gen_random_uuid(),
  paciente_id      uuid not null references pacientes(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_config    text not null,                       -- tepid.versao
  valores          jsonb not null,                      -- medidas_digitadas da seção 6
  alertas          jsonb not null default '[]',         -- sempre [] em A
  criado_em        timestamptz not null default now()
);

create table implantes (                                -- cache de config/catalogo/*.json
  id               text primary key,
  fabricante       text not null,
  payload          jsonb not null,                      -- item catalogo/1.0
  verificado       boolean not null default false,
  exemplo_nao_clinico boolean not null default false,
  carregado_em     timestamptz not null default now()
);

create table simulacoes (
  id               uuid primary key default gen_random_uuid(),
  malha_id         uuid not null references malhas(id),
  implante_id      text not null references implantes(id),
  plano            text not null check (plano in ('subglandular','dual_plane')),
  imf              text not null check (imf in ('manter','rebaixar')),
  lado             text not null check (lado in ('ambos','dir','esq')),
  versao_config_simulacao text not null,
  nao_calibrado    boolean not null default true,
  previsto         jsonb,                               -- seção 10.4
  mostrada_em      timestamptz not null default now()   -- cada exibição à paciente é uma linha
);

create table atendimentos (
  id               uuid primary key default gen_random_uuid(),
  paciente_id      uuid not null references pacientes(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_software  text not null,
  anamnese         jsonb,                               -- anamnese/1.0
  relatorio_prosa  jsonb,                               -- relatorio_prosa/1.0
  pdf_caminho      text,                                -- relativo a DATA_DIR
  pdf_sha256       text,
  iniciado_em      timestamptz not null default now(),
  encerrado_em     timestamptz
);

create table auditoria (
  id           bigserial primary key,
  ocorrido_em  timestamptz not null default now(),
  usuario_id   text not null,                           -- 'local' nesta fase
  acao         text not null,                           -- 'visualizou','criou','alterou','exportou','apagou','simulou'
  entidade     text not null,                           -- nome da tabela ou 'arquivo'
  entidade_id  text not null,
  desenho      char(1) not null check (desenho in ('A','B')),
  detalhes     jsonb not null default '{}'              -- NUNCA dado pessoal, nunca caminho absoluto
);
create index auditoria_entidade_idx on auditoria (entidade, entidade_id, ocorrido_em);
