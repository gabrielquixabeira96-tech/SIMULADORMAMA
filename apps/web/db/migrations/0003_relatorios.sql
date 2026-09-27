-- 0003_relatorios — Marco 2b: relatório para a paciente (relatorio/1.0) versionado por atendimento.
-- Cada geração é uma linha (nunca sobrescrita): guarda o texto final EXATO mostrado/impresso
-- (template travado + prosa verificada), os parâmetros e as simulações citadas, para o PDF ser
-- reprodutível. Sem nome, documento, contato ou caminho absoluto.

create table relatorios (
  id               uuid primary key default gen_random_uuid(),
  atendimento_id   uuid not null references atendimentos(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_software  text not null,
  esquema          text not null default 'relatorio/1.0',
  payload          jsonb not null,                      -- relatorio/1.0 completo
  prosa_origem     text not null check (prosa_origem in ('llm','mock','mock_substituto')),
  numeros_ok       boolean not null,                    -- verificação final do texto (sempre true se gravado)
  criado_em        timestamptz not null default now()
);
create index relatorios_atendimento_idx on relatorios (atendimento_id, criado_em);
