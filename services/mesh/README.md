# services/mesh — torso sintético, pré-processamento e antropometria (Marcos 0 e 1)

Serviço Python 3.11 (FastAPI) que implementa o lado Python de `docs/contratos.md` (contrato 1.0):
torso sintético paramétrico com gabarito, `/processar`, `/reescalar`, `/medir` (geodésica MMP exata,
volume `plano_base_elipse` v2 com parede reconstruída, quadro anatômico), `/validar-bland-altman` e
`/morphs` (modelo geométrico-paramétrico + morph targets glTF, Marco 2). Unidades: **mm** e **mL**;
+Y cranial, +Z anterior, +X esquerda da paciente (ADR 0010).

## Comandos

```bash
bash scripts/mesh.sh venv                   # cria services/mesh/.venv e instala -e .[dev]
bash scripts/mesh.sh torsos                 # gera os 3 presets em $DATA_DIR/sinteticos (padrão data/), só os desatualizados
MESH_TORSOS_FORCAR=1 bash scripts/mesh.sh torsos   # regera todos
bash scripts/mesh.sh dev                    # API em http://127.0.0.1:8765 (só loopback)
bash scripts/mesh.sh test                   # ruff + pytest (~10 min: gera os 3 torsos e os morphs em tmp)

cd services/mesh
.venv/bin/python -m mesh.cli torso --preset t01_simetrico_300 --saida ../../data/sinteticos
.venv/bin/python -m mesh.cli torso --parametros meu_torso.json --saida ../../data/sinteticos
.venv/bin/python -m mesh.cli torso --todos --saida ../../data/sinteticos --se-desatualizado
.venv/bin/python -m mesh.cli morphs --todos --sinteticos ../../data/sinteticos   # 4 .glb + manifest por torso
.venv/bin/python -m mesh.cli morphs --sintetico ../../data/sinteticos/t01_simetrico_300 \
    --catalogo tests/fixtures/catalogo_teste.json --implantes teste-redondo-moderado-300
.venv/bin/python -m mesh.cli validar --sinteticos ../../data/sinteticos \
    --relatorio ../../docs/validacao/v0.0.1-services-mesh.md   # erros vs gabarito + Bland-Altman
```

Variáveis: `DATA_DIR` (raiz dos dados; padrão `<repo>/data`), `CONFIG_DIR` (padrão `<repo>/config`).

## Estrutura

```
mesh/
  servidor.py        FastAPI (contratos §7), X-Desenho, erros {"erro":{codigo,mensagem,detalhes}}
  servico.py         operações sem HTTP (usadas pela API, CLI e validação)
  cli.py             `torso` e `validar`
  caminhos.py        caminhos relativos a DATA_DIR (recusa absolutos, `..` e links que escapam)
  esquemas.py        validação com config/schemas/*.schema.json (jsonschema) e leitura de config
  log.py             log JSON por linha, só campos permitidos (sem dado pessoal)
  malha/             MalhaRender, leitura OBJ/PLY (trimesh), escrita OBJ+MTL, GLB escrito à mão, geometria
  processar/         unidade, recorte abaixo do pescoço, limpeza, decimação (fast-simplification), UV
  medir/             geodésica MMP (pygeodesic), antropometria (distâncias, volume, quadro), Bland-Altman
  sintetico/         superfície analítica do torso, gerador + gabarito, texturas procedurais (neutra e
                     "fotográfica": textura_pele.py)
  simulacao/         interfaces (§12.1, stubs FEBio/surrogate), catálogo, modelo geométrico, morphs glTF,
                     iluminação SH9 (iluminacao.py: base, luz padrão, ajuste robusto da luz da textura)
  validacao.py       cenários do Marco 0 e relatório para docs/validacao/
```

## Torso sintético (contratos §4)

Superfície fechada `S(s, y)` (detalhes em `mesh/sintetico/superficie.py`): parede torácica = tubo com
secção superelipse (|x/a|³ + |z/b|³ = 1), parametrizada pelo comprimento de arco `s`; incisura jugular
gaussiana (a furcula é o fundo dela e a origem exata); cada mama é um deslocamento ao longo da normal
da parede, `h = H·(1−ρ²)^p(φ)` numa pegada com semieixos por quadrante (p = 1 no polo inferior → prega
inframamária nítida; 2,2 no polo superior), mais um relevo de mamilo de 2,5 mm. `H` é resolvido
(Brent) para que o volume adicionado seja exatamente o pedido.

Interpretação dos parâmetros (o contrato só fixa os nomes):

| parâmetro | efeito |
|---|---|
| `largura_toracica_mm` | largura da parede (caixa em X exatamente igual) |
| `profundidade_toracica_mm`, `altura_torso_mm` | profundidade da secção; da furcula até a base (o topo fica 25 mm acima da furcula) |
| `volume_ml` | volume adicionado por lado (verdade do gabarito) |
| base da mama | 17,5·V^(1/3) mm de arco (300 mL → 117 mm), 45 % medial / 55 % lateral do mamilo; borda medial a 10 % da largura |
| `ptose` | mamilo em y = −(165 + 60·ptose) mm e ápice deslocado 0,3·ptose·n_imf acima do mamilo (mamilo aponta para baixo). Campo de altura sobre a parede: não há "mamilo abaixo do sulco" literal |
| `n_imf_mm` | ΔY exato entre mamilo e sulco |
| `assimetria` | Δaltura do mamilo esquerdo; deslocamento lateral (em arco) da mama esquerda inteira |

Como o gabarito é calculado (ver docstring de `mesh/sintetico/gerador.py`): `posicao` = avaliação exata
de `S` nos parâmetros do landmark; euclidiana entre posições exatas; **geodésica MMP na malha densa
(~300 mil faces)** partindo das posições exatas; volume adicionado = diferença de volume
(teorema da divergência) entre a superfície com e sem a mama, na malha densa; `vertice` = vértice
mais próximo em `torso.obj`. A malha decimada sai do mesmo pipeline do `/processar`.

### Textura (contratos §4.5; ADR 0020)

`parametros.textura.realismo`: `"esquematico"` (padrão sem o campo) = a neutra do Marco 0, 1024×1024;
`"fotografico"` (os 3 presets) = `sintetico/textura_pele.py`, 4 px/mm (t01: 3392×1900, ~4,9 MB),
periódica em u: pele por fototipo (I–VI), mosqueado, poros, aréola Ø 40 mm e mamilo Ø 10 mm pela
distância 3D na superfície (`(s, y) → torso.avaliar`), tubérculos de Montgomery, luz de estúdio SH9
assada (duas fontes frontais simétricas) e sombra do sulco. Tudo por código, nenhuma imagem lida;
mesma semente → mesmo PNG. O gabarito ganha o bloco `textura` (com os `sh9` assados e o `sha256` do
PNG). Regerar um torso apaga `morphs/` da pasta.

## Decisões técnicas

- **Geodésica exata a partir do ponto clicado.** Os extremos (`posicao`) são inseridos como vértices
  (divisão 1→3 do triângulo) antes do MMP; o MMP roda num recorte elipsoidal exato
  (|x−s|+|x−t| ≤ Dijkstra + 2·aresta), 10–50× mais rápido que na malha inteira sem mudar o resultado.
- **Decimação**: `fast-simplification` (MIT, quádricas). Open3D não foi instalado (≈1 GB de
  dependências para 2 CPUs/7 GB; só seria usado para decimação). Nada GPL.
- **UV após decimação**: UV do ponto mais próximo na malha original; faces que cruzam costura de UV são
  detectadas e recebem UV extrapolada da face de origem, duplicando só os vértices da costura. OBJ e
  GLB têm a mesma lista/ordem de vértices; geometria (geodésica, volume) usa a malha soldada.
- **GLB** escrito à mão (glTF 2.0, `asset.extras.unidade = "mm"`, textura embutida, índices uint32,
  V invertido), validado nos testes relendo com trimesh.
- **DESENHO**: `X-Desenho` obrigatório (exceto `/saude`); com `A`, `/medir` responde 403
  `desligado_no_desenho_a` e registra no log (inclusive `incluir_volume`). Upload, calibração, torso
  sintético e Bland-Altman continuam disponíveis.

## Marco 2 — simulação e morph targets (ADR 0014)

`mesh/simulacao/geometrico.py` (docstring com o algoritmo): forma do implante `P·(1−ρ^k)^γ` com `k`
resolvido para o volume do catálogo (redondo; anatômico com ápice a 62 % da altura), pegada centrada
na base com a borda inferior no sulco, transmissão pelo tecido mole por plano, polo superior
atenuado, suavização, ajuste do mamilo e rebaixamento do sulco — coeficientes em
`config/simulacao.json` (1.1, bloco `modelo_geometrico` novo), todos `nao_calibrado`.
`mesh/simulacao/morphs.py`: um `.glb` por (plano, imf) com targets esparsos `POSITION`+`NORMAL`,
`mesh.extras.targetNames`, `manifest.json` (`morphs/1.0`) e `asset.extras.iluminacao`
(`iluminacao_sh9/1.0`, contratos §10.6): os 9 coeficientes SH9 da luz assada na textura, ajustados por
IRLS/Huber à luminância nos vértices (`origem: "ajuste"`; t01: R² 0,95, RMS 0,7 % contra a luz
gravada), ou a luz padrão no quadro anatômico dos landmarks (`origem: "padrao"`). Catálogo: `config/catalogo/*.json` ou
arquivo explícito (`--catalogo`, `catalogo_arquivo`); testes usam `tests/fixtures/catalogo_teste.json`
(EXEMPLO NÃO CLÍNICO). Os `.glb` passam no Khronos glTF-Validator sem erros/avisos.

## Resultados (v0.0.1)

Erro máximo contra o gabarito nos 3 presets, após decimação, após `/processar` a partir da malha densa
em metros e após reescala por régua: **0,09 mm** (critério ±1 mm). Bland-Altman do pipeline:
n = 126, LoA [−0,06; +0,08] mm. Volume (v2): erro −3 a −5 % nos 3 presets. Morphs com
`config/catalogo/exemplo.json`: 24 targets por torso, 4 `.glb` (~19 MB no total), ~1,6 s.
Relatório completo em `docs/validacao/v0.0.1-services-mesh.md`.

## Limitações conhecidas

- Estimador de volume v2 validado só em sintéticos; em scans reais o anel lateral pode pegar braço/axila
  (tratado por rejeição robusta, mas não medido). O id `plano_base_elipse` foi mantido por compatibilidade.
- Heurística de unidade (ADR 0013): corpo inteiro em cm > 158 cm seria lido como mm (e avisado).
- Modelo de simulação é ilustração não calibrada (fase 4 calibra); FEBio e surrogate são stubs.
- Estiramento da textura (T5, ADR 0020): fora da faixa de ±20 mm do sulco, λ = área depois/antes fica
  entre 0,82 e 1,92 e nenhum triângulo inverte; dentro dela a transição de 12 mm do modelo estica
  triângulos da prega até ~15× e deixa alguns de lado (lacuna registrada, teste `xfail` estrito).
- Bland-Altman com cliques humanos (critério real do Marco 1) depende do viewer do `apps/web`.
