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
- **Proxy TLS no `?token=`.** Com `DEMO_SINTETICA=1` ou `APP_CONFIAR_PROXY_TLS=1`, o redirecionamento usa `X-Forwarded-Proto`/`-Host`: vai para `https://` e grava o cookie `Secure`. O host encaminhado precisa estar permitido e é o comparado com o `Origin`. No modo local padrão, esses cabeçalhos continuam ignorados.
- **Trace do build (deploy em Functions, opções B/C).** `outputFileTracingIncludes` passa a incluir `pnpm-workspace.yaml`, que `raizRepo()` usa para achar a raiz, e `docs/validacao/*.json` (planilha do art. 5º). Sem isso, o pacote rastreado não achava a raiz do repositório em runtime.
- **Testes.**
  - `tests/unit/demoSintetica.test.ts`;
  - guardas do script em `tests/unit/scripts.test.ts`;
  - faixa em `tests/ui/paineis.test.tsx`;
  - e2e `e2e/demo.spec.ts`: projeto `demo` do Playwright, num terceiro servidor (:3103) com banco próprio `<teste>_e2edemo`, criado, marcado e apagado no teardown.
