# Simulador 3D de mamoplastia de aumento

Simulador em tempo real do resultado de mamoplastia de aumento com prótese, para uso na consulta. Versão `0.0.1` — **Marco 0 (fundação)**: ADRs, contratos e esqueleto do monorepo. Nenhum código funcional ainda.

Fonte da verdade do produto: [`ESTRATEGIA.md`](ESTRATEGIA.md). Escopo desta execução: [`docs/PROMPT.md`](docs/PROMPT.md) (fases 0–2, dados sintéticos, sem deploy, sem pacientes reais).

> Aviso fixo do produto: **"Ilustração, não previsão de resultado"**. Toda superfície simulada é exibida com envelope de incerteza (±4,5 mm RMS, configurável). Não há compartilhamento nem exportação para redes sociais (Res. CFM 2.336/2023).

## Mapa do repositório

| Caminho | O que é | Dono (ADR 0008) |
|---|---|---|
| `ESTRATEGIA.md` | Estratégia completa (fonte da verdade) | Gabriel |
| `docs/PROMPT.md` | Escopo, restrições inegociáveis 1–8, marcos 0–2b | Gabriel |
| `docs/adr/` | Registros de decisão de arquitetura (0001–0011) | orquestrador |
| `docs/contratos.md` | **Contratos de dados e arquivos** entre web e Python (coordenadas, landmarks, JSONs, API HTTP, glTF, catálogo, LLM, DDL) | orquestrador |
| `config/schemas/*.schema.json` | Forma executável dos contratos (JSON Schema 2020-12) | orquestrador |
| `config/tepid.json` | Campos, limiares e tabelas do TEPID/High Five — **todos com "conferir no texto original"** | orquestrador |
| `config/simulacao.json` | Coeficientes do modelo geométrico — **todos `nao_calibrado: true`** | orquestrador |
| `config/torsos_presets.json` | Os 3 torsos sintéticos obrigatórios do Marco 0 | orquestrador |
| `config/catalogo/*.json` | Catálogo de implantes por fabricante (`exemplo.json` = seed não clínica) | agente catálogo |
| `apps/web/` | Next.js + TypeScript + react-three-fiber (viewer, landmarks, TEPID, catálogo, simulação, LLM, PDF, auditoria) | agente web |
| `packages/contratos/` | Tipos TS + zod espelhando `config/schemas` | agente web |
| `services/mesh/` | Python (FastAPI): torso sintético, recorte, decimação, geodésicas, volume, morph targets glTF | agente Python |
| `scripts/` | `ci.sh`, `db.sh`, `mesh.sh`, `licencas.sh`, `validar_config.py` | orquestrador |
| `docs/validacao/` | Registros de validação por versão (art. 5º RDC 657/2022) | orquestrador |
| `data/` | `DATA_DIR` local: malhas, medidas, PDFs, sintéticos — **ignorado pelo git** | — |
| `VERSION` | Versão SemVer estampada em todo registro | orquestrador |
| `vercel.json` | Região `gru1` (São Paulo); **sem deploy nesta fase** | orquestrador |

## Pré-requisitos

- Node 22 e pnpm 10 (`corepack enable` ou `npm i -g pnpm@10`)
- Python 3.11 (+ `venv`)
- PostgreSQL 16 nativo **ou** Docker (ADR 0007)

## Comandos

```bash
# 1. ambiente
cp .env.example .env                 # DESENHO=B por padrão; LLM em modo mock
bash scripts/db.sh start criar       # Postgres 16 local (nativo; docker compose como alternativa)

# 2. instalar
pnpm install                         # workspace: apps/web, packages/*
bash scripts/mesh.sh venv            # venv do services/mesh (quando existir pyproject.toml)

# 3. gerar os torsos sintéticos do Marco 0
bash scripts/mesh.sh torsos          # -> data/sinteticos/t01_simetrico_300, t02_assimetrico, t03_pequeno_ptose

# 4. rodar
bash scripts/mesh.sh dev             # FastAPI em http://127.0.0.1:8765
pnpm dev:web                         # Next.js em http://localhost:3000

# 5. qualidade (obrigatório antes de cada commit)
bash scripts/ci.sh                   # contratos + lint + testes web e Python; passos sem alvo são pulados
DESENHO=A pnpm --filter web test:e2e # prova que o modo A desliga medição, volume, alertas, sugestão e números calculados
bash scripts/licencas.sh             # regenera THIRD_PARTY_LICENSES.md
```

## Regras que valem para todo código (resumo das restrições inegociáveis)

1. O LLM nunca recebe fotos, malhas ou texturas — só JSON pseudonimizado (ADR 0006).
2. Nenhuma imagem real de nudez, nunca; testes usam torso sintético paramétrico (ADR 0003, contratos §4).
3. Incerteza sempre visível; aviso fixo; nunca imagem única.
4. Sem botão de compartilhar.
5. `DESENHO=A|B` com testes que provam o que A desliga (ADR 0005).
6. LGPD por padrão: `data/` e `.env*` no `.gitignore`, IDs pseudonimizados, auditoria, logs sem dado pessoal, `gru1`/`sa-east-1` (ADR 0002, 0004).
7. Só licenças MIT/BSD/Apache-2.0 ou equivalentes; lista proibida no ADR 0009.
8. Cada versão tem registro em `docs/validacao/` (a CI falha sem ele).

## Estado dos marcos

| Marco | Status | Critério |
|---|---|---|
| 0 — Fundação | em andamento (ADRs, contratos e esqueleto prontos; gerador de torso e viewer pendentes) | 3 torsos sintéticos abrem no viewer com escala correta; erro ±1 mm no gabarito |
| 1 — Viewer e antropometria | não iniciado | Bland-Altman LoA ±2 mm em ≥30 pares |
| 2 — Catálogo e simulação | não iniciado | latência <100 ms; regressão geométrica; monotonicidade; simetria |
| 2b — LLM e registro | não iniciado | e2e Playwright do upload ao PDF, em A e B |
