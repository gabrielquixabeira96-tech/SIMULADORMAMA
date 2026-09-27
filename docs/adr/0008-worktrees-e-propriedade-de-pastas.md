# ADR 0008 — Desvio: sem worktrees; mapa de propriedade de pastas

Status: aceito · Data: 2026-09-26

## Contexto

`PROMPT.md` ("Modo de trabalho") pede subagentes em paralelo "em worktrees separados". O ambiente tem 2 CPUs / 7 GB, um único checkout em `/home/claude/simulador-mamario`, store do pnpm e `venv` do Python que seriam duplicados por worktree, e os agentes desta fase trabalham em árvores de diretórios disjuntas.

## Decisão

1. **Worktrees dispensados nesta fase.** Todos os agentes trabalham no mesmo checkout, no branch `main`, cada um restrito à sua pasta pelo mapa abaixo, e fazem commits pequenos e frequentes (`git add <sua pasta>` explícito, nunca `git add -A`), rebase antes de commitar se `main` avançou.
2. **Mapa de propriedade** (quem pode editar o quê sem coordenação):

| Pasta | Dono | Observação |
|---|---|---|
| `apps/web/**`, `packages/**` | agente web | Inclui migrations SQL e `packages/contratos`. |
| `services/mesh/**` | agente Python | |
| `config/catalogo/*.json` (exceto `exemplo.json`) | agente catálogo | Só adiciona arquivos; não altera o esquema. |
| `config/schemas/**`, `config/tepid.json`, `config/simulacao.json`, `docs/contratos.md`, `docs/adr/**` | orquestrador | Mudança de contrato = novo número de versão + aviso aos dois agentes. |
| `docs/validacao/**`, `VERSION`, `README.md`, `THIRD_PARTY_LICENSES.md`, `scripts/**` | orquestrador | Agentes propõem trechos no relatório; o orquestrador integra. |

3. Um agente que precise de mudança fora da sua pasta **não edita**: descreve a necessidade no relatório (ou usa um arquivo `docs/pendencias/<agente>.md` na sua própria pasta) e o orquestrador decide.
4. Worktrees voltam a ser usados se dois agentes precisarem tocar a mesma pasta (ex.: refatoração cruzada), por ADR ou decisão do orquestrador registrada no commit.

## Alternativas

- Worktrees como pedido: isolamento total, mas duplica `node_modules`/`venv` (memória/disco), exige merge/rebase de branches por agente e não traz ganho quando as pastas já são disjuntas. Rejeitado nesta fase.
- Branch por agente sem worktree: mesmo custo de merge sem o isolamento de disco. Rejeitado.

## Consequências

- Conflito de merge só ocorre se alguém violar o mapa; o revisor confere o `git diff --stat` de cada commit contra a pasta do autor.
- A CI (`scripts/ci.sh`) roda o repositório inteiro, então um agente pode quebrar o build do outro; regra: rodar `scripts/ci.sh` antes de cada commit.
