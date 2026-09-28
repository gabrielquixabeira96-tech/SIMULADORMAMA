# Simulador 3D de mamoplastia de aumento

Simulador em tempo real do resultado de mamoplastia de aumento com prótese, para uso na consulta. Versão **`0.1.2`**: MVP técnico dos Marcos 0, 1, 2 e 2b (fases 0–2 da estratégia), com dados **sintéticos** apenas — sem pacientes reais, sem deploy.

Fonte da verdade do produto: [`ESTRATEGIA.md`](ESTRATEGIA.md). Escopo desta execução: [`docs/PROMPT.md`](docs/PROMPT.md). Contratos entre os componentes: [`docs/contratos.md`](docs/contratos.md). Decisões: [`docs/adr/`](docs/adr/README.md). Registro de validação desta versão: [`docs/validacao/v0.1.2.md`](docs/validacao/v0.1.2.md) (v0.1.2 = CI honesta, registros de validação gerados por comando com glTF-Validator, ADR 0016, latência de 2 painéis e `/benchmark`, sessão de Bland-Altman com operador humano e planilha do art. 5º; mudanças em [`mudancas-v0.1.2.md`](docs/validacao/mudancas-v0.1.2.md)).

> Aviso fixo do produto: **"Ilustração, não previsão de resultado"**. Toda superfície simulada é exibida com envelope de incerteza (±4,5 mm RMS, configurável em `config/simulacao.json`). Não há compartilhamento nem exportação para redes sociais (Res. CFM 2.336/2023). Coeficientes da simulação **não calibrados**; limiares TEPID a **conferir no texto original**; catálogo **não verificado** com os fabricantes.

## Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | 22.x | `node -v` |
| pnpm | 10.x | `corepack enable` (usa `packageManager` do `package.json`) ou `npm i -g pnpm@10` |
| Python | 3.11 | com `venv` (`python3 -m venv`) |
| PostgreSQL | 16 | nativo (`apt install postgresql-16`) **ou** Docker (`docker compose up -d db`) — ADR 0007 |
| Chromium p/ e2e | o do Playwright 1.56 | `pnpm --filter web exec playwright install chromium` se ainda não houver (nesta máquina já está em `/opt/pw-browsers`) |

## Do zero até a tela de consulta

```bash
git clone <repo> simulador-mamario && cd simulador-mamario

# 1. ambiente (DESENHO=B por padrão; LLM em modo mock sem ANTHROPIC_API_KEY)
cp .env.example .env
# token local (ADR 0003): obrigatório em `next start`, recomendado em `next dev`
sed -i "s/^APP_TOKEN_LOCAL=.*/APP_TOKEN_LOCAL=$(openssl rand -hex 24)/" .env

# 2. dependências
pnpm install --frozen-lockfile          # apps/web + packages/contratos
bash scripts/mesh.sh venv               # services/mesh/.venv (numpy, trimesh, pygeodesic, fastapi, ...)

# 3. banco local (bancos simulador e simulador_test, role simulador) + migrations
bash scripts/db.sh start criar
pnpm --filter web db:migrate

# 4. torsos sintéticos do Marco 0 (com gabarito) em data/sinteticos/
bash scripts/mesh.sh torsos

# 5. rodar (dois terminais)
bash scripts/mesh.sh dev                # services/mesh em http://127.0.0.1:8765
pnpm --filter web dev                   # só em 127.0.0.1:3000   (DESENHO=A pnpm --filter web dev para o desenho A)
# 6. abra UMA vez com o token (vira cookie HttpOnly; o token some da URL):
#    http://127.0.0.1:3000/?token=<valor de APP_TOKEN_LOCAL no .env>
```

**Segurança local (ADR 0003, revisão v0.1.1).** O app escuta só em `127.0.0.1` e o proxy (`apps/web/src/proxy.ts`) exige o token `APP_TOKEN_LOCAL` em toda rota — pelo cookie gravado no passo 6 ou por `Authorization: Bearer <token>` (scripts, `curl`). Nas rotas `/api/*` que gravam, só aceita `Content-Type: application/json` (o upload aceita multipart) vindo da própria origem. Sem o token, `next start` não sobe; em `next dev` ele é opcional (aviso no log), mas as checagens de origem continuam.

Na tela: "Novo atendimento" (pseudônimo) → envie um OBJ/PLY (ou "processar" um torso sintético) → régua → landmarks → medidas/TEPID → implantes e "Gerar simulação" → anamnese → relatório → PDF.

Parar tudo: `Ctrl+C` nos dois terminais e `bash scripts/db.sh stop`.

## Testes e qualidade

```bash
bash scripts/ci.sh                          # CI completa: venv, contratos/configs, pacotes proibidos, licenças, lint, typecheck,
                                            # Vitest de contratos e do web (banco OBRIGATÓRIO), Playwright A e B contra o
                                            # stack real, ruff + pytest; resumo em test-results/ci-resumo.json
bash scripts/ci.sh --sem-e2e                # idem, sem Playwright (mais rápido)
bash scripts/ci.sh --sem-db                 # só se não houver Postgres: testes de banco pulados e a execução
                                            # marcada "sem banco" (não vale como validação)

pnpm --filter web lint                      # ESLint
pnpm --filter web typecheck                 # next typegen + tsc
pnpm --filter web test                      # Vitest: unit, API A/B, banco real, UI, integração com o services/mesh real
                                            # (falha sem Postgres; SEM_DB=1 pula os testes de banco)
pnpm --filter @simulador/contratos test     # paridade zod × config/schemas
pnpm --filter web test:e2e                  # build de teste + Playwright (sobe services/mesh :8799, Next A :3101, B :3102 e
                                            # demo sintética :3103 com banco próprio <teste>_e2edemo, Postgres)
bash scripts/mesh.sh test                   # ruff + pytest do services/mesh
pnpm --filter web build                     # build de produção

bash scripts/validacao.sh                   # regenera docs/validacao/v<VERSION>*.{md,json} a partir dos testes (RDC 657 art. 5);
                                            # rode com a árvore LIMPA: o registro cita `git describe --always --dirty`
bash scripts/licencas.sh                    # regenera THIRD_PARTY_LICENSES.md (falha se houver GPL/LGPL/... ou inventário vazio)
python3 scripts/checar_proibidos.py         # nomes de pacote proibidos (ADR 0009) em manifestos, lockfiles e venv
python3 scripts/validar_config.py           # configs e registros contra config/schemas
```

## Demonstração sintética na rede (experimental)

`bash scripts/demo_sandbox.sh preparar|subir|parar` sobe a pilha inteira numa máquina Linux limpa
(alvo: Vercel Sandbox em `gru1`) com `DEMO_SINTETICA=1`: só torsos sintéticos, upload e anamnese
fechados, LLM em mock, desenho B e faixa "DEMONSTRAÇÃO" em todas as páginas. Passo a passo e riscos
em [docs/deploy-demo.md](docs/deploy-demo.md); decisão no [ADR 0018](docs/adr/0018-demo-sintetica-na-rede.md).
Nunca com dado real.

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `ESTRATEGIA.md`, `docs/PROMPT.md` | Estratégia (fonte da verdade) e escopo/restrições desta execução |
| `docs/contratos.md` | Contratos web ↔ Python: coordenadas (mm, +Y cranial, +Z anterior), landmarks, `medidas/1.0`, API HTTP, glTF/morphs, catálogo, LLM, DDL |
| `docs/adr/` | ADRs 0001–0015 |
| `docs/validacao/` | Registros de validação por versão (consolidado `v<versão>.md/.json` + registros de componente) |
| `config/schemas/` | JSON Schema 2020-12 dos contratos |
| `config/tepid.json`, `config/simulacao.json` | Limiares TEPID (conferir no texto original) e coeficientes da simulação (não calibrados) |
| `config/catalogo/` | Catálogo de implantes (Motiva, Polytech, GC; `exemplo.json` = seed não clínica) |
| `apps/web/` | Next.js 16 + TypeScript + react-three-fiber: consulta, viewer, upload, régua, landmarks, medidas, TEPID, simulação com envelope, anamnese/relatório (LLM), PDF, flag A/B, Postgres com auditoria. Detalhes em `apps/web/README.md` |
| `apps/web/db/migrations/` | DDL versionado (0001 canônico, 0002 auditoria append-only, 0003 relatórios) |
| `apps/web/e2e/` | Playwright: smoke, viewer, fluxo A/B, validação M0/M1, simulação, latência, fluxo completo até o PDF |
| `packages/contratos/` | Tipos TS + zod espelhando `config/schemas` (`@simulador/contratos`) |
| `services/mesh/` | Python/FastAPI: torso sintético + gabarito, recorte, decimação, reescala, geodésica MMP, volume, modelo geométrico e morph targets glTF |
| `scripts/` | `ci.sh`, `db.sh`, `mesh.sh`, `licencas.sh`, `checar_proibidos.py`, `validacao.sh`, `registro_validacao.py`, `validar_config.py` |
| `data/` | `DATA_DIR` local (malhas, medidas, PDFs, sintéticos) — **ignorado pelo git** (qualquer `data/` em qualquer nível, e malhas/texturas fora de `tests/fixtures/`). `DATA_DIR` relativo é resolvido pela raiz do repo no web e no Python |
| `VERSION`, `vercel.json`, `THIRD_PARTY_LICENSES.md` | Versão SemVer; região `gru1` (sem deploy); inventário de licenças |

## Regras que valem para todo código (restrições inegociáveis)

1. O LLM nunca recebe fotos, malhas ou texturas — só JSON pseudonimizado (ADR 0006).
2. Nenhuma imagem real de nudez; testes usam torso sintético paramétrico.
3. Incerteza sempre visível; aviso fixo; nunca imagem simulada sem envelope.
4. Sem botão de compartilhar/exportar para redes.
5. `DESENHO=A|B` lido só no servidor, com testes que provam o que A desliga (ADR 0005).
6. LGPD: `data/` e `.env*` fora do git, IDs pseudonimizados, auditoria append-only, logs higienizados, `gru1`/`sa-east-1` (ADR 0002, 0004).
7. Só licenças MIT/BSD/Apache-2.0 ou equivalentes; a CI roda `scripts/licencas.sh --checar` (ADR 0009).
8. Cada versão tem registro em `docs/validacao/` (a CI falha sem ele).

## Estado dos marcos (v0.1.2)

Números e critérios em [`docs/validacao/v0.1.2.md`](docs/validacao/v0.1.2.md) (gerado por `bash scripts/validacao.sh`); pendências humanas em [`pendencias-v0.1.2.md`](docs/validacao/pendencias-v0.1.2.md).

| Marco | Critério | Situação |
|---|---|---|
| 0 — Fundação | 3 torsos sintéticos no viewer com escala correta; erro ±1 mm contra o gabarito | atingido |
| 1 — Viewer e antropometria | Bland-Altman LoA dentro de ±2 mm em ≥30 pares | atingido com operador simulado; ferramenta para operador humano pronta (`/validacao/bland-altman`, só em B, ADR 0017), sessão com o cirurgião pendente |
| 2 — Catálogo e simulação | latência < 100 ms (1 painel) e p95 ≤ 85 ms (2 painéis); regressão geométrica; monotonicidade; simetria | atingido em SwiftShader; medição no iPad pendente (página `/benchmark`). Sugestão de implante em B ainda `501`, aguardando decisão |
| 2b — LLM e registro | E2E Playwright do upload ao PDF, em A e B | atingido (LLM em mock) |
