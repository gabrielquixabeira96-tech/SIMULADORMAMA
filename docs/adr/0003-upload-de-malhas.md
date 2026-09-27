# ADR 0003 — Upload, processamento e armazenamento de malhas

Status: aceito · Data: 2026-09-26

## Contexto

Marco 1: upload de OBJ/PLY com textura, recorte abaixo do pescoço, decimação para 30–50 mil vértices, calibração de escala por dois pontos de uma régua. Fonte real futura: 3D Scanner App (iPhone/iPad Pro com LiDAR), que exporta OBJ + MTL + JPG em **metros**. Imagens de tórax são dado sensível (LGPD art. 11).

## Decisão

1. **Formatos aceitos**: `.obj` (+ `.mtl` + textura PNG/JPG), `.ply` (ASCII/binário), ou `.zip` contendo um deles. Limite 500 MB por upload (local). Qualquer outro formato → 415.
2. **Fluxo**: `POST /api/malhas` (multipart, Next.js route handler) grava o upload intacto em `$DATA_DIR/pacientes/<pseudonimo>/malhas/<malha_id>/original/`, registra em `malhas` e chama `POST /processar` do `services/mesh`. O Python produz `processada.obj/.mtl`, `textura.png`, `processada.glb` (mm, Y-up) e `meta.json` (`malha_meta/1.0`).
3. **Unidade de origem** é declarada no upload (`m`, `cm`, `mm`, `desconhecida`); com `desconhecida`, o Python infere pela caixa envolvente e registra `unidade_inferida`. Isso só aproxima a escala; **a escala válida vem da régua**.
4. **Calibração por régua**: o médico clica os dois extremos de uma régua física escaneada junto com o torso e digita o comprimento (padrão 100 mm). O web calcula `fator = regua_mm / |p2 − p1|` e chama `POST /reescalar`; o Python reescreve `processada.*` e acumula o fator em `meta.json`. **Ordem obrigatória**: processar → calibrar → landmarks. Landmarks anteriores a um reescalonamento são invalidados. Critério da fase 0: régua ±2 mm.
5. **Recorte**: modo `abaixo_do_pescoco` (plano horizontal 3 cm abaixo do ponto mais estreito do pescoço) como padrão; `caixa` com limites manuais como fallback. O rosto nunca chega ao viewer.
6. **Decimação**: quádricas (Open3D ou `fast-simplification`, MIT); alvo 40 000 vértices, faixa 30–50 mil. `pymeshlab` (GPL) proibido.
7. **Servir arquivos**: nunca de `public/`. Rota `GET /api/malhas/<id>/arquivo?nome=…` autenticada (token local `APP_TOKEN_LOCAL` + proxy de borda; ver "Revisão v0.1.1" abaixo), com `Content-Disposition: inline`, que registra `auditoria(acao='visualizou')` e valida `nome` contra lista fixa (`processada.glb`, `morphs/manifest.json`, `morphs/<plano>__<imf>.glb`). Sem cache público (`Cache-Control: private, no-store`).
8. **Segurança de caminho**: web e Python só aceitam caminhos relativos a `DATA_DIR`, sem `..`, e o Python resolve e confere que o caminho real está dentro de `DATA_DIR`.
9. **Sintéticos**: os torsos do gerador vão para `$DATA_DIR/sinteticos/<nome>/` e entram pelo mesmo caminho de registro do upload (`POST /api/sinteticos/<nome>/importar`; o flag NÃO vem do cliente — ver "Revisão v0.1.1"), sob um paciente sintético cujo pseudônimo segue o formato normal (`P-XXXXXX`) e cuja malha é marcada `malhas.sintetica = true`. Isso garante que o viewer, os landmarks e os morphs percorrem exatamente o mesmo caminho que uma paciente real.

## Alternativas

- Processar no navegador (three.js `SimplifyModifier`, WASM): evita ida ao Python, mas a qualidade da decimação e o recorte são piores e o mesmo código precisaria existir no Python para o gabarito. Rejeitada.
- Upload direto para bucket (Supabase Storage) com URL assinada: é o alvo da fase 3+; local não há bucket. O contrato só troca o transporte.
- Escala inferida automaticamente pela altura do torso: imprecisa (±10 %); régua é obrigatória.

## Consequências

- Existe uma única malha "verdadeira" por `malha_id` (`processada.*`), sempre em mm; tudo o mais (landmarks, morphs) referencia seus índices de vértice.
- Reescalonar depois de marcar landmarks obriga remarcar; a UI bloqueia essa ordem.
- Sem CDN/cache para malhas: aceitável para consultório; revisar no SaaS.

## Revisão v0.1.1 (2026-09-26) — autenticação local e proteção de borda

A revisão de código da v0.1.0 mostrou que o item 7 ("rota autenticada") não estava implementado: o Next escutava em `0.0.0.0`, nenhuma rota exigia credencial e um `POST` cross-origin `text/plain` para `/api/pacientes` (CSRF simples, sem preflight) criava paciente. Decisão para o MVP local (um médico, uma máquina):

1. **Só loopback**: `next dev` e `next start` sobem com `-H 127.0.0.1` (`apps/web/package.json`, `playwright.config.ts`). O proxy recusa (`403 host_nao_permitido`) qualquer `Host` fora de `127.0.0.1`/`localhost`/`::1`, o que também barra DNS rebinding; nomes extras só por `APP_HOSTS_PERMITIDOS`.
2. **Token local** `APP_TOKEN_LOCAL` (segredo aleatório no `.env`, nunca commitado). O proxy exige o token em **toda** rota (páginas e API), por `Authorization: Bearer <token>` (clientes não-navegador, e2e) ou pelo cookie `simulador_token` (`HttpOnly`, `SameSite=Strict`), que é gravado quando o médico abre uma vez `http://127.0.0.1:3000/?token=<token>`; o proxy responde `303` para a mesma URL sem o parâmetro (o token não fica no histórico nem em `Referer`). Comparação em tempo constante. Em `next start` (`NODE_ENV=production`) o token é **obrigatório**: sem ele o servidor recusa subir (`instrumentation.ts`) e o proxy responde `503` (falha fechada). Em `next dev` pode ficar vazio (aviso no log), mas os itens 3 e 4 continuam valendo.
3. **Content-Type**: rotas `/api/*` mutantes (POST/PUT/PATCH/DELETE) exigem `application/json`; `multipart/form-data` só em `POST /api/malhas` (upload). Um formulário HTML ou `fetch` `no-cors` de outro site não consegue mandar JSON sem preflight CORS, que o app não habilita → `415`.
4. **Origin**: nas mesmas rotas, `Origin` tem de ser igual ao `Host` do próprio app (`403 origem_nao_permitida`); `Sec-Fetch-Site: cross-site` também é recusado. Sem `Origin` (cliente não-navegador), só passa quem se autenticou pelo cabeçalho `Authorization`.
5. **Onde**: `apps/web/src/proxy.ts` (no Next 16 o antigo `middleware.ts` foi renomeado para `proxy.ts` e roda no runtime Node) + regras puras em `apps/web/src/seguranca/requisicao.ts`. Como o proxy bufferiza o corpo e o Next **trunca em silêncio** acima de `proxyClientMaxBodySize` (padrão 10 MB), o `next.config.ts` fixa `520mb` (upload de 500 MB + margem); o limite efetivo é o da rota (item 6).
6. **Limite de corpo por stream**: o upload conta os bytes recebidos (vale para `Transfer-Encoding: chunked`, que antes contornava a checagem do `Content-Length`) e responde `413`; as rotas JSON leem o corpo com teto de 1 MB (`413 corpo_grande_demais`).
7. **`sintetica` decidido no servidor**: `POST /api/malhas` grava sempre `sintetica=false`, ignorando o campo do cliente; só `POST /api/sinteticos/<nome>/importar` grava `true`. Assim um scan real nunca é tratado como sintético e nunca pula a régua.
8. **Cabeçalhos**: CSP (`default-src 'self'`; `'unsafe-inline'` em script/style por causa dos scripts de hidratação do App Router sem nonce; `blob:`/`data:` para texturas do glTF; `'unsafe-eval'` e `ws:` só em `next dev`; `frame-ancestors 'none'`), CSP `default-src 'none'; sandbox` nas respostas da API (exceto o PDF, para o visualizador do navegador), HSTS (efetivo quando houver TLS), `Permissions-Policy` desligando câmera, microfone, geolocalização etc., `COOP`/`CORP same-origin`. O e2e `seguranca.spec.ts` confirma que o viewer (R3F/three.js) e o Next funcionam sem nenhuma violação de CSP.

**Alternativas**: login com usuário e senha (NextAuth/Auth.js) — maior superfície e sem ganho real para um único usuário local; adiado para o SaaS (fase 3+, com Supabase Auth). mTLS local — atrito desnecessário no consultório. Só checar `Origin` sem token — não protege contra outros usuários/processos da mesma máquina nem contra extensão/cliente que forje `Origin`.

**Consequências**: o médico abre o app uma vez com `?token=` (o README mostra como); qualquer cliente de script precisa do cabeçalho `Authorization`. A troca do token invalida o cookie. Testes: `tests/unit/proxy.test.ts` (reproduz o achado: `POST` cross-origin `text/plain` → 401/415/403, nunca 201) e `e2e/seguranca.spec.ts` (contra o `next start` real).

## Revisão v0.1.2 (2026-09-27) — exceção controlada: benchmark no iPad pela rede local

A medição de latência no hardware-alvo (página `/benchmark`, plano A14) exige que o iPad alcance a app pela rede local, o que contraria o item 1 da revisão v0.1.1 ("só loopback") e trafega em HTTP sem TLS. A orientação anterior do `.env.example` mandava apenas "escutar fora do loopback durante a medição", sem separar a instância: na instância do consultório isso exporia as rotas de paciente na LAN (protegidas só pelo token, em texto claro). Decisão:

1. **Só numa instância separada, dedicada ao benchmark**: `DATA_DIR` próprio sem `pacientes/` (vazio ou só `sinteticos/` e `benchmark/`), `BENCHMARK_HABILITADO=1`, `APP_HOSTS_PERMITIDOS=<ip-da-máquina>`, `next start -H <ip-da-máquina>`, `APP_TOKEN_LOCAL` forte e exclusivo dessa instância, rede confiável (nunca Wi-Fi público/de convidados), e a instância é desligada (e o `DATA_DIR` temporário apagado) logo após baixar o JSON. **Nunca** na instância com dados de pacientes, que continua só em loopback.
2. **Imposto pelo servidor, não só documentado**:
   - a subida (`config/subida.ts`, `verificarBenchmarkNaRede`) recusa `BENCHMARK_HABILITADO=1` com algum host fora do loopback em `APP_HOSTS_PERMITIDOS` se `DATA_DIR/pacientes` existir;
   - o proxy (`seguranca/requisicao.ts`), com `BENCHMARK_HABILITADO=1`, só atende `/benchmark`, `/api/benchmark*` e `/_next/*` a requisições cujo `Host` não é loopback; qualquer outra rota (pacientes, malhas, PDF, página inicial…) → `403 rota_restrita_benchmark`, mesmo com token válido. Isso cobre também um `pacientes/` criado depois da subida.
3. Continua valendo todo o resto da revisão v0.1.1 (token obrigatório em `next start`, Origin/Content-Type nas rotas mutantes, cabeçalhos). O benchmark usa só o torso sintético e não toca banco.

**Consequências**: a exceção não altera a instância clínica; o risco residual (token e JSON sintético em HTTP na LAN confiável, por minutos) não envolve dado de paciente. Testes: `tests/unit/proxy.test.ts` (rotas restritas fora do loopback com o benchmark ligado; recusa de subida com `pacientes/`). Quando houver TLS local (ou o SaaS), revisar.
