# ADR 0018 — Modo "demonstração sintética" na rede (`DEMO_SINTETICA=1`)

Status: aceito · Data: 2026-09-27 · Versão: v0.1.3 (em desenvolvimento) · Relaciona: ADR 0003 (revisões v0.1.1 e v0.1.2: token, `Host`, benchmark na rede e a pendência "fora do loopback"), ADR 0004 (residência de dados), ADR 0005 (flag A/B), ADR 0006 (LLM em mock), ADR 0007 (Postgres local)

## Contexto

O Gabriel quer testar o produto real (viewer, régua, landmarks, medidas B com geodésica e volume, TEPID, morphs, slider, comparação em 2 painéis, relatório/PDF, sessão de Bland-Altman e `/benchmark`) fora do computador do consultório, no iPad e por HTTPS, antes de qualquer piloto. O plano de deploy (opção A) escolheu rodar a pilha inteira (Next + `services/mesh` + Postgres local + `DATA_DIR` próprio) num Vercel Sandbox em `gru1`, só com torsos sintéticos, LLM em mock e desenho B. As opções B e C (Vercel Functions) ficam para a fase 3: web e `services/mesh` trocam arquivos por disco compartilhado, que uma função não tem.

O sandbox expõe a porta por uma URL pública que **não** fica atrás da Deployment Protection do Vercel. A instância precisa, portanto, de um modo explícito, imposto pela configuração, que garanta três coisas: nenhum dado real entra, nenhum dado sai do Brasil e fica claro para quem usa que aquilo é demonstração. É a pendência registrada no fim do ADR 0003 ("escutar fora do loopback sem modo benchmark expõe todas as rotas") resolvida para um caso: a instância sem nenhum dado de paciente.

## Decisão

1. **Variável de servidor `DEMO_SINTETICA`**, lida em runtime e nunca `NEXT_PUBLIC_*`, com a mesma lógica da flag do ADR 0005 e do modo benchmark na rede. `1` liga. Vazio ou `0` desliga, e esse é o padrão. Qualquer outro valor (`true`, ` 1`) faz a **subida recusar**, porque um valor ignorado em silêncio desligaria a demo que o operador achou ter ligado. Sem a variável, o comportamento é idêntico ao da v0.1.2: há testes de tabela para isso.
2. **Entradas de dado real fechadas.** `POST /api/malhas` (upload de scan) e `POST /api/llm/anamnese` (texto livre da consulta) respondem `403 desligado_na_demo`. A premissa original, de que a anamnese seria a única rota a levar prosa ao banco, estava **errada**. A revisão de segurança achou `versao_config_simulacao` aceitando texto livre, que ia ao banco, ao relatório e ao PDF, e a observação da sessão de Bland-Altman. Os dois foram fechados; a varredura completa está na seção "Revisão de segurança" abaixo. O bloqueio fica no proxy, depois do token: sem token a resposta continua `401`. Como defesa em profundidade, as duas rotas também recusam sozinhas e `registrarMalha` não aceita malha não sintética. Só são utilizáveis os torsos **gerados pelo `services/mesh`**, ou seja, os que têm `parametros.json` com `esquema: "torso_parametros/1.0"` e o mesmo nome. Isso vale para a listagem, os arquivos, a importação e a sessão de Bland-Altman. Um scan copiado para `sinteticos/` não aparece. A UI esconde o envio, a pré-visualização de arquivo local e a anamnese. TEPID (números), relatório e PDF (template + mock) continuam ligados.
3. **Subida recusa** (`config/subida.ts`, chamada por `instrumentation.ts`, com `process.exit(1)`):
   - ambiente:
     - `ANTHROPIC_API_KEY` não vazia;
     - `LLM_MODO` diferente de `mock` (tem de ser explícito);
     - `APP_TOKEN_LOCAL` fraco: menos de 32 caracteres, menos de 10 distintos, periódico, sequencial, com palavra de exemplo, ou entropia empírica (Shannon × comprimento) abaixo de 96 bits. `openssl rand -hex 32` passa com folga;
     - `DATABASE_URL` vazio;
   - dados:
     - banco **sem a marca** `simulador-mamario:demo-sintetica` (`COMMENT ON DATABASE`). A marca só é gravada por `migrar.ts --marcar-demo`, e só se o banco não tiver nenhum paciente, de modo que o banco do consultório nunca vira demo;
     - qualquer `malhas.sintetica = false`;
     - qualquer `atendimentos.anamnese` gravada (o texto livre é fechado na demo; se há anamnese, o banco não é da demo);
     - em `DATA_DIR/pacientes`, pasta de pseudônimo que não esteja no banco, ou `malhas/<id>` que não seja malha sintética registrada.

     Um paciente sem malha (só o pseudônimo, TEPID ou relatório) é aceito: o esquema não guarda identidade (ADR 0002), e ele só existe num banco que já passou pela marca.
4. **Demo × benchmark na rede.** No modo demo, o modo "benchmark na rede" do ADR 0003 (revisão v0.1.2) **não se aplica**, mesmo com `BENCHMARK_HABILITADO=1` e host público em `APP_HOSTS_PERMITIDOS`. O app inteiro atende no host público, e o modo demo liga o `/benchmark` por conta própria. Justificativa: a restrição do benchmark na rede (só três rotas, sem banco, sem `pacientes/`) existe para que uma instância exposta nunca sirva dado de paciente. A demo alcança o mesmo objetivo por outro caminho: a subida atesta que banco e `DATA_DIR` só têm dado sintético, e as duas entradas de dado real ficam fechadas. Aplicar a restrição do benchmark quebraria a demo, que precisa de banco e das rotas da consulta, sem proteger nada a mais. Continuam valendo:
   - token obrigatório em **todas** as rotas, inclusive `/benchmark`;
   - checagem de `Host` (`APP_HOSTS_PERMITIDOS`);
   - `Origin`/`Content-Type` nas rotas mutantes;
   - os cabeçalhos de segurança.
5. **Proxy TLS.** O redirecionamento do `?token=` montava `Location` com o protocolo da URL interna, que sai `http://` atrás do proxy do sandbox, e o cookie não recebia `Secure`. `X-Forwarded-Proto` (só `http`/`https`; lista → primeiro valor) e `X-Forwarded-Host` passam a ser honrados **só** com `DEMO_SINTETICA=1` ou `APP_CONFIAR_PROXY_TLS=1`. Com eles:
   - o `Location` sai `https://<host público>`;
   - o cookie sai `Secure; HttpOnly; SameSite=Strict`;
   - o host encaminhado também precisa estar em `APP_HOSTS_PERMITIDOS` (senão, `403 host_nao_permitido`) e passa a ser o host comparado com o `Origin`.

   No modo local padrão, esses cabeçalhos são ignorados: quem fala direto com o Next poderia forjá-los.
6. **Faixa fixa** "DEMONSTRAÇÃO — dados sintéticos, não é previsão clínica" no topo de **todas** as páginas, inclusive o 404. Ela fica na mesma barra fixa do aviso "Ilustração, não previsão de resultado" (restrição 3), que continua lá. `GET /api/config` expõe `demo: true`.
7. **Subida reprodutível** por `scripts/demo_sandbox.sh preparar|subir|parar|status|novo-token|recriar-banco|apagar`, documentada em `docs/deploy-demo.md`. O script cria:
   - estado fora do repositório (`DEMO_DIR`, 0700);
   - cluster Postgres próprio, só em `127.0.0.1`, com banco marcado;
   - torsos e morphs gerados no próprio sandbox;
   - token aleatório de 256 bits, impresso uma única vez;
   - mesh em loopback e web em `0.0.0.0` com `DESENHO=B` e `LLM_MODO=mock`.

## Alternativas

- **Reusar o modo benchmark na rede e liberar mais rotas**: esse modo pressupõe instância sem banco, e a consulta precisa de banco. Misturar os dois conceitos tornaria a regra do ADR 0003 condicional ao que a rota faz. Rejeitada: é mais claro ter um modo novo, atestado pelos dados.
- **Deployment Protection / Vercel Authentication na frente**: não cobre a URL do sandbox (a confirmar no painel). Nas opções B/C (Functions) volta a ser a primeira camada, junto do token.
- **Confiar sempre em `X-Forwarded-*`**: no modo local o Next fala direto com o navegador, e um cliente poderia forjar o host/protocolo do redirecionamento. Rejeitada; fica atrás de configuração explícita.
- **Recusar paciente sem malha sintética**: bloquearia o religamento depois de um "novo atendimento" sem importação, sem ganho real (o pseudônimo não é dado pessoal identificável e o banco já é atestado pela marca). Rejeitada.
- **Upload aberto com aviso**: rejeitada. É por essa porta que um dado real entraria numa URL pública.

## Consequências

- Instância de demonstração exposta por HTTPS sem dado de paciente, sem chave de LLM e sem saída de dado do Brasil (mock; a política de rede do sandbox pode ir para `deny-all` depois do `preparar`).
- A proteção de acesso é só o token do app, e a URL do sandbox fica fora da Deployment Protection. Mitigações: token de 256 bits, HTTPS terminado pelo Vercel, cookie `Secure`, vida curta do sandbox e nada real lá dentro. O token impresso fica nos logs de comando do sandbox, na conta Vercel (ver `docs/deploy-demo.md`).
- A pendência geral do ADR 0003 continua valendo para a instância clínica: escutar fora do loopback sem um dos dois modos (benchmark na rede ou demo) ainda não é recusado na subida.
- Testes:
  - `tests/unit/demoSintetica.test.ts`: proxy, proxy TLS, "sem a variável nada muda", recusas de ambiente e de dados, torsos utilizáveis e defesa em profundidade nas rotas;
  - `tests/ui/paineis.test.tsx`: a faixa;
  - `tests/unit/scripts.test.ts`: as guardas do script;
  - `e2e/demo.spec.ts`: projeto `demo` do Playwright, num terceiro servidor com banco próprio `<teste>_e2edemo` criado, marcado e apagado no teardown. Cobre a faixa em todas as páginas, upload e anamnese 403, `?token=` com `X-Forwarded-*` → `https://` + `Secure`, e o fluxo com o torso t01 até medidas B e relatório.

## Revisão de segurança (2026-09-27, mesma v0.1.3 em desenvolvimento)

A revisão independente reprovou a primeira versão com 2 bloqueantes, corrigidos assim:

- **B1 — PDF e planilha sem marca de demo.**
  - O relatório gerado na demo leva `demo: true`, na resposta de `/api/relatorio` e no payload gravado.
  - O PDF desenha a faixa "DEMONSTRAÇÃO — dados sintéticos, não é previsão clínica" numa tarja no topo e no rodapé de **todas** as páginas, além da caixa sob o título. Basta o payload ter `demo: true` ou a instância estar em modo demo.
  - A planilha do art. 5º exportada na demo sai com `demo: true`, uma nota no topo, toda linha e todo grupo com fonte `demo:<fonte>` e o arquivo `planilha-art5-DEMO-*.csv`.
  - Sessões de Bland-Altman criadas na demo gravam `demo: true` e saem como `demo:sessao_bland_altman` mesmo exportadas fora dela.
- **B2 — texto livre em `versao_config_simulacao`** (`POST /api/malhas/<id>/simulacoes`): o campo chegava ao banco, ao relatório e ao PDF. Agora:
  - regex `^[0-9A-Za-z._-]{1,32}$`;
  - tem de ser igual à versão de `config/simulacao.json` do servidor (senão `409 versao_config_divergente`);
  - o valor gravado é o do servidor.

**Varredura dos esquemas** de toda rota que grava no banco ou em `DATA_DIR`, ou cujo conteúdo vai para relatório ou PDF: todo campo de texto, com a situação depois da revisão.

| Rota / campo | Situação |
|---|---|
| `POST /api/llm/anamnese` `texto` | prosa por desenho (higienizada, nunca gravada; só o JSON estruturado vai ao banco). **Fechada na demo** (403). |
| `POST /api/malhas/<id>/simulacoes` `versao_config_simulacao` | era `z.string().min(1)`: **corrigido** (regex + igual à do servidor) |
| `POST /api/malhas/<id>/simulacoes` `implante_id`; `POST /api/malhas/<id>/morphs` `implantes[]` | regex de id `^[a-z0-9]+(-[a-z0-9]+)*$` + existência no catálogo |
| `POST /api/malhas` (multipart) `unidade_origem`, `recorte_modo`, nomes de arquivo | enums; os arquivos são renomeados para `scan.<ext>`. **Fechada na demo** (403). |
| `POST /api/validacao/sessoes/<id>/encerrar` `observacoes` | texto limitado (≤ 500, sem `@` nem quebra de linha) por desenho no modo local; **recusada na demo** (403 `desligado_na_demo`; campo escondido na UI) |
| `POST /api/validacao/sessoes` `operador` | código pseudônimo `^[A-Z0-9][A-Z0-9-]{1,15}$`; `torsos[]` `^[a-z0-9_]+$`; `tipo_operador` enum |
| `POST /api/medidas`, `/api/medidas/medir`, `/api/malhas/<id>/morphs`, `/api/validacao/sessoes/<id>/itens/<i>` `landmarks` | chaves do enum canônico; `origem` enum; só números |
| `POST /api/tepid`, `/api/medidas` `valores`/`medidas_digitadas` | só os campos do TEPID, convertidos para número; chave desconhecida → 400 (o nome ecoa na mensagem de erro, mas nunca é gravado) |
| `POST /api/relatorio`, `/api/pdf`, `/api/pacientes`, `/api/sinteticos/<nome>/importar`, `/reescalar` | só uuid, números e nome de torso `^[a-z0-9_]+$` (o corpo de `/api/pacientes` é ignorado) |
| Query strings (`/api/validacao/planilha`, `/api/benchmark/arquivo`, `/api/pdf/<id>`) | enums ou listas fixas; nada gravado |

Não bloqueantes, também corrigidos:
- **N1:** observação da sessão desligada na demo (ver a tabela).
- **N2:** o token da demo tem de ser exatamente `^[0-9a-f]{64}$`. A comparação usa o valor cru, sem trim, na subida e no proxy.
- **N3:** vale o **último** valor de `X-Forwarded-Proto`/`X-Forwarded-Host`, que é o acrescentado pelo proxy de borda. Um valor forjado pelo cliente no começo da lista é ignorado. A verificação no sandbox está em `docs/deploy-demo.md`.
- **N4:** com `DEMO_SINTETICA=1` no build (o script builda assim), `proxyClientMaxBodySize` cai de 520 MB para 2 MB. É o teto do buffer do proxy do Next: acima dele o corpo é truncado. As rotas JSON já limitam em 1 MB (413), e a demo não tem upload. A subida avisa `build_nao_e_da_demo` se o build não for o da demo, como no e2e, que reaproveita o build de teste.
- **N5:** a primeira URL com `?token=` pode ficar nos logs do proxy do Vercel e no histórico do navegador. `docs/deploy-demo.md` recomenda janela privada e `novo-token` ao fim de cada sessão.
- **N6:** o script valida `DEMO_DESENHO` (`A`/`B`) e as portas; `apagar` só remove pastas com o marcador gravado pelo próprio script; a senha do role vai ao `psql` pela entrada padrão, nunca pelo argv.

