# services/mesh — torso sintético, pré-processamento e antropometria (Marcos 0 e 1)

Serviço Python 3.11 (FastAPI) que implementa o lado Python de `docs/contratos.md` (contrato 1.0):
torso sintético paramétrico com gabarito, `/processar`, `/reescalar`, `/medir` (geodésica MMP exata,
volume `plano_base_elipse`, quadro anatômico), `/validar-bland-altman`. `/morphs` responde 501 até o
Marco 2. Unidades: **mm** e **mL**; +Y cranial, +Z anterior, +X esquerda da paciente (ADR 0010).

## Comandos

```bash
bash scripts/mesh.sh venv                   # cria services/mesh/.venv e instala -e .[dev]
bash scripts/mesh.sh torsos                 # gera os 3 presets em $DATA_DIR/sinteticos (padrão data/)
bash scripts/mesh.sh dev                    # API em http://127.0.0.1:8765 (só loopback)
bash scripts/mesh.sh test                   # ruff + pytest (~3 min: gera os 3 torsos em tmp)

cd services/mesh
.venv/bin/python -m mesh.cli torso --preset t01_simetrico_300 --saida ../../data/sinteticos
.venv/bin/python -m mesh.cli torso --parametros meu_torso.json --saida ../../data/sinteticos
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
  sintetico/         superfície analítica do torso, gerador + gabarito, textura procedural neutra
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

## Resultados (v0.0.1)

Erro máximo contra o gabarito nos 3 presets, após decimação, após `/processar` a partir da malha densa
em metros e após reescala por régua: **0,09 mm** (critério ±1 mm). Bland-Altman do pipeline:
n = 126, LoA [−0,06; +0,08] mm. Relatório completo em `docs/validacao/v0.0.1-services-mesh.md`.

## Limitações conhecidas

- O estimador de volume do contrato (`plano_base_elipse`) superestima 35–45 % nos sintéticos porque o
  plano base-medial/base-lateral/sulco corta a parede torácica curva. Relatado, com faixa ±15 % sempre
  presente; a meta ±15 % não é atingida.
- Heurística de unidade do contrato (`< 500 → cm`) classifica como cm um tronco em mm com maior
  dimensão < 500 mm (ex.: torso recortado de 475 mm). A régua continua sendo a escala válida.
- Bland-Altman com cliques humanos (critério real do Marco 1) depende do viewer do `apps/web`.
