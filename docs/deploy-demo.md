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
  - runtime `node22` (imagem Amazon Linux 2023, com `dnf`, `sudo` e `python3.13`);
  - `persistent: true`, se quiser snapshot.
- Código dentro do sandbox: `git clone` com token do GitHub *fine-grained*, só leitura, só este repositório e com validade curta; ou um tarball enviado.
- Política de rede do sandbox:
  - durante o `preparar`: GitHub, registro npm, PyPI e repositórios do `dnf`;
  - depois: `deny-all`. Nada precisa sair (LLM em mock), o que reforça "nenhum dado sai do Brasil".

## Passo a passo

```bash
# 1. dentro do sandbox, na raiz do repositório (usuário comum, não root)
bash scripts/demo_sandbox.sh preparar
#    instala o que faltar (dnf: postgresql16-server, gcc/g++, python3.13-devel), pnpm install, venv do
#    services/mesh, cluster Postgres próprio (127.0.0.1:5433, banco simulador_demo marcado como demo),
#    torsos t01/t02/t03 + morphs em $HOME/simulador-demo/data e next build com DEMO_SINTETICA=1
#    (teto de corpo do proxy 2 MB). Idempotente.

# 2. (opcional) política de rede do sandbox → deny-all

# 3. subir com o host público da porta 3000 (só o nome, sem https://)
DEMO_HOST_PUBLICO=<host-da-porta-3000> bash scripts/demo_sandbox.sh subir
#    na primeira vez imprime UMA vez:  https://<host>/?token=<64 hex>
```

Abra essa URL uma vez no computador e outra no iPad, de preferência em **janela privada/anônima**. O token vira cookie e sai da URL (redirecionamento 303), mas essa primeira URL com `?token=` pode ficar no histórico do navegador e nos logs de requisição do proxy do Vercel. Por isso, ao fim de cada sessão de teste, rode `novo-token` (ver "Encerrar"). Para reabrir sem token, use só `https://<host>/`.

### Verificação (1 minuto)

Cabeçalhos do proxy: com `DEMO_SINTETICA=1`, o app usa o **último** valor de `X-Forwarded-Proto` e de `X-Forwarded-Host`, que é o que o proxy de borda acrescenta. Os valores anteriores da lista podem ter vindo do cliente. O host encaminhado precisa estar em `APP_HOSTS_PERMITIDOS`. Para conferir que o proxy do sandbox **acrescenta ou sobrescreve** o cabeçalho, sem apenas repassar o do cliente, rode o último `curl` abaixo: um `X-Forwarded-Host` forjado pelo cliente não pode mudar o `Location`.

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
bash scripts/demo_sandbox.sh novo-token # invalida o token usado (que pode estar no histórico e nos logs do proxy)
bash scripts/demo_sandbox.sh parar      # para web, mesh e Postgres (estado fica em $HOME/simulador-demo)
```

Depois pare o sandbox no Vercel. O snapshot guarda o ambiente pronto para a próxima vez. Na volta, rode `subir` de novo com o host novo, porque a URL muda a cada sessão. O token novo, gerado por `novo-token`, aparece uma vez. Para descartar tudo, rode `bash scripts/demo_sandbox.sh apagar` e apague sandbox, snapshots e o projeto. Revogue o token do GitHub quando não for mais usar.

### Outros comandos

| Comando | Efeito |
|---|---|
| `status` | processos, Postgres e `GET /api/config` sem token (esperado 401) |
| `novo-token` | gera e imprime uma vez um novo `APP_TOKEN_LOCAL` (depois: `parar` + `subir`) |
| `recriar-banco` | apaga banco e dados de pacientes sintéticos da demo e recria o banco marcado (use se a subida recusar por dado inconsistente) |
| `apagar` | para tudo e apaga `DEMO_DIR` e o cluster; só apaga pastas que tenham o marcador `.simulador-demo-sintetica` gravado pelo próprio script |

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
   - no histórico do navegador que abriu essa URL.

   Trate a conta Vercel como parte do perímetro, use janela privada e rode `novo-token` ao fim de cada sessão de teste (e antes do próximo uso, se o token puder ter sido visto).
4. **Encerrar após o teste.** Instância no ar sem uso é superfície exposta sem motivo. Pare o sandbox (a cota do Hobby também agradece).
5. **Uso pessoal e não comercial** (termos do Hobby). Consultório e terceiros ficam fora.
6. **TLS só até o proxy do Vercel.** Dentro do sandbox, proxy → Next é HTTP. É por isso que `X-Forwarded-Proto` é honrado no modo demo, e só nele.
7. **Ambiente efêmero.** Sessão com tempo máximo por plano (historicamente cerca de 45 min no Hobby; confirmar no painel). Fora do snapshot, o estado se perde.

## Suposições não verificadas (conferir no primeiro uso)

- Os cabeçalhos exatos que o proxy do sandbox envia: `Host` público ou interno, `X-Forwarded-Proto` e `X-Forwarded-Host`. O código aceita os dois arranjos; a verificação de 1 minuto acima confirma.
- Os nomes dos pacotes `dnf` do Amazon Linux 2023 (`postgresql16-server`, `python3.13-devel`). O script tenta, segue se já houver os binários e falha com mensagem clara se `pygeodesic` não importar. Neste ambiente de desenvolvimento (Debian, Python 3.13), o `pip install` do `services/mesh` funcionou sem compilar nada à mão.
- Que a Deployment Protection não cobre a URL do sandbox, o tempo máximo de sessão e a cota do Hobby (plano de deploy, §10).
