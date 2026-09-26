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
7. **Servir arquivos**: nunca de `public/`. Rota `GET /api/malhas/<id>/arquivo?nome=…` autenticada (usuário local nesta fase), com `Content-Disposition: inline`, que registra `auditoria(acao='visualizou')` e valida `nome` contra lista fixa (`processada.glb`, `morphs/manifest.json`, `morphs/<plano>__<imf>.glb`). Sem cache público (`Cache-Control: private, no-store`).
8. **Segurança de caminho**: web e Python só aceitam caminhos relativos a `DATA_DIR`, sem `..`, e o Python resolve e confere que o caminho real está dentro de `DATA_DIR`.
9. **Sintéticos**: os torsos do gerador vão para `$DATA_DIR/sinteticos/<nome>/` e entram pelo mesmo `POST /api/malhas` (campo `sintetica=true`), sob um paciente sintético cujo pseudônimo segue o formato normal (`P-XXXXXX`) e cuja malha é marcada `malhas.sintetica = true`. Isso garante que o viewer, os landmarks e os morphs percorrem exatamente o mesmo caminho que uma paciente real.

## Alternativas

- Processar no navegador (three.js `SimplifyModifier`, WASM): evita ida ao Python, mas a qualidade da decimação e o recorte são piores e o mesmo código precisaria existir no Python para o gabarito. Rejeitada.
- Upload direto para bucket (Supabase Storage) com URL assinada: é o alvo da fase 3+; local não há bucket. O contrato só troca o transporte.
- Escala inferida automaticamente pela altura do torso: imprecisa (±10 %); régua é obrigatória.

## Consequências

- Existe uma única malha "verdadeira" por `malha_id` (`processada.*`), sempre em mm; tudo o mais (landmarks, morphs) referencia seus índices de vértice.
- Reescalonar depois de marcar landmarks obriga remarcar; a UI bloqueia essa ordem.
- Sem CDN/cache para malhas: aceitável para consultório; revisar no SaaS.
