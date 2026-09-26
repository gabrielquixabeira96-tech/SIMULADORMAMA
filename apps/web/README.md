# apps/web — consulta (Marcos 0 e 1)

Next.js 16 (App Router) + TypeScript + react-three-fiber/three.js. Contratos: `docs/contratos.md`, `config/schemas/*`, ADRs 0002, 0003, 0005, 0006, 0007, 0010, 0011. Tipos/zod compartilhados em `packages/contratos` (`@simulador/contratos`).

## Comandos

```bash
pnpm install                                   # na raiz
bash scripts/db.sh start criar                 # Postgres 16 local (bancos simulador e simulador_test)
pnpm --filter web db:migrate                   # migrations em db/migrations (idempotente)
DESENHO=B pnpm --filter web dev                # só em 127.0.0.1:3000; abra http://127.0.0.1:3000/?token=<APP_TOKEN_LOCAL> (DESENHO=A para o desenho A)
pnpm --filter web lint | typecheck | test      # ESLint, tsc, Vitest (unit + API + banco + UI)
pnpm --filter web test:e2e                     # build de teste + Playwright contra o stack REAL (ver abaixo)
pnpm --filter web validacao:marcos             # provas dos Marcos 0 e 1 → docs/validacao/v<versao>-web-marcos-0-1.{md,json}
pnpm --filter web validacao:latencia           # benchmark do Marco 2 → docs/validacao/v<versao>-web-marco2-latencia.{md,json}
pnpm --filter web build
```

**E2E / validação** sobem sozinhos: `services/mesh` real (`scripts/mesh.sh dev`, porta 8799), dois `next start` (DESENHO=A :3101, DESENHO=B :3102) e o Postgres de teste (`scripts/db.sh start criar` + migrations), com um `DATA_DIR` temporário que recebe os torsos de `data/sinteticos` (gere antes com `bash scripts/mesh.sh venv && bash scripts/mesh.sh torsos`). O build de teste liga `NEXT_PUBLIC_GANCHOS_TESTE=1`, que expõe `window.__simuladorViewer` (projeção de pontos para pixels, usada para o operador simulado); o build normal não tem o gancho. `tests/integracao/` testa as rotas contra o services/mesh real (sobe um processo Python próprio; pula sem venv/torsos/banco).

O serviço de malha (`services/mesh`, `MESH_SERVICE_URL`, padrão `http://127.0.0.1:8765`) é necessário para upload, calibração e geodésicas/volume; sem ele a UI mostra "aguardando serviço de malha" e nada é gravado. Os testes Vitest usam um mock MSW do contrato HTTP (`tests/helpers/meshMock.ts`), nunca o serviço real. Testes de banco usam `DATABASE_URL_TEST` e se auto-pulam sem Postgres.

## Fluxo da tela de consulta (`/`)

1. Paciente: gera pseudônimo `P-XXXXXX` (sem nome/CPF; o vínculo fica no prontuário).
2. Malha: upload OBJ(+MTL+PNG/JPG)/PLY/ZIP → `POST /api/malhas` → `/processar` (recorte abaixo do pescoço + decimação 30–50 mil vértices) → viewer carrega `processada.glb` (rejeita GLB sem `asset.extras.unidade == "mm"`; nunca escala). Também: pré-visualização local de OBJ/PLY e torsos sintéticos de `DATA_DIR/sinteticos/` (botão com o nome = pré-visualização do GLB do gerador; "processar" = `POST /api/sinteticos/<nome>/importar`, mesmo caminho do upload, com gabarito para conferência). Vistas padronizadas da câmera (frente, oblíquas, perfis, inferiores para o sulco).
3. Calibração: 2 cliques na régua + comprimento → `POST /api/malhas/<id>/reescalar` → `/reescalar`; landmarks anteriores são invalidados.
4. Landmarks: sequência guiada dos 10 IDs canônicos (6 obrigatórios + 4 da base), raycast com `posicao` exata e `vertice` mais próximo.
5. Medidas (só B): euclidianas no cliente; geodésicas e volume ± incerteza via `/medir`. Gravação (`POST /api/medidas`) recalcula no servidor.
6. TEPID digitado: campos/faixas de `config/tepid.json`, nota "conferir no texto original"; alertas e tabelas só em B.

7. Simulação (Marco 2, `src/simulacao/`): escolha MANUAL do implante no catálogo (`EscolhaImplante`, A e B; até 2 para comparar) → `POST /api/malhas/<id>/morphs` (exige os 10 landmarks) → os 4 `.glb` (plano × IMF) são pré-carregados e a troca de plano/IMF/implante não recarrega nada. Slider antes/depois = `morphTargetInfluences`; comparação lado a lado com câmeras sincronizadas; selo "coeficientes não calibrados". Cada combinação mostrada vira linha em `simulacoes` (`POST /api/malhas/<id>/simulacoes`, auditoria `simulou`); `GET` lista (sem `previsto` em A).

**Envelope de incerteza (restrição 3):** `criarCenaSimulada` (`src/simulacao/cena.ts`) é o único caminho para a pele simulada e já a entrega com o envelope ±`envelope_rms_mm` (config/simulacao.json): casca translúcida a +envelope ao longo da normal deformada (mais forte no contorno) + faixa laranja pintada na pele sobre a região que o implante altera. `garantirEnvelope` roda a cada quadro e esconde a pele se o envelope sumir; `tests/unit/cena.test.ts` falha se for possível mostrar simulação sem envelope.

Aviso fixo "Ilustração, não previsão de resultado" no layout raiz; não existe botão de compartilhar/exportar.

**Marco 2b (montado):** `PainelAnamnese` e `PainelRelatorio` ficam logo abaixo da simulação na `Consulta`, com `atendimentoId` compartilhado (criado pela anamnese ou pelo relatório), `malhaId` da malha aberta, `medidaId` do último registro gravado e `desenho` do servidor. E2E do upload ao PDF em A e B: `e2e/completo.spec.ts`.

**Estado da simulação para o relatório/PDF:** `Consulta.tsx` guarda `estadoSimulacao: EstadoSimulacao | null` (tipo em `src/simulacao/PainelSimulacao.tsx`): `malha_id`, `implantes` (id, rótulo, volume, base, projeção), `implante_mostrado`, `comparacao`, `plano`, `imf`, `envelope_rms_mm`, `nao_calibrado`, `modelo`, `versao_config_simulacao` e `previsto` (só em B). O histórico persistido está em `GET /api/malhas/<id>/simulacoes`.

## Flag DESENHO (ADR 0005)

`src/config/desenho.ts` (`getDesenho`, `recursoAtivo`, `exigirRecurso`) lê `DESENHO` só no servidor; inválido → o servidor não sobe (`src/instrumentation.ts`). Mapa em `src/config/recursos.ts`. Em A: UI não renderiza `distancias-painel`, `volume-painel`, `tepid-alertas`; API responde `403 desligado_no_desenho_a` (`/api/medidas/medir`, `/api/catalogo?sugerir=1`, `/api/medidas` com distâncias/volumes); `ClienteMesh.medir` recusa sem tocar a rede; registro grava `distancias`/`volumes` `null`; guardas prontas para sugestão de implante (`src/catalogo/catalogo.ts`) e números do relatório do LLM (`src/llm/numeros.ts`).

## LGPD

Banco só com IDs/pseudônimos; auditoria append-only (gatilho bloqueia UPDATE/DELETE/TRUNCATE) gravada em toda rota que lê/escreve malha, arquivo, medida e TEPID; `src/log/` higieniza logs e `detalhes` da auditoria (CPF, e-mail, telefone, datas, caminhos absolutos, chaves sensíveis). Arquivos só por rota com lista fixa, `Cache-Control: private, no-store`; `data/` nunca entra no bundle (`outputFileTracingExcludes`).
