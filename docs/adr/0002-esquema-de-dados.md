# ADR 0002 — Esquema de dados

Status: aceito · Data: 2026-09-26

## Contexto

Restrição 6 da `PROMPT.md`: nenhum dado de paciente no repositório, IDs pseudonimizados, tabela de auditoria (quem viu o quê, quando), logs sem dado pessoal. Restrição 8: rastreabilidade por versão. `ESTRATEGIA.md` prevê Postgres (+ bucket privado) e guarda de simulações e termo por ≥20 anos no prontuário.

## Decisão

1. **Postgres é o índice; o disco (`DATA_DIR`) guarda os binários** (malhas, texturas, GLBs, PDFs). O banco guarda só caminhos relativos, hashes SHA-256 e metadados JSON. Nada de `bytea` de malha.
2. **Pseudonimização na origem**: a tabela `pacientes` tem apenas `id` e `pseudonimo` (`P-XXXXXX`, alfabeto sem I/O). O vínculo com a identidade fica fora do sistema (prontuário). Nenhuma tabela tem nome, documento, contato, nascimento, e a anamnese passa por higienização antes de ser gravada (ADR 0006).
3. **Registros clínicos são JSON versionado por esquema** (`medidas/1.0`, `anamnese/1.0`, `relatorio_prosa/1.0`) em colunas `jsonb`, com `versao_software` e `desenho` em colunas próprias. Motivo: o contrato é o JSON (validado por schema nos dois lados); colunas relacionais só para o que é filtrado/indexado.
4. **Auditoria append-only** (`auditoria`): toda leitura ou escrita de malha, medida, simulação, relatório ou PDF por rota do Next.js insere `usuario_id, acao, entidade, entidade_id, desenho, detalhes`. `detalhes` nunca contém dado pessoal nem caminho absoluto. Sem `UPDATE`/`DELETE` nessa tabela (revogar no role da aplicação).
5. **Cada exibição de simulação à paciente é uma linha em `simulacoes`** (`mostrada_em`) — é o que o PDF e o TCLE citam ("simulações mostradas").
6. **Catálogo**: `config/catalogo/*.json` é a fonte; a tabela `implantes` é cache carregado por seed idempotente (`upsert` por `id`).
7. Migrations SQL numeradas em `apps/web/db/migrations/`, DDL canônico em `docs/contratos.md` §17. ORM livre (Drizzle recomendado, MIT); o DDL manda.

## Alternativas

- Supabase (Postgres + Storage + Auth) desde já: previsto na estratégia para produção, mas exige conta; local usa Postgres puro com o mesmo DDL (ADR 0007). O Storage vira o `DATA_DIR` remoto na fase 3+.
- Malhas no banco (`bytea`/large objects): simplifica backup, mas malhas de 50–200 MB inflam o banco e o glTF precisa ser servido como arquivo. Rejeitada.
- Esquema totalmente relacional para landmarks/distâncias: mais consultas SQL, porém duplica o contrato JSON e dificulta versionar o esquema. Rejeitada; `jsonb` + índices GIN quando necessário.

## Consequências

- Backup = dump do Postgres + cópia de `DATA_DIR`; os dois com o mesmo `versao_software`.
- A auditoria cresce com cada visualização; aceitável (bigserial, índice por entidade).
- Trocar de ORM não altera o contrato, porque o DDL é o contrato.
