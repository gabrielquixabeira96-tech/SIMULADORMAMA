# ADR 0001 — Pipeline, fronteiras dos componentes e monorepo

Status: aceito · Data: 2026-09-26

## Contexto

`ESTRATEGIA.md` (seção "Arquitetura do sistema") define 8 estágios: captura, pré-processamento, antropometria, catálogo, simulação, renderização, LLM e registro. Nesta execução só as fases 0–2 entram, com dados sintéticos; captura iOS, FEBio e surrogate ficam como interfaces. Dois agentes implementarão `apps/web` e `services/mesh` em paralelo sem se falar.

## Decisão

1. **Monorepo** com `pnpm` workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`). Python fica em `services/mesh` fora do workspace pnpm, com `pyproject.toml` próprio e `venv` local. `pnpm` foi escolhido sobre `npm` por instalação estrita (sem dependências fantasmas, importante para o inventário de licenças), store compartilhado (2 CPUs / 7 GB) e suporte nativo no Vercel via `packageManager`.
2. **Fronteira única entre web e Python: HTTP JSON local** (`services/mesh` = FastAPI em `127.0.0.1:8765`), com arquivos trocados por **caminhos relativos a `DATA_DIR`** na mesma máquina. Contrato completo em `docs/contratos.md` §7.
3. **Divisão de responsabilidades** (quem calcula o quê):

| Estágio | Componente | Observação |
|---|---|---|
| Torso sintético, recorte, decimação, OBJ/PLY → GLB | `services/mesh` | Único produtor de `.glb`. |
| Calibração por régua (2 cliques) | `apps/web` decide o fator; `services/mesh` reescala os arquivos | Uma só malha "verdadeira" em disco. |
| Landmarks por clique, distâncias euclidianas | `apps/web` | Raycast three.js; euclidiana é fórmula fechada. |
| Geodésicas, volume, quadro anatômico | `services/mesh` | ADR 0011. |
| Catálogo (JSON → zod → Postgres) | `apps/web` (+ `packages/contratos`) | Extração dos PDFs é tarefa separada. |
| Modelo geométrico, morph targets glTF | `services/mesh` | Config em `config/simulacao.json`. |
| Renderização, slider, comparação, envelope | `apps/web` | Nunca calcula deformação. |
| LLM, PDF, auditoria, flag A/B | `apps/web` | ADR 0005, 0006. |
| FEBio, surrogate ONNX | interfaces vazias | `contratos.md` §12. |

4. **`packages/contratos`** (TypeScript, zod) espelha `config/schemas/*.schema.json`; o Python valida com `jsonschema`. Os `.schema.json` são a forma canônica.
5. Fluxo de uma consulta: upload → `/processar` → calibrar → `/reescalar` → landmarks → `/medir` → TEPID → `/morphs` → viewer (slider/comparação/envelope) → anamnese (LLM) → relatório (template + prosa LLM) → PDF → auditoria.

```
[upload OBJ/PLY] → apps/web ──/processar──▶ services/mesh ──▶ processada.glb + meta.json
                       │◀──── viewer (R3F) ────────────────────────┘
       calibrar régua ─┼──/reescalar──▶ services/mesh
       landmarks ──────┼──/medir──────▶ services/mesh ──▶ geodésicas, volumes
       TEPID digitado ─┤  (config/tepid.json; alertas só em B)
       escolher implantes ┼──/morphs──▶ services/mesh ──▶ morphs/*.glb + manifest.json
       slider/comparação/envelope ◀─┘
       anamnese/relatório ──▶ Claude API (tool use, mock sem chave) — só JSON pseudonimizado
       PDF + auditoria ──▶ Postgres (ADR 0002, 0007)
```

## Alternativas

- **Python via `child_process` a partir do Next.js**: mais simples localmente, mas não migra para worker separado (Railway/Fly, previsto na estratégia) e mistura ciclos de vida. Rejeitada.
- **Tudo em TypeScript (geodésica, decimação em JS/WASM)**: reduz a fronteira, mas perde trimesh/Open3D/pygeodesic e a ponte para FEBio. Rejeitada.
- **Fila/worker assíncrono já agora**: desnecessário para 1 usuário local; `/morphs` síncrono com timeout longo. Adiar.
- `npm` workspaces: aceitável, mas hoisting frouxo dificulta o inventário de licenças. Rejeitado.

## Consequências

- Os dois agentes só precisam de `docs/contratos.md` + `config/schemas/` para serem compatíveis; os testes de contrato de cada lado usam os mesmos exemplos.
- A mesma máquina compartilha `DATA_DIR`; para um worker remoto (fase 3+) o contrato muda apenas o transporte de arquivos (bucket), não os JSONs.
- `services/mesh` sem autenticação escuta só em loopback; expor exige ADR novo.
