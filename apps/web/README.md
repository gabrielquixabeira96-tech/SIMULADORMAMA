# apps/web — placeholder (Marco 0)

App Next.js (App Router) + TypeScript + react-three-fiber. **Ainda não implementado**; este README fixa o que o agente web deve construir e onde.

Leia antes de codar: `docs/contratos.md` (inteiro), `docs/adr/0001`, `0002`, `0003`, `0005`, `0006`, `0007`, `0010`, `0011`, e `config/schemas/`.

## Escopo (Marcos 1, 2 e 2b)

- Upload OBJ/PLY/ZIP → `POST /api/malhas` → `services/mesh` `/processar` (contratos §7.2) → viewer GLB (mm, Y-up, sem escala no loader; rejeitar GLB sem `asset.extras.unidade == "mm"`).
- Calibração por régua (2 cliques + comprimento) → `/reescalar`; ordem obrigatória processar → calibrar → landmarks.
- Landmarks por clique com os **IDs canônicos** (§2), raycast three.js; euclidianas no cliente; geodésicas/volume via `/medir` (ADR 0011).
- Formulário TEPID gerado de `config/tepid.json` (`campos`); `regras`/`tabelas` só em `DESENHO=B`.
- Catálogo: zod em `packages/contratos` espelhando `config/schemas/catalogo.schema.json`; seed idempotente em `implantes`.
- Simulação: carregar `morphs/manifest.json` + `.glb` por (plano, imf); slider antes/depois; comparação lado a lado; envelope ±`envelope_rms_mm` ao longo das normais; aviso fixo.
- LLM: `ProvedorLLM` com `ProvedorAnthropic` e `ProvedorMock`; tool use com os schemas de `config/schemas/`; `verificarNumeros` travado (ADR 0006).
- PDF do atendimento (versão, parâmetros, simulações mostradas, aviso, placeholder de assinatura ICP-Brasil).
- Postgres: migrations SQL em `apps/web/db/migrations/` a partir do DDL de `contratos.md` §17; auditoria em toda leitura/escrita.
- Flag `DESENHO` em `src/config/desenho.ts` (`getDesenho`, `recursoAtivo`), testes A/B (ADR 0005).

## Estrutura sugerida

```
apps/web/
  package.json            # name: "web"; scripts: dev, build, lint, typecheck, test, test:e2e, db:migrate, db:seed
  next.config.ts          # injeta APP_VERSION a partir de ../../VERSION
  src/app/                # rotas (App Router) e route handlers /api/*
  src/config/desenho.ts   # flag A/B
  src/viewer/             # R3F: carregamento GLB, landmarks, régua, morphs, envelope
  src/medidas/            # euclidianas, chamada /medir, quadro anatômico (fórmula §1.1)
  src/tepid/              # formulário e avaliação de regras (só B)
  src/llm/                # provedor, higienizar.ts, verificarNumeros.ts, mocks/*.json
  src/pdf/                # template travado
  db/migrations/          # SQL numerado
  tests/                  # vitest (unit + contrato) ; e2e/ (playwright, projetos desenho-A e desenho-B)
```

Nunca coloque malhas, texturas ou PDFs em `public/`; sirva por rota autenticada e auditada (ADR 0003).
