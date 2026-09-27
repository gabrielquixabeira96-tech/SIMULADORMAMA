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
| [0012](0012-volume-parede-reconstruida.md) | Estimador de volume v2: parede torácica reconstruída | aceito |
| [0013](0013-heuristica-de-unidade.md) | Heurística de unidade por escala logarítmica | aceito |
| [0014](0014-modelo-geometrico-e-morphs.md) | Modelo geométrico-paramétrico v1 e morph targets | aceito |
| [0015](0015-catalogo-base-oval.md) | Catálogo 1.1: pegada oval (`base_forma`) e catálogo real extraído dos PDFs | aceito |
| [0016](0016-desvios-aceitos-v0-1.md) | Desvios aceitos na v0.1.x: geodésica a partir da `posicao`, 403 do `services/mesh` em A, registro gerado por `scripts/validacao.sh` | aceito |
| [0017](0017-sessao-bland-altman-e-planilha-art5.md) | Sessão de Bland-Altman com operador humano (cega ao gabarito, só em B) e planilha de validação do art. 5º | aceito |
| [0018](0018-demo-sintetica-na-rede.md) | Modo "demonstração sintética" na rede (`DEMO_SINTETICA=1`): instância dedicada só com torsos sintéticos, upload e anamnese fechados, proxy TLS | aceito |
