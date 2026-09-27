# Demonstração sintética no Vercel Sandbox (opção A)

Como subir a pilha inteira do simulador (Next + `services/mesh` + Postgres local + `DATA_DIR` próprio) num Vercel Sandbox em `gru1`, exposta por HTTPS, **só com torsos sintéticos**. A decisão está no [ADR 0018](adr/0018-demo-sintetica-na-rede.md). Serve para testar o produto real no computador e no iPad:

- viewer, régua, landmarks;
- medidas B (geodésica e volume);
- TEPID, morphs, slider, comparação em 2 painéis;
- relatório (mock) e PDF;
- sessão de Bland-Altman;
- `/benchmark`.

> **Nunca com dado real.** Nenhum scan, anamnese, foto, nome ou número de paciente entra nesta instância. Ela é descartável e fica protegida só pelo token.

## O que o modo demo faz

`scripts/demo_sandbox.sh` sobe o web com `DEMO_SINTETICA=1`, `DESENHO=B` e `LLM_MODO=mock`. Nesse modo:

- **Entradas de dado real fechadas.** `POST /api/malhas` (upload) e `POST /api/llm/anamnese` (texto livre) → `403 desligado_na_demo`. A UI esconde o envio, a pré-visualização de arquivo local e a anamnese. Só aparecem os torsos gerados pelo `services/mesh` (`parametros.json` do gerador).
- **Faixa fixa** "DEMONSTRAÇÃO — dados sintéticos, não é previsão clínica" em todas as páginas, junto do aviso "Ilustração, não previsão de resultado".
- **Token obrigatório em toda rota**, inclusive `/benchmark`. `Host`, `Origin` e `Content-Type` continuam valendo.
- **App inteiro e `/benchmark` no host público.** O modo "benchmark na rede" do ADR 0003 não se aplica aqui, porque ele protege dado de paciente e esta instância não tem nenhum (ver ADR 0018, item 4).
- **PDF, relatório e planilha marcados.** O PDF tem a faixa em todas as páginas, o relatório sai com `demo: true` e a planilha com fonte `demo:`. A observação livre da sessão de Bland-Altman fica desligada.
- **Proxy TLS.** O `?token=` redireciona para `https://<host público>` e grava o cookie `Secure; HttpOnly; SameSite=Strict`, a partir de `X-Forwarded-Proto`/`X-Forwarded-Host`.
- **Operador da sessão de Bland-Altman só como `OP-NN`** (ex.: `OP-01`; revisão R1). Qualquer outro código, mesmo um pseudônimo válido fora da demo, é recusado com `422 operador_invalido`. Assim nenhum texto livre (iniciais, nome abreviado) é gravado.
- **A subida recusa:**
  - `ANTHROPIC_API_KEY` definida, ou `LLM_MODO` diferente de `mock`;
  - token fraco, ou `DATABASE_URL` vazio;
  - banco sem a marca de demo;
  - malha não sintética, anamnese gravada, ou pasta estranha em `DATA_DIR/pacientes`.

## Pré-requisitos (decisões do Gabriel já tomadas)

- Conta Vercel no plano Hobby. Um projeto vazio (ex.: `simulador-mamario-demo`), sem Git e sem deploy, só para ser dono do sandbox.
- Sandbox em **`gru1`**:
  - 4 vCPU / 8 GB (build do Next e scipy);
  - porta **3000** exposta;
  - runtime `node22`. No deploy real a imagem foi **Ubuntu 26.04** (com `apt` e `sudo`), usuário `ubuntu` e `HOME=/vercel`. O estado da demo fica então em `/vercel/simulador-demo`;
  - `persistent: true`, se quiser snapshot (ver "Encerrar" e "Retomar");
  - timeout: o maior valor aceito foi **24 h**. Use o menor que cubra o teste e pare o sandbox ao fim de qualquer jeito.
- Código dentro do sandbox: `git clone` com token do GitHub *fine-grained*, só leitura, só este repositório e com validade curta; ou um tarball enviado.
- Política de rede do sandbox durante o `preparar`: GitHub (clone e as versões do Python baixadas pelo `uv`), registro npm, PyPI (`pypi.org`, `files.pythonhosted.org`; também de onde vem o `uv`) e os espelhos do `apt` do Ubuntu (ou os repositórios do `dnf`, em Amazon Linux).

### O que o `preparar` instala (observado no Ubuntu 26.04)

- **Pacotes do sistema, só se faltarem:** `apt-get install postgresql postgresql-contrib build-essential python3 python3-venv python3-dev openssl curl ca-certificates`. Em Amazon Linux/`dnf`, o caminho antigo (`postgresql16-server`, `gcc-c++`, `python3.13-devel`) continua. Sem `apt-get` nem `dnf`, ou se a instalação falhar, o script para com mensagem clara.
- **Postgres 18**, em `/usr/lib/postgresql/18/bin`. O script procura por versão decrescente (18, 17, 16, 15, depois `/usr/pgsql-16/bin` e `/usr/bin`); `PG_BIN` força outro caminho.
- **Python 3.13 via `uv`.** O Python do sistema é o 3.14, e o `pygeodesic` 0.1.11 não tem wheel `cp314` (a compilação falha). O script prefere `python3.13`/`3.12`/`3.11`, depois o 3.13 já instalado pelo `uv`. Se só houver 3.14+ e o `services/mesh` não importar com ele, instala o `uv` do PyPI num venv próprio em `$DEMO_DIR/.uv` (só se o `uv` faltar), com versão fixa (`uv==0.12.19`) e `--require-hashes` com os sha256 das wheels manylinux x86_64/aarch64. Depois roda `uv python install 3.13` e recria o venv com esse Python. `DEMO_SEM_INSTALAR=1` também impede instalar o `uv`.
- **Licenças.** O `uv` é MIT OR Apache-2.0, permitido pelo ADR 0009. Ele e o Python que baixa (distribuições *python-build-standalone*, PSF-2.0 e bibliotecas permissivas) são ferramentas de preparo do sandbox, como o Postgres e o `gcc`: não entram no repositório nem no app. Por isso não aparecem no `THIRD_PARTY_LICENSES.md`, que o `scripts/licencas.sh` gera das dependências do projeto (pnpm e `services/mesh/.venv`); ficam registrados aqui.

## Passo a passo

```bash
# 1. dentro do sandbox, na raiz do repositório (usuário comum, não root; no Vercel, o usuário ubuntu)
bash scripts/demo_sandbox.sh preparar
#    instala o que faltar (apt: postgresql 18, build-essential, python3-venv; Python 3.13 via uv se o do
#    sistema for 3.14), pnpm install, venv do services/mesh, cluster Postgres próprio (127.0.0.1:5433,
#    banco simulador_demo marcado como demo), torsos t01/t02/t03 + morphs em $HOME/simulador-demo/data e
#    next build com DEMO_SINTETICA=1 (teto de corpo do proxy 2 MB). Idempotente.
#    Recusa DEMO_DIR ou DEMO_PG_DIR que já exista, não esteja vazio e não tenha o marcador
#    .simulador-demo-sintetica (nada é criado, gravado nem apagado nessa pasta).

# 2. (melhoria, ainda não feita no deploy real) política de rede do sandbox → deny-all

# 3. subir com o host público da porta 3000 (só o nome, sem https://)
DEMO_HOST_PUBLICO=<host-da-porta-3000> bash scripts/demo_sandbox.sh subir
#    na primeira vez imprime UMA vez:  https://<host>/?token=<64 hex>
```

Abra essa URL uma vez no computador e outra no iPad, de preferência em **janela privada/anônima**. O token vira cookie e sai da URL (redirecionamento 303), mas essa primeira URL com `?token=` pode ficar no histórico do navegador e nos logs de requisição do proxy do Vercel. Por isso, ao fim de cada sessão de teste, rode `novo-token` (ver "Encerrar"). Para reabrir sem token, use só `https://<host>/`.

### Verificação (1 minuto)

Cabeçalhos do proxy: com `DEMO_SINTETICA=1`, o app usa o **último** valor de `X-Forwarded-Proto` e de `X-Forwarded-Host`, que é o que o proxy de borda acrescenta. Os valores anteriores da lista podem ter vindo do cliente. O host encaminhado precisa estar em `APP_HOSTS_PERMITIDOS`.

**Observado no deploy real (gru1):** o proxy do Vercel **sobrescreve** `X-Forwarded-Host`, `X-Forwarded-Proto` e `X-Forwarded-For`; os valores mandados pelo cliente são descartados. Ele envia `Host` = `X-Forwarded-Host` = host público e `X-Forwarded-Proto: https`. O último `curl` abaixo confirmou isso: o `X-Forwarded-Host` forjado não mudou o `Location`. Repita a checagem a cada preparo novo, porque o comportamento do proxy pode mudar.

```bash
H=<host-da-porta-3000>; T=<token>
curl -sI "https://$H/"                         # 401 (sem token)
curl -sI "https://$H/?token=$T"                # 303, Location: https://$H/ e Set-Cookie ...; Secure; HttpOnly; SameSite=strict
curl -s -H "Authorization: Bearer $T" -H "Origin: https://$H" -F arquivos=@/etc/hostname "https://$H/api/malhas"
                                               # 403 {"erro":{"codigo":"desligado_na_demo",...}}
curl -s -H "Authorization: Bearer $T" "https://$H/api/mesh/saude"    # {"disponivel":true,...}
curl -sI -H "X-Forwarded-Host: evil.example" "https://$H/?token=$T" | grep -i '^location'
                                               # esperado: Location: https://$H/  (ou 403, se o proxy só repassar o do
                                               # cliente; nesse caso NÃO siga com o teste e registre a pendência)
```

Se o `GET` com token der `403 host_nao_permitido`, o host que chega ao Next (`Host` ou `X-Forwarded-Host`) não é o de `DEMO_HOST_PUBLICO`. Use exatamente o nome que aparece na barra do navegador e rode `parar` + `subir`. Se o `Location` sair `http://`, o proxy não mandou `X-Forwarded-Proto: https`. O app continua funcionando pela URL `https://` digitada, mas registre isso como pendência antes de repetir o teste.

### Roteiro de teste (computador e iPad)

1. Novo atendimento → torso `t01_simetrico_300` → **processar** → régua → landmarks (ou "aplicar gabarito") → medidas B contra o gabarito.
2. TEPID.
3. Dois implantes → morphs → slider, plano/IMF, vistas e comparação em 2 painéis.
4. Relatório (mock) → PDF (abrir e baixar).
5. `/validacao/bland-altman`: sessão com 2 repetições → encerrar → planilha CSV.
6. `/benchmark` no iPad → JSON → `python3 scripts/importar_latencia.py <arquivo>.json --rotulo ipad` (fora do sandbox).

### Encerrar (sempre, ao fim de cada sessão de teste)

```bash
bash scripts/demo_sandbox.sh novo-token # ANTES de parar: invalida o token usado (histórico, logs do proxy)
bash scripts/demo_sandbox.sh parar      # para web, mesh e Postgres (estado fica em $HOME/simulador-demo)
```

Depois pare o sandbox no Vercel. Com `persistent: true`, **parar grava um snapshot do disco inteiro, e ele inclui `demo.env` com o `APP_TOKEN_LOCAL`** (e a senha do banco local). Por isso o `novo-token` vem antes do `parar`: o token que fica no snapshot é um que nunca foi usado numa URL. Quem lê snapshots na conta Vercel lê esse token, então a conta continua sendo perímetro (risco 3).

### Retomar

1. Retome o sandbox persistente pelo nome: `get_named_sandbox(name, resume=true)` (SDK/API do Vercel Sandbox). Não crie outro, que viria sem o preparo.
2. Pegue o host público da porta 3000. Ele pode mudar entre sessões.
3. Gere um token novo e suba:

```bash
bash scripts/demo_sandbox.sh novo-token   # imprime o token uma vez (o do snapshot não é mais o que vale)
DEMO_HOST_PUBLICO=<host-da-porta-3000> bash scripts/demo_sandbox.sh subir
```

4. Refaça a verificação de 1 minuto. Não é preciso rodar `preparar` de novo, salvo depois de um `git pull`.

Para descartar tudo, rode `bash scripts/demo_sandbox.sh apagar` e apague sandbox, snapshots e o projeto. Revogue o token do GitHub quando não for mais usar.

### Outros comandos

| Comando | Efeito |
|---|---|
| `status` | processos, Postgres e `GET /api/config` sem token (esperado 401) |
| `novo-token` | gera e imprime uma vez um novo `APP_TOKEN_LOCAL` (depois: `parar` + `subir`) |
| `recriar-banco` | apaga banco e dados de pacientes sintéticos da demo e recria o banco marcado (use se a subida recusar por dado inconsistente) |
| `apagar` | para tudo e apaga `DEMO_DIR` e o cluster; só apaga pastas que tenham o marcador `.simulador-demo-sintetica` gravado pelo próprio script (o `preparar` também recusa `DEMO_DIR` ou `DEMO_PG_DIR` já existente, não vazio e sem esse marcador) |

Variáveis: `DEMO_HOST_PUBLICO`, `DEMO_SO_LOOPBACK=1` (teste local, escuta só em 127.0.0.1), `DEMO_DIR` (padrão `$HOME/simulador-demo`, nunca dentro do repositório), `DEMO_PG_DIR`, `DEMO_PORTA` (3000), `DEMO_PG_PORTA` (5433), `DEMO_MESH_PORTA` (8765), `DEMO_DESENHO` (B; `A` para ver a UI enxuta), `DEMO_SEM_INSTALAR=1`. O script recusa desenho fora de `A`/`B` e portas não numéricas. A senha do role do Postgres vai ao `psql` pela entrada padrão, nunca pelo argv.

## Riscos (aceitos para um teste experimental, com mitigação)

1. **A URL do sandbox fica fora da Deployment Protection** (Vercel Authentication). Quem tiver a URL alcança a instância. **Só o token do app protege.** Mitigações:
   - token de 256 bits aleatório (a subida recusa token fraco);
   - HTTPS terminado pelo Vercel e cookie `Secure`/`HttpOnly`/`SameSite=Strict`;
   - URL imprevisível e sessão curta;
   - nenhum dado real lá dentro.
2. **Nunca dado real.** O upload e a anamnese estão fechados, mas digitar dado de paciente em campos numéricos (TEPID) ou usar a demo como consulta continua proibido. Dado sintético paramétrico não é dado pessoal; é a entrada de dado real que se evita.
3. **O token pode ficar em vários lugares:**
   - no terminal (impresso uma vez) e nos logs de comando do sandbox, guardados na conta Vercel;
   - nos logs de requisição do proxy do Vercel, porque a primeira URL leva `?token=`;
   - no histórico do navegador que abriu essa URL;
   - no snapshot do sandbox persistente, dentro de `demo.env`.

   Trate a conta Vercel como parte do perímetro, use janela privada e rode `novo-token` ao fim de cada sessão de teste (e antes do próximo uso, se o token puder ter sido visto).
4. **Encerrar após o teste.** Instância no ar sem uso é superfície exposta sem motivo. Pare o sandbox (a cota do Hobby também agradece).
5. **Uso pessoal e não comercial** (termos do Hobby). Consultório e terceiros ficam fora.
6. **TLS só até o proxy do Vercel.** Dentro do sandbox, proxy → Next é HTTP. É por isso que `X-Forwarded-Proto` é honrado no modo demo, e só nele.
7. **Ambiente efêmero.** O maior timeout aceito no deploy real foi 24 h. Timeout longo não é motivo para deixar a instância no ar: pare ao fim do teste. Fora do snapshot, o estado se perde.

## Melhorias registradas

- **Rede `deny-all` depois do `preparar`.** Nada precisa sair com a demo no ar (LLM em mock), e isso reforçaria "nenhum dado sai do Brasil". Ainda não foi aplicada no deploy real. Quando for, libere a rede de novo antes de qualquer `preparar` ou `git pull`.

## Observado no deploy real e o que falta conferir

- **Confirmado (gru1):** imagem Ubuntu 26.04 com `apt`, usuário `ubuntu`, `HOME=/vercel`; Postgres 18 em `/usr/lib/postgresql/18/bin`; Python do sistema 3.14 sem wheel do `pygeodesic` (resolvido com o 3.13 do `uv`); timeout de até 24 h; proxy que sobrescreve `X-Forwarded-*` e manda `Host` público; snapshot ao parar que inclui `demo.env`; retomada com `get_named_sandbox(name, resume=true)`.
- **Não verificado:** os nomes dos pacotes `dnf` do Amazon Linux 2023 (`postgresql16-server`, `python3.13-devel`), caso a imagem volte a ser essa. O script tenta, segue se já houver os binários e falha com mensagem clara se `pygeodesic` não importar.
- **A conferir no painel:** que a Deployment Protection não cobre a URL do sandbox, e a cota do Hobby (plano de deploy, §10).
