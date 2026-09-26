# Registros de decisão de arquitetura (ADR)

Formato: contexto, decisão, alternativas consideradas, consequências. Um ADR é imutável depois de aceito; mudança de rumo = novo ADR que supersede o anterior. `ESTRATEGIA.md` é a fonte da verdade; qualquer desvio dela entra só por ADR (regra da `docs/PROMPT.md`).

| Nº | Título | Status |
|---|---|---|
| [0001](0001-pipeline-e-fronteiras.md) | Pipeline, fronteiras dos componentes e monorepo (pnpm) | aceito |
| [0002](0002-esquema-de-dados.md) | Esquema de dados (Postgres, pseudonimização, auditoria) | aceito |
| [0003](0003-upload-de-malhas.md) | Upload, processamento e armazenamento de malhas | aceito |
| [0004](0004-residencia-de-dados-brasil.md) | Residência de dados no Brasil | aceito |
| [0005](0005-flag-desenho-a-b.md) | Feature flag `DESENHO=A|B` | aceito |
| [0006](0006-camada-llm.md) | Camada do LLM (dados estruturados, tool use, mock) | aceito |
| [0007](0007-banco-local.md) | Banco local: PostgreSQL 16 nativo | aceito |
| [0008](0008-worktrees-e-propriedade-de-pastas.md) | Desvio: sem worktrees; mapa de propriedade de pastas | aceito |
| [0009](0009-licencas.md) | Licenças permitidas e proibidas | aceito |
| [0010](0010-coordenadas-e-unidades.md) | Sistema de coordenadas e unidades (mm, Y-up, glTF em mm) | aceito |
| [0011](0011-antropometria-referencia-python.md) | Geodésica e volume calculados só no `services/mesh` | aceito |
