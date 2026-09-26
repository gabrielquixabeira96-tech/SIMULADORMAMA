# ADR 0005 — Feature flag `DESENHO=A|B`

Status: aceito · Data: 2026-09-26

## Contexto

Estratégia regulatória (`ESTRATEGIA.md`, "Regulatório e ética"): piloto in house com o **desenho B** (mede e calcula; art. 5º da RDC 657/2022) e SaaS inicial com o **desenho A** (o cirurgião digita medidas e escolhe o implante; possivelmente fora do escopo de SaMD ou classe I). `PROMPT.md` restrição 5 lista o que A desliga e exige testes que provem isso.

## Decisão

1. **Fonte única**: variável de ambiente `DESENHO` com valores `A` ou `B`. Padrão local `B`. Valor ausente → `B` com aviso no log; valor inválido → o processo não sobe. Lida **só no servidor** (`apps/web/src/config/desenho.ts`, `getDesenho()`), nunca `NEXT_PUBLIC_*`, e entregue ao cliente via prop de Server Component ou `GET /api/config`. Toda linha gravada (`medidas`, `tepid`, `simulacoes`, `atendimentos`, `auditoria`) carrega a coluna `desenho`.
2. **Mapa de recursos** (`recursoAtivo(nome): boolean`), a única forma de consultar a flag no código:

| Recurso | B | A | Efeito em A |
|---|---|---|---|
| `medicao_automatica_3d` | on | off | Landmarks podem ser marcados (âncora da simulação), mas nenhuma distância é calculada, exibida ou gravada (`distancias: null`); `/medir` não é chamado. |
| `volume_calculado` | on | off | `volumes: null`; `incluir_volume` nunca é `true`. |
| `alertas_tepid` | on | off | `tepid.regras`/`tabelas` não são avaliadas; só validação de faixa dos `campos`. `tepid.alertas = []`. |
| `sugestao_implante` | on | off | Catálogo listado em ordem neutra, sem ranking, sem "recomendado". |
| `numeros_calculados_no_relatorio` | on | off | O template do relatório/PDF só recebe `medidas_digitadas` e dados do catálogo; `numeros_permitidos` do LLM exclui qualquer valor calculado. |

O que **não muda** entre A e B: upload, calibração, viewer, simulação com morph targets, envelope de incerteza, aviso fixo, TCLE, PDF, auditoria. A simulação é "ilustração" nos dois modos.

3. **Enforcement em três camadas**: (a) UI não renderiza o componente; (b) rotas de API respondem `403 {"erro":{"codigo":"desligado_no_desenho_a"}}`; (c) o `services/mesh` recebe `X-Desenho` em toda chamada e o grava no log, para auditar que em A nunca chegou `incluir_volume: true`.
4. **Testes obrigatórios**:
   - unitário (Vitest): tabela do mapa para A e B; `DESENHO=X` lança;
   - API (Vitest + handlers): em A, `POST /api/medidas/medir` e `GET /api/catalogo?sugerir=1` → 403;
   - e2e (Playwright, dois projetos `desenho-A` e `desenho-B`): em A, ausência dos `data-testid` `distancias-painel`, `volume-painel`, `tepid-alertas`, `sugestao-implante`, `relatorio-numero-calculado`; em B, presença de todos;
   - contrato: `medidas.schema.json` rejeita `desenho: "A"` com `distancias`/`volumes` não nulos (já implementado no esquema);
   - PDF: em A, o texto extraído do PDF não contém nenhum número que não esteja no conjunto de valores digitados + catálogo.

## Alternativas

- Flag por paciente/atendimento em vez de por instalação: útil no SaaS multi-tenant, mas confunde a validação regulatória (o dossiê descreve *um* produto por instalação). Adiar; a coluna `desenho` por registro já permite migrar.
- Dois builds separados: elimina risco de "vazamento" de B em A, mas dobra CI e deploy. Rejeitado enquanto o enforcement em 3 camadas + testes bastar.
- Flag no cliente (`NEXT_PUBLIC_`): manipulável pelo usuário; rejeitada.

## Consequências

- Todo recurso novo que calcule algo a partir do 3D ou sugira conduta precisa entrar no mapa e nos testes A/B antes do merge (revisão de código exige).
- O modo A é mais pobre por desenho; isso é intencional e documentado no README.

## Revisão v0.1.1 (2026-09-26) — `previsto`, gabarito e lista de permitidos

A revisão da v0.1.0 achou números calculados saindo em A por três caminhos. Correções (todas com teste que confere o **corpo** da resposta):

1. **`previsto` dos morph targets** (deslocamentos previstos pelo modelo): em A o `services/mesh` grava e devolve `previsto: null` quando recebe `X-Desenho: A`; o web anula o campo em `POST /api/malhas/<id>/morphs` e em `GET /api/malhas/<id>/arquivo?nome=morphs/manifest.json` (mesmo que o manifest em disco tenha sido gerado em B); `POST /api/malhas/<id>/simulacoes` com `previsto` não nulo em A → `403 desligado_no_desenho_a`; o cliente só manda `previsto` quando `numeros_calculados_no_relatorio` está ligado. Contrato: `previsto` passa a ser anulável (zod e `morphs_manifest.schema.json`), continua obrigatório.
2. **Gabarito do torso sintético** (`GET /api/sinteticos/<nome>/gabarito.json`): em A saem `distancias: null`, `volumes: null` e sem `parametros.volume_ml`/`n_imf_mm`; os landmarks (âncora) ficam.
3. **Teste do PDF/relatório em A** (item 4 "PDF" acima): o e2e troca a lista de proibidos filtrada por uma **lista de permitidos** — todo número do relatório e do PDF tem de ser um valor digitado, um dado do catálogo dos implantes escolhidos ou uma constante declarada (versão do software, versões das configs, envelope, datas/horas, identificadores UUID/pseudônimo/SHA-256, número de página).
