<!-- v0.1.3 EM DESENVOLVIMENTO: VERSION continua 0.1.2 e não há registro v0.1.3. Revisar este texto e tirar este comentário no release. -->
## O que mudou (desde v0.1.2)

Sem mudança numérica no modelo: `config/tepid.json`, `config/simulacao.json`, o catálogo e o pipeline do `services/mesh` são os mesmos da v0.1.2. Nada muda no modo local sem as variáveis novas.

- **Modo demonstração sintética na rede (ADR 0018).** Com `DEMO_SINTETICA=1` (desligado por padrão), a instância é dedicada à demonstração com torsos sintéticos, pensada para o Vercel Sandbox em `gru1` por HTTPS.
  - Entradas fechadas: `POST /api/malhas` e `POST /api/llm/anamnese` → `403 desligado_na_demo`. Só torsos gerados pelo `services/mesh` são utilizáveis.
  - Faixa "DEMONSTRAÇÃO — dados sintéticos, não é previsão clínica" em todas as páginas; `/benchmark` ligado.
  - O modo "benchmark na rede" não se aplica: o app inteiro atende no host de `APP_HOSTS_PERMITIDOS`, sempre com token.
  - A subida recusa:
    - `ANTHROPIC_API_KEY`, ou `LLM_MODO` diferente de `mock`;
    - `APP_TOKEN_LOCAL` fraco, ou `DATABASE_URL` vazio;
    - banco sem a marca de demo (gravada por `migrar.ts --marcar-demo`, só em banco vazio);
    - malha não sintética, anamnese gravada, ou pasta estranha em `DATA_DIR/pacientes`.
  - Novo `scripts/demo_sandbox.sh` (preparar/subir/parar/…), documentado em `docs/deploy-demo.md` com os riscos.
- **Revisão de segurança do modo demo (ADR 0018, seção "Revisão de segurança").**
  - O PDF leva a faixa DEMONSTRAÇÃO na tarja e no rodapé de todas as páginas.
  - O relatório sai com `demo: true`.
  - A planilha e as sessões de Bland-Altman ficam marcadas `demo:`.
  - `versao_config_simulacao` deixa de aceitar texto livre (regex e versão do servidor), e o ADR registra a varredura dos esquemas.
  - Na demo: observação da sessão desligada, token exatamente `^[0-9a-f]{64}$`, teto de corpo de 2 MB no build.
  - `X-Forwarded-*` passa a usar o último valor da lista.
  - No script: validação de desenho e portas, `apagar` só com marcador e senha do Postgres fora do argv.
- **Ajustes do deploy real no Vercel Sandbox (gru1) e revisão R1/R2.**
  - `scripts/demo_sandbox.sh`:
    - acha o Postgres 18 (`/usr/lib/postgresql/18/bin`, busca por versão decrescente);
    - instala por `apt` no Ubuntu 26.04 (a imagem observada), com falha clara;
    - com só Python 3.14+ e `pygeodesic` sem wheel `cp314`, usa o Python 3.13 do `uv` (se o `uv` faltar, instala `uv==0.12.19` do PyPI em `$DEMO_DIR/.uv` com `--require-hashes`; MIT OR Apache-2.0).
  - R2: o `preparar` recusa `DEMO_DIR` ou `DEMO_PG_DIR` já existente, não vazio e sem o marcador `.simulador-demo-sintetica`. A mesma guarda roda antes de qualquer `mkdir`/`chown` do cluster e no `recriar-banco`.
  - R1: na demo, o operador da sessão de Bland-Altman precisa ser `OP-NN` (`422 operador_invalido` fora disso).
  - `docs/deploy-demo.md`:
    - imagem, pacotes, Postgres 18, Python via `uv` e timeout de 24 h;
    - `X-Forwarded-*` sobrescritos pelo proxy (observado);
    - `novo-token` antes de parar, porque o snapshot inclui `demo.env`;
    - como retomar, e rede `deny-all` como melhoria registrada.
- **Proxy TLS no `?token=`.** Com `DEMO_SINTETICA=1` ou `APP_CONFIAR_PROXY_TLS=1`, o redirecionamento usa `X-Forwarded-Proto`/`-Host`: vai para `https://` e grava o cookie `Secure`. O host encaminhado precisa estar permitido e é o comparado com o `Origin`. No modo local padrão, esses cabeçalhos continuam ignorados.
- **Trace do build (deploy em Functions, opções B/C).** `outputFileTracingIncludes` passa a incluir `pnpm-workspace.yaml`, que `raizRepo()` usa para achar a raiz, e `docs/validacao/*.json` (planilha do art. 5º). Sem isso, o pacote rastreado não achava a raiz do repositório em runtime.
- **Testes.**
  - `tests/unit/demoSintetica.test.ts`;
  - guardas do script em `tests/unit/scripts.test.ts`, inclusive `DEMO_DIR` alheio (R2);
  - operador `OP-NN` na demo em `tests/unit/demoSintetica.test.ts` e em `e2e/demo.spec.ts` (R1);
  - faixa em `tests/ui/paineis.test.tsx`;
  - e2e `e2e/demo.spec.ts`: projeto `demo` do Playwright, num terceiro servidor (:3103) com banco próprio `<teste>_e2edemo`, criado, marcado e apagado no teardown.
