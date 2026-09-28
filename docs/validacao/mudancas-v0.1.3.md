<!-- v0.1.3 EM DESENVOLVIMENTO: VERSION continua 0.1.2 e não há registro v0.1.3. Revisar este texto e tirar este comentário no release. -->
## O que mudou (desde v0.1.2)

Sem mudança numérica no modelo de simulação: `config/tepid.json`, `config/simulacao.json`, o catálogo e o caminho scan → medidas → morphs do `services/mesh` são os mesmos da v0.1.2. O `services/mesh` ganha a reconstrução por fotos (último item), que só entra quando uma malha vem de fotos. Nada muda no modo local sem as variáveis novas.

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
- **Reconstrução 3D a partir de fotos e a própria foto editada (ADR 0021; MVP, demo só com fotos sintéticas).** O modelo de simulação (morphs, `config/tepid.json`, `config/simulacao.json`, catálogo) não muda; os torsos presets continuam byte a byte (`torso_parametros/1.1` só acrescenta campos opcionais).
  - `services/mesh`: `mesh/foto/` — câmera pinhole + PnP, template 1.1, ajuste a landmarks 2D + silhueta + escala, fotos sintéticas, rasterizador, segmentação sem pesos (modo `template`), `POST /reconstruir-foto` (`reconstrucao/1.0`); a textura é a foto projetada no atlas UV com o não observado preenchido e marcado (`observado.png`, `textura_reconstruida/1.0` em `meta.json.textura`); `avaliar.py` (`avaliacao_reconstrucao/1.0`) e `mesh.cli fotos-exemplo`.
  - Web: vista "Foto real" no comparador (câmera da foto, alfa pelo deslocamento, 0 pixel alterado fora da mama), cartão de incerteza por eixo (A sem números), selo "modelo 3D estimado de N foto(s)", hachura do não observado, card "Fotos de exemplo" no passo 1 (3 fotos; no t01 também "só a foto de frente") e cartão "Erro contra o gabarito" (só B); texto da escala: a fita SSN–N é medida esticada em linha reta.
  - Contratos: `origem: "foto"` nos landmarks (zod = `medidas.schema.json`), `malha_meta.origem` e `malha_meta.textura` (zod = schema), `torsoGerado` aceita `torso_parametros/1.0` e `1.1`; câmera do C1 com (u, v) contínuos a partir do canto — o web deixou de somar meio pixel; paridade P1 × P2 × web testada (~5·10⁻⁷ px).
  - `scripts/mesh.sh fotos` (CI e `demo_sandbox.sh preparar`, depois dos torsos) prepara `sinteticos/<torso>/foto/` e `t01_simetrico_300/foto_frente/` pelo pipeline real; o e2e usa essas pastas (a fixture escrita à mão saiu); o glTF-Validator passa também nos `foto*/processada.glb`.
  - Números contra o gabarito (fotos sintéticas, pontos e máscara exatos; caso fácil, não vale para paciente real):

    | Torso | Fotos | RMS x / y / z (mm) | Volume D / E | Landmarks máx. | Reprojeção |
    |---|---|---|---|---|---|
    | t01_simetrico_300 | frente + oblíqua D + perfil D | 0,27 / 0,23 / 0,31 | −1,5 % / −0,0 % | 0,74 mm | 0,64 px |
    | t01_simetrico_300 | só frente | 0,57 / 0,45 / 0,99 | −3,8 % / −2,2 % | 4,71 mm | 0,34 px |
    | t02_assimetrico | frente + oblíqua D + perfil D | 0,40 / 0,34 / 0,49 | −7,0 % / −1,6 % | 1,48 mm | 0,77 px |
    | t03_pequeno_ptose | frente + oblíqua D + perfil D | 0,14 / 0,10 / 0,18 | +0,6 % / +0,3 % | 0,45 mm | 0,36 px |
