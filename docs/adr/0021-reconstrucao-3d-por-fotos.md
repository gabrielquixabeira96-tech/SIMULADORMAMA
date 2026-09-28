# ADR 0021 — Reconstrução 3D do torso a partir de fotos (template ajustado) e a própria foto editada

Status: aceito para o MVP "foto → 3D → mesma foto editada" (v0.1.3 em desenvolvimento; demo só com fotos sintéticas) · Data: 2026-09-28 · Altera: `contratos.md` §2 (`origem: "foto"`), §4.1 (`torso_parametros/1.1`), §5.4, §5.5 (`textura_reconstruida/1.0`), §19 (`reconstrucao/1.0`, `avaliacao_reconstrucao/1.0`) · Mantém: ADR 0005 (A/B), ADR 0009 (licenças; nenhuma rede de profundidade), ADR 0019 (modo foto), ADR 0020 (textura procedural e SH9) · Relaciona: ADR 0003 (upload), ADR 0018 (demo sintética)

## Contexto

O cirurgião pediu duas coisas numa frase: "editar a foto da paciente como um editor de fotos" e "um modelo 3D fiel extraído da foto". A primeira dá para fazer exatamente: o "antes" é a própria foto; o "depois" são os mesmos pixels deslocados pela geometria simulada, só na região da mama (mecanismo do ADR 0019). A segunda não existe com 1–3 fotos: nem os produtos comerciais que usam fotos fazem mais que ajustar um modelo, e mesmo uma câmera 3D dedicada fica em 4–4,5 mm RMS (8,8 mm em projeção AP). Com fotos, o que se obtém é um **template paramétrico ajustado**: preciso no plano da foto, impreciso em profundidade quando só há a frontal.

## Decisão

1. **Reconstrução por ajuste de template** (analysis-by-synthesis, determinística, CPU, no `services/mesh/mesh/foto/`): o torso paramétrico do gerador (`torso_parametros/1.1` = 1.0 + fatores opcionais `forma`/`parede`; ausentes = os presets de hoje, byte a byte) e uma câmera por foto são ajustados por mínimos quadrados robustos à reprojeção dos 10 landmarks 2D, à silhueta (máscara do torso), à escala e a um prior fraco. A malha sai pelo mesmo caminho do gerador (30–50 mil vértices, UV cilíndrica), no quadro anatômico, e entra no fluxo de hoje (`/medir`, `/morphs`). Rota `POST /reconstruir-foto` (contratos §19). **Profundidade monocular (redes tipo Depth Anything) fica fora** — decisão 3 do Gabriel: adiada; só voltaria com ganho medido, ADR 0009 revisado por variante e pesos hospedados com sha256.
2. **A foto vira a textura**: as fotos são projetadas no atlas UV do template (`projetar.py`: z-buffer, peso `cos³θ × feather × visível`, ganhos RGB entre fotos) e o que nenhuma foto viu é preenchido com a textura procedural do ADR 0020 com a cor casada (`preencher.py`), marcado em `observado.png` (0 = não observado; o web hachura). Nada generativo: só re-amostragem e filtros lineares. A reconstrução grava `meta.json.textura` (`textura_reconstruida/1.0`) e `reconstrucao.cobertura_observada_pct` (% do atlas com `observado ≥ 0,15`).
3. **No web**, a vista "Foto real" do comparador desenha a malha pela câmera da foto (K, R, t → `PerspectiveCamera` exata), com a foto de fundo e a textura projetiva da própria foto; a malha só pinta onde o deslocamento simulado é > 0 (alfa por |Δ|), então fora da mama nenhum pixel muda (testado, também com a pose perturbada 5 px). Selo "modelo 3D estimado de N foto(s)"; cartão de incerteza por eixo (em A qualitativo, sem números); halo = max(envelope 4,5 mm; incerteza em z).
4. **Convenções congeladas (C1)**. Câmera OpenCV: `x_cam = R·X + t`, +z para a frente, v para baixo; **(u, v) contínuos com origem no canto superior esquerdo** (centro do pixel i em i + 0,5; ponto principal em W/2, H/2); K e R em 9 números coluna-major; `f_px = max(W, H)·focal_35mm/36`. O web usa exatamente a mesma coordenada (a integração corrigiu um meio pixel que o P3 somava por supor "(0, 0) = centro do pixel"); a paridade Python (P1 × P2) × web (P3) é testada na mesma fixture com tolerância 0,5 px e dá ~5·10⁻⁷ px. Mundo = quadro anatômico em mm (origem na fúrcula).
5. **Escala**: métodos `ssn_n_fita` (fúrcula–mamilo com fita), `regua_foto` (2 cliques numa régua fotografada) e `base_digitada`. **A fita SSN–N entra no ajuste como distância euclidiana (reta)**, não geodésica: a UI diz "medida com a fita esticada em linha reta — não acompanhando a curva da pele" (`textoEscala`, cartão do passo 1). Seguir a pele alongaria a medida alguns % e o modelo sairia maior na mesma proporção.
6. **Fidelidade esperada e como aparece** (plano §2; números medidos abaixo): no plano da foto (x, y) ≤ 2 mm em sintético, 3–5 mm estimado em paciente real; **profundidade só confiável com foto de perfil** (≤ 3 mm sintético, 4–7 mm real estimado); **sem perfil, a profundidade é o prior do template: só ilustração** — `profundidade_confiavel: false`, piso de 12 mm em `incerteza_por_eixo_mm.z` (8 mm com oblíqua), cartão "só ilustração", nenhum número de projeção nem em B (decisão 2 do Gabriel: permitir sem perfil, com aviso). `forma_fora_do_modelo` quando a silhueta não cabe na família (tuberosa, pectus, ptose grave).
7. **LGPD**: a foto **recortada** (sem rosto, sem EXIF) é a captura desta modalidade e fica em `original/foto_<vista>.jpg` da malha, com as regras da textura do scan (pseudonimizada, em `DATA_DIR`, apagável com a paciente, nunca versionada) — decisão 1 do Gabriel (o re-ajuste precisa dela). O serviço recusa e **apaga** as fotos quando a fúrcula está a mais de 12 % da altura a partir do topo (`rosto_possivelmente_visivel`). O único leitor de imagem da projeção é `ler_foto(malha_dir, "original/foto_<vista>.jpg")`. O LLM não vê imagem. Nenhum download/compartilhar; selo nos pixels.
8. **Demo e prova**: `mesh.cli fotos-exemplo` (`scripts/mesh.sh fotos`, rodado pela CI e pelo `demo_sandbox.sh preparar`) gera, pelo pipeline real, `sinteticos/<t>/foto/` (frente + oblíqua D + perfil D) e `sinteticos/t01_simetrico_300/foto_frente/` (só a frontal), com `avaliacao.json` contra o gabarito (`avaliacao_reconstrucao/1.0`). Na demo, o card "Fotos de exemplo" importa a reconstrução pelo caminho de um upload e o passo 1 mostra o "Erro contra o gabarito" (só B). O e2e `fotoReal.spec` e o `demo.spec` usam essas pastas (a fixture escrita à mão do P3 saiu).

## Números medidos (fotos sintéticas, landmarks 2D exatos, máscara exata; `avaliacao.json`)

Região: pegadas das mamas do gabarito dilatadas 20 mm; RMS da superfície verdadeira para a malha reconstruída.

| Torso | Fotos | RMS x / y / z (mm) | Volume D / E | Landmarks máx. | Reprojeção | Cobertura do atlas |
|---|---|---|---|---|---|---|
| t01_simetrico_300 | frente + oblíqua D + perfil D | 0,27 / 0,23 / 0,31 | −1,5 % / −0,0 % | 0,74 mm | 0,64 px | 49,9 % |
| t01_simetrico_300 | só frente | 0,57 / 0,45 / 0,99 | −3,8 % / −2,2 % | 4,71 mm | 0,34 px | 35,1 % |
| t02_assimetrico | frente + oblíqua D + perfil D | 0,40 / 0,34 / 0,49 | −7,0 % / −1,6 % | 1,48 mm | 0,77 px | 52,4 % |
| t03_pequeno_ptose | frente + oblíqua D + perfil D | 0,14 / 0,10 / 0,18 | +0,6 % / +0,3 % | 0,45 mm | 0,36 px | 58,7 % |

Estes números são o **caso fácil**: a verdade é da mesma família do template, os pontos são exatos e a postura é idêntica entre as fotos. Não valem como estimativa para paciente real (restrição 2: nenhuma foto real nos testes); a incerteza mostrada na tela usa pisos (4,5 mm; z 12 mm sem perfil) justamente por isso.

## Alternativas

- **Profundidade monocular → malha**: métrica só afim (escala e offset por foto), pesos só no HuggingFace (bloqueado no sandbox), `checar_proibidos.py` proíbe hoje os nomes; não integra com landmarks/volume analíticos. Adiada (item 1).
- **Exigir foto de perfil**: mais honesto em números, pior na consulta. Rejeitada: sem perfil a simulação sai, com "só ilustração" e sem números de projeção (item 6).
- **Processar e apagar a foto**: perde o re-ajuste e a auditoria da origem da malha. Rejeitada (item 7).
- **Web calcula a câmera por PnP**: duplicaria a álgebra do Python e divergiria. Rejeitada: o web só lê K, R, t do C1.

## Limites e pendências

- Upload real de fotos, recorte do rosto no navegador, marcação dos landmarks 2D e segmentação ONNX (ISNet/U²-Net, `scripts/pesos.sh`) ficam para a sessão 2 (P3/P1 completos). Hoje a segmentação sem pesos é o modo `template` (fundo neutro) e as fotos de exemplo usam a máscara exata.
- Matriz fora da família (campo suave ±8 mm), ruído de clique e latência da vista "Foto real" ainda não medidos em `docs/validacao/`.
- Os landmarks do passo 2 da foto de exemplo continuam os do gabarito (âncora); usar os de `origem: "foto"` (com confirmação em A) é do P3 completo.
- `processada.glb` embute a textura do atlas (≈ 4–5 MB) como os morphs (pendência do ADR 0020).
