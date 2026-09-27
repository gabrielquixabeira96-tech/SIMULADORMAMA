# Contratos de dados e arquivos — simulador de mamoplastia de aumento

Versão do contrato: **1.0** (2026-09-26). Toda alteração incompatível incrementa o número e vira ADR.

Este documento é a única fonte de verdade para o que `apps/web` (Next.js + TypeScript + react-three-fiber) e `services/mesh` (Python) trocam entre si. Os dois implementadores devem conseguir produzir código compatível lendo apenas este arquivo, os esquemas em `config/schemas/` e os ADRs em `docs/adr/`.

Convenções deste documento:

- "DEVE" / "NUNCA" = obrigatório; "PODE" = opcional; "RECOMENDADO" = padrão salvo justificativa.
- Nomes de campos JSON, colunas SQL, IDs e enums são **snake_case, ASCII, sem acento**, em português (`furcula`, não `fúrcula`).
- Todo JSON trocado leva o campo `esquema` (`"<nome>/<versao>"`), e o consumidor DEVE rejeitar versão desconhecida.
- Os esquemas JSON Schema (draft 2020-12) em `config/schemas/` são a forma executável destes contratos. O web os espelha em zod (`packages/contratos`); o Python valida com `jsonschema` (MIT). Em divergência entre este texto e o `.schema.json`, o `.schema.json` vence e o texto é corrigido.

Sumário:

1. Sistema de coordenadas e unidades
2. Landmarks canônicos
3. Medidas canônicas (distâncias e volumes)
4. Torso sintético: parâmetros e gabarito (`gabarito/1.0`)
5. Formato de malhas (OBJ, PLY, glTF) e layout de arquivos
6. Registro de medidas trocado entre web e Python (`medidas/1.0`)
7. API HTTP do `services/mesh`
8. Configuração TEPID (`config/tepid.json`)
9. Configuração de simulação (`config/simulacao.json`)
10. Morph targets glTF: nomes, arquivos e manifesto (`morphs/1.0`)
11. Catálogo de implantes (`catalogo/1.1`)
12. Interfaces vazias: FEBio e surrogate
13. Flag `DESENHO` nos contratos
14. Camada do LLM (`anamnese/1.0`, `relatorio/1.0`)
15. Registro de validação (`docs/validacao/`)
16. Versão do software
17. Banco de dados (DDL canônico)

---

## 1. Sistema de coordenadas e unidades

| Item | Decisão |
|---|---|
| Unidade linear | **milímetro (mm)** em todo arquivo, API, coluna de banco e variável de UI. Sem exceção: OBJ, PLY, glTF, JSON e SQL estão em mm. |
| Unidade de volume | **mililitro (mL = cm³)** nos JSONs e no banco. Internamente o Python calcula em mm³ e divide por 1000 ao serializar. |
| Unidade de ângulo | grau decimal. |
| Sufixos de campo | Todo campo numérico dimensional leva sufixo: `_mm`, `_ml`, `_graus`, `_pct` (0–100), `_fator` (adimensional). |
| Precisão serializada | Distâncias e coordenadas com 2 casas decimais (0,01 mm); volumes com 1 casa (0,1 mL). Comparações usam tolerância, nunca igualdade. |
| Sistema | Cartesiano, **destro**, **Y para cima** (padrão three.js e glTF). |
| +X | **lado esquerdo da paciente** (quem olha a paciente de frente vê +X à sua própria direita). |
| +Y | **cranial** (para cima). |
| +Z | **anterior** (sai do tórax em direção ao observador de frente). |
| Posição da paciente | Em pé ou sentada ereta, braços ao lado do corpo, olhando para +Z. Protocolo de captura (`protocolo-captura-3d`) fixa isso. |
| Lados | `dir` = direita da paciente (X negativo), `esq` = esquerda da paciente (X positivo). NUNCA "esquerda da tela". |

### 1.1 Quadros de referência

Existem dois quadros; os arquivos declaram qual usam.

- **`quadro: "scan"`** — o quadro em que a malha foi recebida (após conversão de unidade para mm e após calibração de escala). Origem e orientação arbitrárias. Malhas de pacientes reais ficam neste quadro em disco.
- **`quadro: "anatomico"`** — origem na **fúrcula**; eixos definidos pelos landmarks. Torsos sintéticos são gerados diretamente neste quadro (então `scan` ≡ `anatomico` para eles).

Definição do quadro anatômico a partir dos landmarks (fórmula de referência; os dois lados DEVEM implementá-la identicamente):

```
origem = furcula
y0 = normalizar(furcula - linha_media_inferior)            # cranial
x0 = normalizar(mamilo_esq - mamilo_dir)                   # esquerda da paciente (aproximado)
z  = normalizar(cruz(x0, y0))                              # anterior
x  = cruz(y0, z)                                            # re-ortogonalizado
y  = y0
```

Matriz `M_scan_para_anatomico` (4×4, **coluna-major**, como `THREE.Matrix4.elements` e glTF): `p_anat = R^T · (p_scan − origem)`, com `R = [x y z]` colunas. Ela é serializada em `medidas.quadro_anatomico.matriz` (16 números). Se `mamilo_esq`/`mamilo_dir`/`linha_media_inferior` faltarem, o quadro anatômico é `null` e as medidas dependentes de simetria são omitidas.

### 1.2 Índices, IDs e tempo

- Índices de vértice e face: inteiros **base 0**, na malha **processada** (decimada). Nunca na original.
- `malha_id`, `paciente_id`, `medida_id`, `simulacao_id`: UUID v4 em texto minúsculo.
- `pseudonimo`: texto `^P-[0-9A-HJ-NP-Z]{6}$` (sem I, O para evitar confusão), gerado aleatoriamente. O vínculo pseudônimo → identidade fica **fora** do sistema (prontuário/PEP).
- Datas: ISO 8601 com fuso, ex. `2026-09-26T14:00:00-04:00`. Datas de calendário: `AAAA-MM-DD`.

---

## 2. Landmarks canônicos

Conjunto canônico de **10 IDs**. A `PROMPT.md` fala em "6 a 8 landmarks por clique": os **6 obrigatórios** abaixo bastam para SSN-N, N-IMF e intermamilar; os **4 da base** são opcionais e só eles permitem a largura da base (sem eles, `base_*` é `null`). A UI apresenta a sequência guiada na ordem da tabela.

| ID | Obrigatório | Lado | Definição anatômica (ponto na superfície da pele) |
|---|---|---|---|
| `furcula` | sim | — | Incisura jugular do esterno (suprasternal notch, SSN): ponto mais profundo da fúrcula na linha média. |
| `mamilo_dir` | sim | dir | Centro do mamilo direito. |
| `mamilo_esq` | sim | esq | Centro do mamilo esquerdo. |
| `sulco_dir` | sim | dir | Ponto do sulco inframamário direito no meridiano do mamilo (ponto mais inferior da prega, na vertical do mamilo). |
| `sulco_esq` | sim | esq | Idem, esquerdo. |
| `linha_media_inferior` | sim | — | Ponto da linha média esternal ao nível dos sulcos inframamários (aprox. apêndice xifoide). Define, com a fúrcula, o eixo Y anatômico. |
| `base_medial_dir` | não | dir | Borda medial da base mamária direita, no plano horizontal do mamilo. |
| `base_lateral_dir` | não | dir | Borda lateral da base mamária direita, no plano horizontal do mamilo. |
| `base_medial_esq` | não | esq | Idem, esquerda. |
| `base_lateral_esq` | não | esq | Idem, esquerda. |

Regras:

- Um landmark é um ponto **na superfície** da malha processada. É representado por `posicao` `[x, y, z]` em mm (ponto exato do raycast) **e** `vertice` (índice do vértice mais próximo). Distâncias euclidianas e geodésicas usam `posicao`: a geodésica parte do ponto exato, projetado e inserido na malha (seção 3.1; ADR 0016). `vertice` é validado pelo `services/mesh` (índice dentro de `processada.obj`, senão 422 `vertice_invalido`), mas não entra no cálculo. Ambos são obrigatórios.
- `origem` de cada landmark: `"clique"` (médico), `"gabarito"` (torso sintético), `"automatico"` (fase avançada; DESENHO=B apenas).
- Nomes fora da tabela DEVEM ser rejeitados por ambos os lados.

---

## 3. Medidas canônicas

### 3.1 Distâncias

| ID | De → para | Descrição |
|---|---|---|
| `ssn_n_dir` | `furcula` → `mamilo_dir` | Fúrcula–mamilo direito (SSN-N). |
| `ssn_n_esq` | `furcula` → `mamilo_esq` | Fúrcula–mamilo esquerdo. |
| `n_imf_dir` | `mamilo_dir` → `sulco_dir` | Mamilo–sulco direito, **em repouso** (o "sob estiramento" é digitado no TEPID, nunca medido no 3D). |
| `n_imf_esq` | `mamilo_esq` → `sulco_esq` | Idem, esquerdo. |
| `base_dir` | `base_medial_dir` → `base_lateral_dir` | Largura da base direita. `null` se faltar landmark. |
| `base_esq` | `base_medial_esq` → `base_lateral_esq` | Largura da base esquerda. |
| `intermamilar` | `mamilo_dir` → `mamilo_esq` | Distância intermamilar. |

Cada distância tem **dois valores**:

- `euclidiana_mm`: norma do vetor entre as duas `posicao`. Fórmula fechada; qualquer lado calcula.
- `geodesica_mm`: comprimento do caminho mais curto **sobre a superfície** da malha processada (soldada: vértices duplicados em costura de UV fundidos) entre as duas `posicao`. Cada `posicao` é projetada na superfície e inserida como vértice novo (divisão 1→3 do triângulo que a contém); ponto a menos de 2 % (coordenada baricêntrica) de um vértice usa esse vértice, e ponto junto a uma aresta é empurrado 2 % para dentro (deslocamento < 0,1 mm). Partir do vértice mais próximo erraria até ~2 mm por extremo numa malha de 40 mil vértices (ADR 0016). **Algoritmo de referência: geodésica discreta exata (MMP — Mitchell, Mount & Papadimitriou)** sobre a malha triangular; implementação sugerida `pygeodesic` (MIT). Alternativa aceita: método do calor (`potpourri3d`, MIT) desde que a diferença contra MMP nos torsos sintéticos fique < 0,5 mm. **Dijkstra puro sobre arestas NÃO é aceito** como valor registrado (superestima até ~8 %); o web PODE mostrá-lo como prévia rotulada `aproximada`, mas o valor gravado vem do `services/mesh` (ADR 0011).

### 3.2 Volumes

| ID | Descrição |
|---|---|
| `volume_dir` | Volume mamário direito estimado, em mL, com incerteza. |
| `volume_esq` | Idem, esquerdo. |

Estimador de referência (`metodo: "plano_base_elipse"`, **v2 — parede reconstruída**, ADR 0012), calculado apenas pelo `services/mesh`. O id `plano_base_elipse` foi mantido por compatibilidade (o web o valida como literal); o algoritmo mudou:

1. Quadro da base (lado X): plano por `base_medial_X`, `base_lateral_X` e `sulco_X`; `e1` = medial→lateral, `n` = normal orientada para o mamilo, `e2` = `n × e1` orientado para cranial. Exige os 4 landmarks da base; sem eles, `volume_X` é `null` e a resposta traz o aviso `volume_X:landmarks_da_base_ausentes` (o esquema não permite `motivo` num `null`).
2. Elipse da base: centro no ponto médio medial–lateral, semieixo `a = base_X/2` em `e1` e `b = |(sulco_X − centro)·e2|` em `e2`. Coordenadas normalizadas `r = √((x/a)² + (y/b)²)`.
3. **Parede reconstruída** (novo no v2): polinômio cúbico `h_parede(x/a, y/b)` ajustado por mínimos quadrados às alturas (em `n`) dos vértices de pele frontal (normal·n > 0,2) no anel `1,05 ≤ r ≤ 1,30`, com rejeição robusta iterativa (resíduo > +2,5 DP ou < −4 DP, DP pela MAD). Com menos de 30 pontos no anel, cai para o plano (v1) e avisa `volume_X:anel_insuficiente_parede_plana`.
4. Volume = soma, sobre as faces frontais com os 3 vértices em `r ≤ 1,05`, de área projetada × média de `max(h − h_parede, 0)`.
5. `incerteza_ml = valor_ml × config.simulacao.incerteza.volume_relativa_fator` (0,15 até calibração) — sempre reportada; a UI NUNCA mostra volume sem a faixa.

O v1 (altura sobre o próprio plano) contava a "lente" de parede torácica curva anterior ao plano como mama e superestimava 35–45 % nos sintéticos; o v2 erra −3 a −5 % neles (registro em `docs/validacao/v0.0.1-services-mesh.md`).

O gabarito do torso sintético informa o **volume adicionado real** (seção 4), que é a verdade contra a qual o estimador é validado.

### 3.3 Tolerâncias de aceitação (testes)

| Comparação | Tolerância |
|---|---|
| Euclidiana web vs Python, mesmos landmarks | ≤ 0,01 mm (só arredondamento). |
| Euclidiana medida vs gabarito, landmarks do gabarito, torso sintético | ≤ 1,0 mm (Marco 0). |
| Geodésica medida vs gabarito (malha decimada vs densa) | ≤ 1,0 mm ou 1 % (o maior). |
| Bland-Altman clique humano vs gabarito, ≥30 pares | LoA dentro de ±2 mm (Marco 1). |
| Volume estimado vs adicionado (sintético) | ≤ ±10 % nos 3 presets e faixa (±15 %) contendo o real (ADR 0012). |

---

## 4. Torso sintético: parâmetros e gabarito (`gabarito/1.0`)

Gerador: `services/mesh` (`python -m mesh.cli torso` e `POST /torso-sintetico`). Determinístico dado `semente`. Sem textura fotográfica: textura **neutra procedural** (tom uniforme com ruído leve, para exercitar o carregamento de `map_Kd`).

### 4.1 Parâmetros de entrada

```jsonc
{
  "esquema": "torso_parametros/1.0",
  "nome": "t01_simetrico_300",              // ^[a-z0-9_]+$ — vira nome da pasta
  "semente": 42,                             // inteiro ≥ 0
  "largura_toracica_mm": 300,               // largura máxima do tórax ao nível dos mamilos [220, 420]
  "altura_torso_mm": 450,                   // da fúrcula à borda inferior do recorte [300, 600]; padrão 450
  "profundidade_toracica_mm": 200,          // ântero-posterior sem mama [140, 300]; padrão 200
  "volume_ml": { "dir": 300, "esq": 300 },  // volume ADICIONADO por mama sobre a parede [0, 1200]
  "ptose": { "dir": 0.0, "esq": 0.0 },      // 0 = sem ptose; 1 = máxima (mamilo abaixo do sulco). Contínuo [0, 1]
  "n_imf_mm": { "dir": 70, "esq": 70 },     // distância VERTICAL (ΔY) alvo entre mamilo e sulco em repouso [40, 140]
  "assimetria": {
    "delta_altura_mamilo_mm": 0,            // Y(mamilo_esq) − Y(mamilo_dir) além do que ptose/volume já produzem
    "delta_lateral_mamilo_mm": 0            // deslocamento extra de mamilo_esq em X (positivo = mais lateral)
  },
  "resolucao": { "densa_faces": 300000, "decimada_vertices": 40000 }
}
```

Nota: `volume_ml`, `ptose` e `n_imf_mm` são por lado; `assimetria` só adiciona deslocamentos que os três anteriores não capturam. Torso "simétrico" = lados iguais e `assimetria` zerada; os testes de simetria (Marco 2) usam esse caso.

### 4.2 Saída em disco

```
<saida>/<nome>/
  parametros.json      # o objeto acima, ecoado
  gabarito.json        # seção 4.3
  denso.obj            # malha densa (~300k faces), mm, quadro anatômico — só para gerar o gabarito; PODE ser apagada
  torso.obj            # malha decimada 30–50k vértices, mm, quadro anatômico
  torso.mtl            # `map_Kd textura.png`
  textura.png          # 1024×1024, neutra
  torso.glb            # a mesma malha decimada, com textura embutida, para o viewer (seção 5.3)
```

### 4.3 `gabarito.json`

```jsonc
{
  "esquema": "gabarito/1.0",
  "nome": "t01_simetrico_300",
  "gerado_em": "2026-09-26T14:00:00-04:00",
  "versao_software": "0.0.1",
  "unidade": "mm",
  "quadro": "anatomico",
  "parametros": { /* cópia integral de parametros.json */ },
  "landmarks": {
    "furcula":              { "posicao": [0.0, 0.0, 0.0],     "vertice": 1234, "origem": "gabarito" },
    "mamilo_dir":           { "posicao": [-95.1, -190.4, 88.2], "vertice": 2345, "origem": "gabarito" },
    "mamilo_esq":           { "posicao": [ 95.1, -190.4, 88.2], "vertice": 3456, "origem": "gabarito" },
    "sulco_dir":            { "posicao": [...], "vertice": 0, "origem": "gabarito" },
    "sulco_esq":            { "posicao": [...], "vertice": 0, "origem": "gabarito" },
    "linha_media_inferior": { "posicao": [...], "vertice": 0, "origem": "gabarito" },
    "base_medial_dir":      { "posicao": [...], "vertice": 0, "origem": "gabarito" },
    "base_lateral_dir":     { "posicao": [...], "vertice": 0, "origem": "gabarito" },
    "base_medial_esq":      { "posicao": [...], "vertice": 0, "origem": "gabarito" },
    "base_lateral_esq":     { "posicao": [...], "vertice": 0, "origem": "gabarito" }
  },
  "distancias": {
    "ssn_n_dir":   { "euclidiana_mm": 212.30, "geodesica_mm": 224.10 },
    "ssn_n_esq":   { "euclidiana_mm": 212.30, "geodesica_mm": 224.10 },
    "n_imf_dir":   { "euclidiana_mm": 71.20,  "geodesica_mm": 78.90 },
    "n_imf_esq":   { "euclidiana_mm": 71.20,  "geodesica_mm": 78.90 },
    "base_dir":    { "euclidiana_mm": 120.00, "geodesica_mm": 138.40 },
    "base_esq":    { "euclidiana_mm": 120.00, "geodesica_mm": 138.40 },
    "intermamilar":{ "euclidiana_mm": 190.20, "geodesica_mm": 205.30 }
  },
  "volumes": {
    "dir": { "adicionado_ml": 300.0, "estimado_plano_base_elipse_ml": 288.4 },
    "esq": { "adicionado_ml": 300.0, "estimado_plano_base_elipse_ml": 288.4 }
  },
  "malha": {
    "densa":    { "arquivo": "denso.obj", "n_vertices": 150312, "n_faces": 300000 },
    "decimada": { "arquivo": "torso.obj", "n_vertices": 40011, "n_faces": 79802, "sha256": "..." }
  },
  "geodesica": { "algoritmo": "mmp", "biblioteca": "pygeodesic", "malha": "densa" }
}
```

Regras do gabarito:

- `landmarks.*.posicao` são os pontos exatos da superfície paramétrica (não do vértice), em mm, no quadro anatômico (`furcula` = origem exata).
- `landmarks.*.vertice` é o vértice mais próximo **na malha decimada** `torso.obj`.
- `distancias.*.euclidiana_mm` é calculada das `posicao` exatas.
- `distancias.*.geodesica_mm` é calculada por MMP na **malha densa**, entre as `posicao` exatas inseridas na malha densa (mesmo método da seção 3.1; ADR 0016). É a "verdade" de geodésica.
- `volumes.X.adicionado_ml` é o volume real adicionado pelo gerador (integração numérica da diferença de altura entre a superfície com mama e a parede sem mama, na malha densa; erro < 0,5 %). `estimado_plano_base_elipse_ml` é o estimador da seção 3.2 aplicado à malha decimada com os landmarks do gabarito, para referência.

### 4.4 Casos obrigatórios (fixtures)

Os três torsos do critério do Marco 0, gerados por `python -m mesh.cli torso --preset <nome>`:

| nome | largura | volume dir/esq | ptose | n_imf | assimetria |
|---|---|---|---|---|---|
| `t01_simetrico_300` | 300 | 300/300 | 0/0 | 70/70 | 0 |
| `t02_assimetrico` | 320 | 350/280 | 0.3/0.2 | 75/68 | +8 mm altura, +5 mm lateral |
| `t03_pequeno_ptose` | 280 | 180/180 | 0.6/0.6 | 90/90 | 0 |

Saída padrão: `data/sinteticos/<nome>/` (ignorado pelo git; gerado pela CI).

---

## 5. Formato de malhas e layout de arquivos

### 5.1 OBJ (entrada aceita e saída do Python)

- ASCII UTF-8; `v x y z`, `vt u v`, `vn` opcional, `f` **só triângulos** (o `services/mesh` triangula quads/polígonos na entrada; a saída é sempre triangular).
- Um único objeto/grupo; `mtllib` + `usemtl` com `map_Kd <textura>` (PNG ou JPG, ao lado do OBJ). Sem `map_Kd` → textura ausente é permitida (viewer usa cor neutra).
- Unidade na **saída** do Python: mm. Unidade na **entrada** é declarada em `unidade_origem` (`"m"`, `"cm"`, `"mm"`, `"desconhecida"`); ver 7.2.
- Coordenadas UV: origem no canto **inferior** esquerdo (padrão OBJ). O Python inverte V ao exportar glTF (glTF usa origem superior esquerda).

### 5.2 PLY (entrada aceita)

- ASCII ou binário little-endian; `vertex` com `x y z`, opcional `nx ny nz`, opcional `red green blue` (cor por vértice), opcional `s t`/`u v` + `comment TextureFile <nome>`. `face` com `vertex_indices` (triangulados na entrada).
- Cor por vértice é convertida para `COLOR_0` no glTF e exibida quando não houver textura.

### 5.3 glTF/GLB (formato do viewer e dos morph targets)

- Sempre **`.glb`** binário, glTF 2.0, **um único `mesh` com um único `primitive`** (`mode` 4, triângulos), atributos `POSITION`, `NORMAL`, `TEXCOORD_0` (se houver textura), `COLOR_0` (se houver cor por vértice), índices `uint32`.
- **Unidade: mm** (desvio consciente da convenção "metros" do glTF; ADR 0010). O arquivo DEVE declarar `asset.extras.unidade = "mm"` e `asset.extras.quadro = "scan" | "anatomico"`. O carregador do web DEVE rejeitar `.glb` sem `asset.extras.unidade == "mm"`.
- `asset.generator = "simulador-mamario/mesh <versao>"`.
- Material único, `pbrMetallicRoughness` com `baseColorTexture` (textura embutida como imagem PNG/JPG no GLB), `metallicFactor 0`, `roughnessFactor 0.8`, `doubleSided false`.
- A malha é `Y` para cima, sem nós com transformação (nó raiz com matriz identidade). O web NUNCA aplica escala ao carregar.
- Ordem dos vértices do `.glb` processado é a **mesma** de `processada.obj` (mesmo índice de vértice nos dois arquivos). Isso permite `landmarks.vertice` valer nos dois.

### 5.4 Layout de dados em disco (`DATA_DIR`)

Raiz definida pela variável `DATA_DIR` (padrão `./data`). Tudo abaixo está no `.gitignore` exceto `data/README.md`.

```
$DATA_DIR/
  pacientes/<pseudonimo>/
    malhas/<malha_id>/
      original/            # upload intacto (obj+mtl+png, ply, ou zip extraído)
      meta.json            # seção 7.2 (resposta de /processar, acumulada)
      processada.obj
      processada.mtl
      textura.png
      processada.glb
      morphs/              # seção 10
        manifest.json
        <plano>__<imf>.glb
    medidas/<medida_id>.json      # seção 6
    simulacoes/<simulacao_id>.json
    relatorios/<atendimento_id>.pdf
  sinteticos/<nome>/       # seção 4.2
  validacao/               # seção 18 (não é dado de paciente)
    malhas/<uuid>/         # torso sintético processado para a sessão (original/, processada.*, preparo.json)
    sessoes/<id>.json      # sessao_bland_altman/1.0
```

`apps/web` e `services/mesh` rodam na **mesma máquina** nesta fase e trocam **caminhos relativos a `DATA_DIR`** (nunca absolutos, nunca `..`). O Python DEVE recusar caminhos que escapem de `DATA_DIR`.

---

## 6. Registro de medidas (`medidas/1.0`)

Produzido pelo web (landmarks por clique + euclidianas) e completado pelo Python (geodésicas + volumes) via `POST /medir`. Gravado em `pacientes/<pseudonimo>/medidas/<medida_id>.json` e na tabela `medidas` (coluna `payload`).

```jsonc
{
  "esquema": "medidas/1.0",
  "medida_id": "uuid",
  "malha_id": "uuid",
  "pseudonimo": "P-7K2M9Q",
  "desenho": "B",                                 // "A" | "B" — modo em que foi gravado
  "versao_software": "0.0.1",
  "versao_config": { "tepid": "1.0", "simulacao": "1.0" },
  "unidade": "mm",
  "quadro": "scan",
  "gerado_em": "2026-09-26T14:00:00-04:00",
  "gerado_por": { "componente": "web", "usuario_id": "local" },
  "escala": {
    "metodo": "regua_2_pontos",                   // "regua_2_pontos" | "gabarito" | "nenhuma"
    "regua_mm": 100.0,
    "pontos": [[x1,y1,z1],[x2,y2,z2]],            // no quadro scan, ANTES do reescalonamento
    "fator": 1.0132,                              // regua_mm / |p2 − p1|
    "aplicado_em": "2026-09-26T13:58:00-04:00"    // quando /reescalar foi executado
  },
  "landmarks": {                                  // só IDs da seção 2
    "furcula": { "posicao": [x,y,z], "vertice": 1234, "origem": "clique" }
    // ...
  },
  "quadro_anatomico": {                           // null se faltar landmark
    "origem": [x,y,z], "x": [..], "y": [..], "z": [..], "matriz": [16 números, coluna-major]
  },
  "distancias": {                                 // só IDs da seção 3.1; ausentes → null
    "ssn_n_dir": { "euclidiana_mm": 212.30, "geodesica_mm": 224.10 },
    "base_dir": null
  },
  "volumes": {                                    // null em DESENHO=A (seção 13)
    "dir": { "valor_ml": 288.4, "incerteza_ml": 43.3, "metodo": "plano_base_elipse" },
    "esq": null
  },
  "geodesica": { "algoritmo": "mmp", "biblioteca": "pygeodesic", "versao": "0.5.6" },
  "medidas_digitadas": {                          // sempre presentes quando houver TEPID; obrigatórias em DESENHO=A
    "base_mm": { "dir": 120, "esq": 120 },
    "apss_mm": { "dir": 25, "esq": 25 },
    "pinca_polo_superior_mm": { "dir": 22, "esq": 22 },
    "pinca_sulco_mm": { "dir": 6, "esq": 6 },
    "n_imf_estirado_mm": { "dir": 80, "esq": 80 }
  }
}
```

Regras:

- `distancias.*.euclidiana_mm` é calculada pelo web e **conferida** pelo Python em `/medir`; divergência > 0,01 mm é erro 422.
- `distancias.*.geodesica_mm` e `volumes` só existem após `/medir`; antes disso são `null`.
- `medidas_digitadas` são cm no formulário clínico? **Não**: a UI PODE exibir cm, mas o JSON é sempre **mm** (25 mm, não 2,5 cm).
- Em `DESENHO=A`: `distancias` é gravado como `null` inteiro, `volumes` `null`, `landmarks` PODE existir (servem de âncora da simulação), `medidas_digitadas` obrigatório. Ver seção 13.

---

## 7. API HTTP do `services/mesh`

Servidor FastAPI (MIT) em `MESH_SERVICE_URL` (padrão `http://127.0.0.1:8765`). JSON UTF-8. Erros seguem `{"erro": {"codigo": "...", "mensagem": "...", "detalhes": {}}}` com status 400 (entrada inválida), 403 (rota desligada no desenho A), 404 (arquivo não encontrado), 422 (validação de contrato), 500. Sem autenticação nesta fase (só escuta em 127.0.0.1); o web é o único cliente. Todas as rotas são síncronas; `/morphs` pode levar minutos — o web usa timeout de 30 min.

Cabeçalho obrigatório em toda requisição, exceto `GET /saude`: `X-Desenho: A|B`. Ausente → `400 desenho_ausente`; outro valor → `400 desenho_invalido`. O serviço o grava no log estruturado e o ecoa na resposta. Com `X-Desenho: A`, o serviço recusa `POST /medir` com `403 desligado_no_desenho_a` (e ecoa `X-Desenho: A`) antes de calcular qualquer coisa, e registra no log o evento `desligado_no_desenho_a` com o `incluir_volume` recebido. É defesa em profundidade: o web já não chama `/medir` em A (seção 13; ADRs 0005 e 0016). Em `/morphs` com `X-Desenho: A`, `previsto` sai `null` (seção 10.4). As demais rotas funcionam igual nos dois desenhos.

### 7.1 `GET /saude`

→ `200 {"status": "ok", "versao_software": "0.0.1", "contrato": "1.0", "geodesica": {"biblioteca": "pygeodesic", "versao": "..."}}`

### 7.2 `POST /processar`

Recorte, limpeza, decimação e exportação. Entrada:

```jsonc
{
  "malha_dir": "pacientes/P-7K2M9Q/malhas/<malha_id>",   // relativo a DATA_DIR; contém original/
  "arquivo_original": "original/scan.obj",                // relativo a malha_dir
  "unidade_origem": "m",                                  // "m" | "cm" | "mm" | "desconhecida"
  "recorte": {
    "modo": "abaixo_do_pescoco",                          // "abaixo_do_pescoco" | "caixa" | "nenhum"
    "y_max_mm": null,                                     // modo caixa: limites em mm no quadro scan
    "y_min_mm": null
  },
  "decimacao": { "alvo_vertices": 40000, "min_vertices": 30000, "max_vertices": 50000 }
}
```

Comportamento:

- `unidade_origem = "desconhecida"`: heurística (ADR 0013) — escolhe a unidade cuja conversão deixa a maior dimensão da caixa envolvente mais perto, em escala logarítmica, de 500 mm (tamanho típico de tórax recortado). Equivale a: maior dimensão < 5 → metros; < 158,1 (= 500/√10) → cm; senão mm. Se a dimensão convertida cair fora de [150, 2500] mm, avisa `unidade_inferida_duvidosa:calibrar_pela_regua`. Registrar em `unidade_inferida`. (O critério antigo "< 500 → cm" chamava de cm um torso em mm com menos de 500 mm.)
- `abaixo_do_pescoco`: remover tudo acima do plano horizontal situado 3 cm abaixo do ponto mais estreito do pescoço (mínimo local da largura em X varrendo Y de cima para baixo); se não houver mínimo, não recortar e avisar.
- Limpeza: manter o maior componente conexo; remover faces degeneradas e vértices não referenciados; recomputar normais.
- Decimação: quádricas (`open3d.simplify_quadric_decimation` ou `fast-simplification`, ambos MIT); **`pymeshlab` é GPL e está proibido** (ADR 0009). Resultado com `min ≤ n_vertices ≤ max`; se a malha original já tiver menos que `min`, não decimar e avisar.
- Saída em `malha_dir`: `processada.obj`, `processada.mtl`, `textura.png` (copiada/convertida), `processada.glb`, `meta.json`.

Resposta `200`:

```jsonc
{
  "esquema": "malha_meta/1.0",
  "malha_id": "<uuid>", "malha_dir": "...",
  "unidade_origem": "m", "unidade_inferida": null, "fator_unidade": 1000.0,
  "fator_escala_acumulado": 1.0,                        // produto de todos os /reescalar
  "quadro": "scan",
  "original":  { "arquivo": "original/scan.obj", "n_vertices": 812331, "n_faces": 1600000, "sha256": "...", "tem_textura": true },
  "processada": { "obj": "processada.obj", "glb": "processada.glb", "n_vertices": 40011, "n_faces": 79802, "sha256_glb": "...", "caixa_mm": { "min": [x,y,z], "max": [x,y,z] } },
  "recorte": { "modo": "abaixo_do_pescoco", "y_corte_mm": 12.3, "aplicado": true },
  "avisos": [],
  "versao_software": "0.0.1", "gerado_em": "..."
}
```

Esse objeto é gravado como `meta.json` e atualizado por `/reescalar`.

### 7.3 `POST /reescalar`

```jsonc
{ "malha_dir": "...", "fator": 1.0132, "regua": { "regua_mm": 100, "pontos": [[..],[..]] } }
```

Multiplica todas as coordenadas de `processada.obj`/`.glb` por `fator` (em torno da origem), atualiza `meta.json` (`fator_escala_acumulado *= fator`, anexa `escala.historico[]`) e devolve o `malha_meta/1.0` atualizado. **Ordem obrigatória no web**: upload → `/processar` → calibrar régua → `/reescalar` → landmarks. Landmarks gravados antes de um `/reescalar` são invalidados pelo web.

### 7.4 `POST /medir`

```jsonc
{
  "malha_dir": "...",
  "landmarks": { /* seção 2, com posicao e vertice */ },
  "distancias_euclidianas_web": { "ssn_n_dir": 212.30 /* ... */ },   // para conferência
  "incluir_geodesica": true,
  "incluir_volume": true            // o web envia false em DESENHO=A
}
```

→ `200` com `{ "distancias": {...}, "volumes": {...} | null, "quadro_anatomico": {...} | null, "geodesica": {...}, "avisos": [] }` nos formatos da seção 6. Erro 422 `euclidiana_divergente` se alguma euclidiana do web diferir > 0,01 mm da recalculada. Com `X-Desenho: A` → `403 desligado_no_desenho_a`, sem corpo de medida (ver início desta seção).

### 7.5 `POST /torso-sintetico`

Entrada: objeto `torso_parametros/1.0` + `"saida_dir": "sinteticos"` (relativo a `DATA_DIR`). Resposta: o `gabarito/1.0` gerado. Equivalente CLI: `python -m mesh.cli torso --parametros p.json --saida data/sinteticos` e `--preset t01_simetrico_300`.

### 7.6 `POST /morphs`

Ver seção 10.4.

### 7.7 `POST /validar-bland-altman`

```jsonc
{ "pares": [ { "medida": "ssn_n_dir", "referencia_mm": 212.30, "medido_mm": 213.1, "torso": "t01_simetrico_300", "operador": "op1" } ] }
```

→ `{ "n": 30, "vies_mm": 0.4, "dp_mm": 0.9, "loa_inferior_mm": -1.36, "loa_superior_mm": 2.16, "dentro_de_2mm": true, "por_medida": { ... } }`. LoA = viés ± 1,96·DP. Usado pelo e2e `apps/web/e2e/validacao.spec.ts` para o Bland-Altman do Marco 1, que vai para o registro de componente `v<versao>-web-marcos-0-1.json` (seção 15).

---

## 8. Configuração TEPID — `config/tepid.json`

Esquema `tepid_config/1.0` (`config/schemas/tepid_config.schema.json`). **Todo limiar leva `conferir_no_texto_original: true` e a fonte**; nada aqui é verdade clínica até que Gabriel confira Tebbetts & Adams 2002 (PRS 109(4):1396) e 2005 ("High Five") e mude o campo para `false` com a página. O web lê este arquivo no servidor e NUNCA copia números para o código. Unidade: mm (o texto original usa cm; a conversão ×10 é parte da conferência).

Estrutura:

```jsonc
{
  "esquema": "tepid_config/1.0",
  "versao": "1.0",
  "status": "nao_conferido",                     // "nao_conferido" | "conferido"
  "fonte": { "referencia": "Tebbetts JB, Adams WP. PRS 2002;109(4):1396-1409 (TEPID); Tebbetts & Adams, PRS 2005 (High Five)", "doi": "10.1097/00006534-200204010-00030", "nota": "conferir no texto original" },
  "campos": {                                    // o formulário é gerado daqui
    "base_mm":                { "rotulo": "Largura da base mamária", "min": 80, "max": 200, "por_lado": true },
    "apss_mm":                { "rotulo": "APSS (anterior pull skin stretch)", "min": 5, "max": 60, "por_lado": true },
    "pinca_polo_superior_mm": { "rotulo": "Pinçamento do polo superior", "min": 3, "max": 80, "por_lado": true },
    "pinca_sulco_mm":         { "rotulo": "Pinçamento no sulco inframamário", "min": 1, "max": 40, "por_lado": true },
    "n_imf_estirado_mm":      { "rotulo": "N-IMF sob estiramento máximo", "min": 30, "max": 160, "por_lado": true }
  },
  "regras": [                                    // avaliadas SÓ em DESENHO=B; cada uma vira alerta, nunca decisão
    {
      "id": "plano_pinca_polo_superior",
      "campo": "pinca_polo_superior_mm",
      "operador": "<", "limiar_mm": 20,
      "alerta": "Pinçamento do polo superior abaixo do limiar: considerar plano dual/submuscular.",
      "conferir_no_texto_original": true, "fonte_pagina": null
    }
  ],
  "tabelas": [                                   // lookups (ex.: base → volume inicial; volume → N-IMF alvo)
    { "id": "volume_inicial_por_base", "entrada": "base_mm", "saida": "volume_ml", "pontos": [[105,200],[110,250],[115,275],[120,300],[125,325],[130,350],[135,375],[140,400]], "interpolar": "linear", "conferir_no_texto_original": true },
    { "id": "ajuste_apss", "entrada": "apss_mm", "saida": "delta_volume_ml", "faixas": [{"ate": 20, "valor": -30}, {"ate": 30, "valor": 0}, {"acima": 30, "valor": 30}], "conferir_no_texto_original": true },
    { "id": "n_imf_alvo_por_volume", "entrada": "volume_ml", "saida": "n_imf_mm", "pontos": [[200,70],[250,75],[300,80],[350,85],[400,90]], "interpolar": "linear", "conferir_no_texto_original": true }
  ]
}
```

Semântica dos operadores: `<`, `<=`, `>`, `>=`, `entre` (com `limiar_min_mm`/`limiar_max_mm`). `tabelas[].faixas` são avaliadas em ordem (`ate` = inclusivo). Em `DESENHO=A`, `regras` e `tabelas` são ignoradas e o web só usa `campos` para validar o formulário.

---

## 9. Configuração de simulação — `config/simulacao.json`

Esquema `simulacao_config/1.0`. **Todo coeficiente numérico está dentro de um objeto com `nao_calibrado: true`**; o pipeline de calibração (fase 4) é o único que muda isso. `services/mesh` é o único consumidor dos coeficientes (gera os morphs); o web lê apenas `incerteza` e `imf.opcoes` para UI.

```jsonc
{
  "esquema": "simulacao_config/1.0",
  "versao": "1.0",
  "nao_calibrado": true,
  "modelo": "geometrico_parametrico_v1",
  "implante": {
    "forma_redonda":   { "perfil_altura": "elipsoide_truncado", "nao_calibrado": true },
    "forma_anatomica": { "perfil_altura": "elipsoide_assimetrico", "ponto_max_projecao_fator": { "valor": 0.62, "nao_calibrado": true } }
  },
  "planos": {
    "subglandular": {
      "transmissao_projecao_fator":  { "valor": 0.90, "nao_calibrado": true },   // fração da projeção do implante que aparece na pele
      "alargamento_base_fator":      { "valor": 1.05, "nao_calibrado": true },
      "preenchimento_polo_superior_fator": { "valor": 0.80, "nao_calibrado": true },
      "deslocamento_mamilo_anterior_fator": { "valor": 0.85, "nao_calibrado": true },
      "deslocamento_mamilo_cranial_fator":  { "valor": 0.10, "nao_calibrado": true },
      "suavizacao_sigma_mm":          { "valor": 18.0, "nao_calibrado": true }
    },
    "dual_plane": {
      "transmissao_projecao_fator":  { "valor": 0.80, "nao_calibrado": true },
      "alargamento_base_fator":      { "valor": 1.02, "nao_calibrado": true },
      "preenchimento_polo_superior_fator": { "valor": 0.60, "nao_calibrado": true },
      "deslocamento_mamilo_anterior_fator": { "valor": 0.80, "nao_calibrado": true },
      "deslocamento_mamilo_cranial_fator":  { "valor": 0.15, "nao_calibrado": true },
      "suavizacao_sigma_mm":          { "valor": 24.0, "nao_calibrado": true }
    }
  },
  "imf": {
    "opcoes": ["manter", "rebaixar"],
    "rebaixar": { "mm_por_100ml": { "valor": 4.0, "nao_calibrado": true }, "maximo_mm": { "valor": 20.0, "nao_calibrado": true } }
  },
  "tecido_mole": {
    "espessura_referencia_mm": { "valor": 20.0, "nao_calibrado": true },   // pinçamento de referência para o fator de transmissão
    "atenuacao_por_mm_pinca_fator": { "valor": 0.005, "nao_calibrado": true }
  },
  "incerteza": {
    "envelope_rms_mm": { "valor": 4.5, "fonte": "Assaaeed 2024; Roostaeian 2014", "configuravel": true },
    "volume_relativa_fator": { "valor": 0.15, "nao_calibrado": true },
    "aviso_fixo": "Ilustração, não previsão de resultado"
  }
}
```

O bloco `modelo_geometrico` (ADR 0014) traz os coeficientes de forma do modelo (todos `{valor, nao_calibrado: true}`): `borda_implante_expoente` (0,5), `imf_transicao_mm` (12), `mamilo_sigma_fator` (0,30), `rebaixar_sigma_lateral_fator` (0,30), `rebaixar_decaimento_cranial_fator` (0,45), `rebaixar_decaimento_caudal_fator` (0,90) e, desde a versão **1.2**, `profundidade_sigma_mm` (40), `frente_profundidade_min_mm` (−60), `frente_profundidade_rampa_mm` (30) e `frente_normal_rampa` (0,3). Desde a 1.2 o bloco é **obrigatório** e o `services/mesh` não tem valor padrão no código: chave ausente → erro `config_simulacao_incompleta`. O web continua lendo só `versao`, `incerteza` e `imf.opcoes`. Algoritmo do modelo: docstring de `services/mesh/mesh/simulacao/geometrico.py` e ADR 0014.

Propriedades que os testes de regressão geométrica (Marco 2) DEVEM garantir para qualquer valor desses coeficientes: (a) **monotonicidade** — volume maior do mesmo modelo/plano/IMF → projeção anterior do mamilo maior; (b) **simetria** — torso simétrico + mesmo implante bilateral → malha resultante simétrica em X dentro de 0,1 mm; (c) `imf=manter` não move `sulco_*` mais que 1 mm; `imf=rebaixar` move para −Y em `min(mm_por_100ml × volume/100, maximo_mm)`.

---

## 10. Morph targets glTF (`morphs/1.0`)

### 10.1 Princípio

O web nunca calcula deformação: interpola morph targets pré-computados pelo Python para **cada malha** (paciente ou torso sintético). Latência alvo < 100 ms no iPad, < 16 ms no desktop.

### 10.2 Nome canônico do target

```
mt__<implante_id>__<plano>__<imf>
```

- `implante_id`: ID do catálogo (seção 11), `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `plano`: `subglandular` | `dual_plane`.
- `imf`: `manter` | `rebaixar`.
- Regex completa: `^mt__[a-z0-9]+(-[a-z0-9]+)*__(subglandular|dual_plane)__(manter|rebaixar)$`.
- Cada target é **bilateral** (o mesmo implante nos dois lados). Assimetria de implantes (2 modelos diferentes) é feita pelo web combinando **dois targets com máscara de lado**: o Python exporta, para cada target, também as variantes `..._dir` e `..._esq` (só o lado indicado deformado) quando `lados: "separados"` for pedido; nomes: `mt__<implante>__<plano>__<imf>__dir` / `__esq`. Marco 2 exige `separados` (comparação lado a lado de 2 implantes).

### 10.3 Arquivos

```
<malha_dir>/morphs/
  manifest.json
  subglandular__manter.glb
  subglandular__rebaixar.glb
  dual_plane__manter.glb
  dual_plane__rebaixar.glb
```

- **Um `.glb` por (plano, imf)**, contendo a **malha base completa** (mesma geometria, textura e ordem de vértices de `processada.glb`) mais N morph targets (um por implante × lado).
- Targets como **deltas** (`POSITION` obrigatório, `NORMAL` recomendado), em **acessores esparsos** (glTF `sparse`) cobrindo só os vértices com |delta| > 0,01 mm. Isso mantém cada arquivo em dezenas de MB para 60 implantes × 3 variantes.
- Nomes dos targets em `mesh.extras.targetNames` (array, mesma ordem dos `targets`), que o `GLTFLoader` do three.js expõe em `mesh.morphTargetDictionary`.
- `asset.extras.unidade = "mm"`, `asset.extras.quadro` igual ao da malha base, `asset.extras.esquema = "morphs/1.0"`, `asset.extras.versao_config_simulacao = "1.0"`.
- Pesos: o web usa `morphTargetInfluences[i] ∈ [0, 1]`; **1 = implante inteiro**. Interpolação entre dois volumes vizinhos do mesmo modelo/plano/imf é permitida com pesos `w` e `1−w` (documentada na UI como "interpolado"). Somar targets de planos diferentes é proibido.
- O envelope de incerteza (±`envelope_rms_mm`) é renderizado pelo web deslocando a superfície deformada ao longo das normais (shader ou segunda malha translúcida), não é um morph target.

### 10.4 `manifest.json`

```jsonc
{
  "esquema": "morphs/1.0",
  "malha_id": "uuid", "sha256_malha_base": "...",
  "versao_software": "0.0.1", "versao_config_simulacao": "1.0", "nao_calibrado": true,
  "gerado_em": "...", "lados": "separados",
  "arquivos": [
    {
      "arquivo": "dual_plane__rebaixar.glb", "plano": "dual_plane", "imf": "rebaixar", "sha256": "...",
      "targets": [
        { "nome": "mt__motiva-ergonomix-round-300__dual_plane__rebaixar", "implante_id": "motiva-ergonomix-round-300", "lado": "ambos", "indice": 0,
          "previsto": { "delta_projecao_mamilo_mm": { "dir": 31.2, "esq": 31.2 }, "delta_y_sulco_mm": { "dir": -12.0, "esq": -12.0 }, "delta_y_mamilo_mm": { "dir": 3.1, "esq": 3.1 } } },
        { "nome": "mt__motiva-ergonomix-round-300__dual_plane__rebaixar__dir", "implante_id": "...", "lado": "dir", "indice": 1, "previsto": { ... } }
      ]
    }
  ]
}
```

`previsto` é o que os testes de monotonicidade/simetria leem, sem abrir o `.glb`. É **anulável**: com `X-Desenho: A` o serviço grava e devolve `previsto: null` em todo target (números calculados desligados; ADR 0005, revisão v0.1.1), e o web também anula o campo nas rotas em A.

Requisição `POST /morphs`:

```jsonc
{ "malha_dir": "...", "landmarks": { /* seção 2 — obrigatórios os 6 + os 4 da base */ }, "implantes": ["motiva-ergonomix-round-300", "..."], "planos": ["subglandular","dual_plane"], "imfs": ["manter","rebaixar"], "lados": "separados",
  "catalogo_arquivo": null,                      // opcional (ADR 0014): nome de UM arquivo em config/catalogo/; ausente = todos os config/catalogo/*.json válidos
  "pinca_polo_superior_mm": null }               // opcional: {"dir": 22, "esq": 22} — ajusta a transmissão pelo tecido_mole; ausente = espessura de referência
```

→ o `manifest.json`. Sem os 4 landmarks da base o Python responde 422 `landmarks_da_base_ausentes` (a base define o footprint do implante); implante fora do catálogo → 422 `implante_desconhecido`; `catalogo_arquivo` fora de `config/catalogo/` → 400/404. `/morphs` funciona em `DESENHO=A` e `B` (simulação é ilustração nos dois). Cada `.glb` declara também `asset.extras.nao_calibrado = true` e `asset.extras.modelo = "geometrico_parametrico_v1"`; os targets trazem `POSITION` (esparso, com `min`/`max`) e `NORMAL` (esparso), `mesh.weights` = zeros. Os `.glb` passam no Khronos glTF-Validator sem erros nem avisos. CLI para torsos sintéticos: `python -m mesh.cli morphs --todos --sinteticos data/sinteticos [--catalogo arq.json] [--implantes a,b]` (grava em `data/sinteticos/<nome>/morphs/`, malha base = `torso.glb`).

### 10.5 Como o web carrega

1. `GET /api/malhas/<malha_id>/morphs/manifest.json` (rota autenticada e auditada do Next.js, que lê de `DATA_DIR`).
2. Carrega o `.glb` do (plano, imf) selecionado com `GLTFLoader`; confere `asset.extras.unidade === "mm"` e `esquema === "morphs/1.0"`.
3. Seleciona targets por nome via `morphTargetDictionary`; slider antes/depois = peso 0 → 1; comparação lado a lado = dois `<Canvas>`/viewports com a mesma câmera sincronizada, cada um com seu target (ou `__dir`/`__esq` em um viewport).
4. Troca de plano/imf = troca de `.glb` (pré-carregar os 4).

---

## 11. Catálogo de implantes (`catalogo/1.1`)

Arquivos em `config/catalogo/*.json`, um por fabricante (`motiva.json`, `polytech.json`, `gc_aesthetics.json`, `exemplo.json`). Validação: zod no web (`packages/contratos/src/catalogo.ts`, paridade testada), `jsonschema` no Python, ambos contra `config/schemas/catalogo.schema.json`. `catalogo/1.1` (ADR 0015) acrescenta `base_forma` de forma aditiva: arquivos `catalogo/1.0` continuam válidos. Seed no Postgres (tabela `implantes`) a partir desses arquivos; o JSON é a fonte, o banco é cache.

```jsonc
{
  "esquema": "catalogo/1.1",                        // "catalogo/1.0" | "catalogo/1.1"
  "fabricante": "Motiva",
  "documento": { "titulo": "Motiva Implant Matrix® Catalogue ...", "url": "https://...", "ano": 2015, "data_acesso": "2026-09-26", "sha256": "<sha256 do PDF>" },
  "nota_geral": "conferir versão vigente e registro ANVISA com o fabricante",
  "implantes": [
    {
      "id": "motiva-rsd-300",                          // único no repositório inteiro; slug(fabricante)-slug(referencia_fabricante)
      "fabricante": "Motiva",
      "linha": "Motiva Implant Matrix®",
      "modelo": "SilkSurface™ PLUS Demi",
      "referencia_fabricante": "RSD-300+",             // código do fabricante; null se não houver
      "forma": "redonda",                              // perfil sagital: "redonda" | "anatomica"
      "base_forma": "circular",                        // pegada: "circular" (altura = base) | "oval" (altura ≠ base). Obrigatório em 1.1; em 1.0 ausente = inferida
      "perfil": "moderado",                            // "baixo" | "baixo_moderado" | "moderado" | "moderado_alto" | "alto" | "extra_alto" | "outro"
      "perfil_fabricante": "Demi",                     // como o fabricante chama
      "superficie": "nanotexturizada",                 // "lisa" | "microtexturizada" | "macrotexturizada" | "nanotexturizada" | "poliuretano" | "outra"
      "superficie_fabricante": "SilkSurface™ PLUS (NanoSurface™)",
      "base_mm": 115.0,                                // circular: diâmetro. oval: largura
      "altura_mm": 115.0,                              // circular: = base_mm. oval: altura (≠ base_mm)
      "projecao_mm": 39.0,
      "volume_ml": 300.0,
      "coesividade": { "nivel": null, "descricao_fabricante": "ProgressiveGel PLUS™", "escala": "fabricante" },   // nivel: inteiro 1–3 ou null
      "gel": "silicone",
      "registro_anvisa": null,                         // string "80xxxxxxxxxx" ou null
      "fonte": { "url": "https://...", "pagina": 16, "documento": "Motiva Implant Matrix® Catalogue ... ; página do PDF" },   // pagina = página física do PDF (1 = primeira), não o número impresso
      "verificado": false,                             // SEMPRE false até conferência humana
      "nota": "conferir versão vigente e registro ANVISA com o fabricante",
      "exemplo_nao_clinico": false                     // true só na seed de exemplo
    }
  ]
}
```

Regras: `verificado` DEVE ser `false` em todo item gerado por extração; `exemplo_nao_clinico: true` marca seeds inventadas (nunca exibidas sem tarja "EXEMPLO NÃO CLÍNICO"); `id` único global (teste na CI); dimensões em mm e mL mesmo que o PDF use cm/cc.

Regras semânticas (ADR 0015; `problemasDoImplante` em `packages/contratos`, testadas, não expressas no JSON Schema): `forma: "redonda"` ⇒ `base_forma: "circular"`; `circular` ⇒ `altura_mm = base_mm`; `oval` ⇒ `altura_mm ≠ base_mm`. Exemplo oval: Polytech Diagon\Gel® 4Two AO → `forma: "anatomica"`, `base_forma: "oval"`, `base_mm` = A (largura), `altura_mm` = C (altura). `perfil`/`superficie` são normalizações; o nome do fabricante fica em `perfil_fabricante`/`superficie_fabricante`.

Escolha manual (A e B, ADR 0005): `filtrarCatalogo(itens, filtro)` / `filtroDeQuery(URLSearchParams)` em `packages/contratos/src/catalogoFiltro.ts` só filtram (texto, fabricante, forma, base_forma, perfil, superficie, faixas de volume/base/altura/projeção, `exemplo_nao_clinico`) e preservam a ordem neutra por id. Query: `q`, `fabricante`, `forma`, `base_forma`, `perfil`, `superficie` (repetíveis ou separados por vírgula), `volume_min`/`volume_max`, `base_min`/`base_max`, `altura_min`/`altura_max`, `projecao_min`/`projecao_max`, `exemplo=0|1`. A sugestão (`?sugerir=1`) continua atrás da guarda: A → 403, B → 501.

---

## 12. Interfaces vazias: FEBio e surrogate

Só assinaturas e tipos; implementações lançam `NotImplementedError` / `throw new Error("nao_implementado")`. Existem para que o modelo geométrico e o surrogate futuro sejam intercambiáveis atrás do mesmo contrato.

### 12.1 Python — `services/mesh/mesh/simulacao/interfaces.py`

```python
from typing import Protocol, Literal, TypedDict
import numpy as np

Plano = Literal["subglandular", "dual_plane"]
Imf = Literal["manter", "rebaixar"]

class Implante(TypedDict):            # subconjunto do catálogo, seção 11
    id: str; forma: Literal["redonda", "anatomica"]
    base_mm: float; altura_mm: float; projecao_mm: float; volume_ml: float

class ResultadoSimulacao(TypedDict):
    deltas_mm: np.ndarray             # (n_vertices, 3) float32 — delta por vértice da malha processada
    previsto: dict                    # seção 10.4 "previsto"
    modelo: str                       # "geometrico_parametrico_v1" | "febio_v1" | "surrogate_onnx_v1"
    nao_calibrado: bool

class SimuladorDeformacao(Protocol):
    def simular(self, vertices_mm: np.ndarray, faces: np.ndarray, landmarks: dict,
                implante: Implante, plano: Plano, imf: Imf, lado: Literal["ambos", "dir", "esq"],
                config: dict) -> ResultadoSimulacao: ...

class GeradorFEBio(Protocol):         # offline, fase 6
    def gerar_feb(self, vertices_mm, faces, landmarks, implante, plano, imf, saida_dir: str) -> str: ...   # caminho do .feb
    def ler_resultado(self, caminho_log: str) -> ResultadoSimulacao: ...

class SurrogateONNX(Protocol):        # fase 6
    def exportar(self, dataset_dir: str, saida_onnx: str) -> str: ...
    def carregar(self, caminho_onnx: str) -> "SimuladorDeformacao": ...
```

### 12.2 TypeScript — `packages/contratos/src/simulacao.ts`

```ts
export type Plano = "subglandular" | "dual_plane";
export type Imf = "manter" | "rebaixar";
export type Lado = "ambos" | "dir" | "esq";
export interface FonteDeformacao {           // o viewer só conhece isto
  readonly modelo: "morph_targets_v1" | "surrogate_onnx_web_v1";
  carregar(malhaId: string, plano: Plano, imf: Imf): Promise<void>;
  aplicar(implanteId: string, lado: Lado, peso: number): void;   // peso ∈ [0,1]
  previsto(implanteId: string, lado: Lado): PrevistoMorph | null; // seção 10.4
}
// SurrogateOnnxWeb implements FonteDeformacao { throw new Error("nao_implementado") }
```

---

## 13. Flag `DESENHO` nos contratos

Fonte única: variável de ambiente **`DESENHO`** (`A` | `B`; padrão local `B`; valor inválido → falha na inicialização). Lida **só no servidor** do Next.js (`apps/web/src/config/desenho.ts`, função `getDesenho()`), repassada ao cliente por prop/rota `/api/config`. Nunca `NEXT_PUBLIC_DESENHO`. Mapa de recursos (`recursoAtivo(nome)`):

| Recurso | B | A | Como o contrato reflete |
|---|---|---|---|
| `medicao_automatica_3d` | on | off | Em A o web não calcula nem exibe `distancias`; grava `distancias: null`; `/medir` não é chamado. |
| `volume_calculado` | on | off | Em A `volumes: null`; `/medir` nunca recebe `incluir_volume: true` (o Python loga `X-Desenho`). |
| `alertas_tepid` | on | off | Em A `tepid.regras` e `tepid.tabelas` não são avaliadas; só `campos`. |
| `sugestao_implante` | on | off | Em A a UI lista o catálogo sem ordenação/recomendação; o cirurgião escolhe. |
| `numeros_calculados_no_relatorio` | on | off | Em A o template do relatório (seção 14) recebe apenas `medidas_digitadas`; `numeros_permitidos` não inclui nada calculado. |
| Landmarks por clique | on | on | Em A servem só de âncora da simulação (não geram números). |
| Simulação e envelope | on | on | Sempre "ilustração"; não é medição. |

Testes exigidos (ADR 0005): unitário do mapa; API (`DESENHO=A` → rotas de medida respondem `403 {"erro":{"codigo":"desligado_no_desenho_a"}}`); Playwright em A verificando ausência dos `data-testid`: `distancias-painel`, `volume-painel`, `tepid-alertas`, `sugestao-implante`, `relatorio-numero-calculado`.

---

## 14. Camada do LLM

### 14.1 Regras

- Entrada ao LLM: só JSON pseudonimizado (sem nome, CPF, data de nascimento, contato, fotos, malhas, texturas, caminhos de arquivo). Um filtro (`apps/web/src/llm/higienizar.ts`) remove padrões de CPF, telefone, e-mail e datas completas do texto livre antes do envio e o teste prova isso.
- `LLM_MODO=mock` ou ausência de `ANTHROPIC_API_KEY` → respostas determinísticas de `apps/web/src/llm/mocks/*.json`; a CI roda sempre em mock.
- Tool use com JSON Schema (`config/schemas/anamnese.schema.json`, `relatorio_prosa.schema.json`). O modelo é obrigado a chamar a ferramenta (`tool_choice`).

### 14.2 `anamnese/1.0` (saída da ferramenta `registrar_anamnese`)

```jsonc
{
  "esquema": "anamnese/1.0",
  "queixa_principal": "string",
  "objetivo_estetico": "aumento_discreto" | "aumento_moderado" | "aumento_marcado" | "correcao_assimetria" | "outro",
  "tamanho_desejado_descricao": "string | null",
  "gestacoes": { "numero": 0, "amamentou": false, "planeja": "sim" | "nao" | "incerto" },
  "cirurgias_mamarias_previas": ["string"],
  "comorbidades_relatadas": ["string"],
  "tabagismo": "nunca" | "ex" | "atual" | "nao_informado",
  "medicamentos": ["string"],
  "alergias": ["string"],
  "expectativas_irreais_sinalizadas": false,
  "campos_nao_informados": ["string"],
  "texto_fonte_hash": "sha256 do texto higienizado"
}
```

### 14.3 `relatorio/1.0` (relatório para a paciente)

O web monta `dados_travados` (números e rótulos vindos do banco), renderiza as **seções numéricas por template** (Handlebars/JSX, nunca LLM) e pede ao LLM apenas os **parágrafos de prosa**:

```jsonc
// entrada da ferramenta redigir_prosa_relatorio
{ "esquema": "relatorio_entrada/1.0", "desenho": "B", "pseudonimo": "P-7K2M9Q",
  "dados_travados": { "implantes_mostrados": [{ "id": "...", "rotulo": "Motiva Ergonomix Round 300 mL", "plano": "dual_plane", "imf": "rebaixar" }],
                      "medidas_digitadas": { ... }, "distancias": { ... } | null, "volumes": { ... } | null },
  "numeros_permitidos": ["300", "4,5", "116"],       // únicas sequências de dígitos que a prosa pode conter
  "avisos_obrigatorios": ["Ilustração, não previsão de resultado"] }
// saída
{ "esquema": "relatorio_prosa/1.0", "paragrafos": { "introducao": "...", "o_que_foi_simulado": "...", "limitacoes": "...", "proximos_passos": "..." } }
```

**Teste travado**: toda sequência de dígitos (regex `\d+([.,]\d+)?`) em qualquer parágrafo DEVE pertencer a `numeros_permitidos`; caso contrário o teste falha e a UI descarta a prosa e mostra o mock. Em `DESENHO=A`, `distancias` e `volumes` são `null` e `numeros_permitidos` contém só valores digitados e do catálogo.

---

## 15. Registro de validação — `docs/validacao/`

Um arquivo por versão: `docs/validacao/v<versao>.md` com front matter YAML + tabelas, **e** o sidecar `docs/validacao/v<versao>.json` (`validacao/1.0`). Os dois são gerados por comando, com a árvore limpa: `bash scripts/validacao.sh` captura o commit (`git describe --always --dirty`), gera os registros de componente (`v<versao>-services-mesh.*` pelo `mesh.validacao`; `v<versao>-web-marcos-0-1.*`, cujo Bland-Altman do Marco 1 vem de `POST /validar-bland-altman`, e `v<versao>-web-marco2-latencia.*` pelos e2e) e chama `scripts/registro_validacao.py`, que consolida `v<versao>.{md,json}` a partir dessas saídas e das de pytest, Vitest e Playwright (nada digitado à mão; ADR 0016). `scripts/ci.sh` não gera o registro: confere que `v<VERSION>.md` existe e, por `scripts/validar_config.py`, valida `v*.json` contra `validacao/1.0` e exige `versao_software` igual a `VERSION`. O `.md` é o documento humano; o `.json` é o que a fase 3 agrega.

```yaml
---
esquema: validacao/1.0
versao_software: 0.0.1
data: 2026-09-26
commit: <sha>
desenho_testado: [A, B]
ambiente: { os: linux, node: "22.22", python: "3.11", navegador: "chromium <ver>" }
parametros: { torsos: [t01_simetrico_300, t02_assimetrico, t03_pequeno_ptose], decimacao_alvo_vertices: 40000, geodesica: mmp, config_tepid: "1.0", config_simulacao: "1.0" }
resultados:
  marco0_erro_max_gabarito_mm: null      # ±1 mm
  marco1_bland_altman: { n: null, vies_mm: null, dp_mm: null, loa_mm: [null, null], criterio_2mm: null }
  marco2_latencia_p95_ms: null           # < 100
  marco2_monotonicidade: null
  marco2_simetria_max_mm: null           # < 0,1
  testes: { web_unit: null, web_e2e: null, python: null }
status: sem_testes | reprovado | aprovado
---
```

Corpo: "O que mudou", "Como reproduzir" (comandos), "Desvios e pendências". Campos opcionais aditivos em `resultados` (v0.1.0, sem mudar a versão do esquema): `marco1_n_imf`, `marco0_escala`, `volume`, `marco2_latencia`, `marco2_imf`, `marco2_regressao`, `marco2b_e2e` e `testes.contratos`. Registros de componente (`v<versao>-<componente>.md/.json`) têm esquema próprio (`validacao_componente/...`) e não são validados contra `validacao/1.0`. A versão é a do arquivo `VERSION`; toda mudança em `VERSION` exige novo registro (checado pela CI).

---

## 16. Versão do software

Arquivo `VERSION` na raiz (SemVer, ex. `0.0.1`). O web o lê em build (`process.env.APP_VERSION` injetado por `next.config`), o Python via `mesh.versao` (lê o arquivo). Toda saída (JSONs, PDF, tabelas) leva `versao_software` com esse valor. O commit SHA vai em `commit` onde houver.

---

## 17. Banco de dados — DDL canônico (Postgres 16)

Migrations SQL em `apps/web/db/migrations/NNNN_<nome>.sql`, aplicadas por `pnpm --filter web db:migrate` (runner simples com `pg`, MIT). ORM é livre (Drizzle, MIT, recomendado), mas o DDL abaixo é o contrato. Nenhuma tabela guarda nome, documento, contato ou nascimento.

```sql
create extension if not exists pgcrypto;

create table pacientes (
  id           uuid primary key default gen_random_uuid(),
  pseudonimo   text not null unique check (pseudonimo ~ '^P-[0-9A-HJ-NP-Z]{6}$'),
  criado_em    timestamptz not null default now()
);

create table malhas (
  id                     uuid primary key default gen_random_uuid(),
  paciente_id            uuid not null references pacientes(id),
  malha_dir              text not null,                 -- relativo a DATA_DIR
  formato_origem         text not null check (formato_origem in ('obj','ply')),
  unidade_origem         text not null check (unidade_origem in ('m','cm','mm','desconhecida')),
  fator_escala_acumulado double precision not null default 1.0,
  n_vertices_original    integer,
  n_vertices_processada  integer,
  sha256_original        text,
  sha256_glb             text,
  meta                   jsonb not null,                -- malha_meta/1.0
  sintetica              boolean not null default false,
  criado_em              timestamptz not null default now()
);

create table medidas (
  id               uuid primary key default gen_random_uuid(),
  malha_id         uuid not null references malhas(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_software  text not null,
  esquema          text not null default 'medidas/1.0',
  payload          jsonb not null,                      -- medidas/1.0 completo
  criado_por       text not null default 'local',
  criado_em        timestamptz not null default now()
);

create table tepid (
  id               uuid primary key default gen_random_uuid(),
  paciente_id      uuid not null references pacientes(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_config    text not null,                       -- tepid.versao
  valores          jsonb not null,                      -- medidas_digitadas da seção 6
  alertas          jsonb not null default '[]',         -- sempre [] em A
  criado_em        timestamptz not null default now()
);

create table implantes (                                -- cache de config/catalogo/*.json
  id               text primary key,
  fabricante       text not null,
  payload          jsonb not null,                      -- item catalogo/1.0
  verificado       boolean not null default false,
  exemplo_nao_clinico boolean not null default false,
  carregado_em     timestamptz not null default now()
);

create table simulacoes (
  id               uuid primary key default gen_random_uuid(),
  malha_id         uuid not null references malhas(id),
  implante_id      text not null references implantes(id),
  plano            text not null check (plano in ('subglandular','dual_plane')),
  imf              text not null check (imf in ('manter','rebaixar')),
  lado             text not null check (lado in ('ambos','dir','esq')),
  versao_config_simulacao text not null,
  nao_calibrado    boolean not null default true,
  previsto         jsonb,                               -- seção 10.4
  mostrada_em      timestamptz not null default now()   -- cada exibição à paciente é uma linha
);

create table atendimentos (
  id               uuid primary key default gen_random_uuid(),
  paciente_id      uuid not null references pacientes(id),
  desenho          char(1) not null check (desenho in ('A','B')),
  versao_software  text not null,
  anamnese         jsonb,                               -- anamnese/1.0
  relatorio_prosa  jsonb,                               -- relatorio_prosa/1.0
  pdf_caminho      text,                                -- relativo a DATA_DIR
  pdf_sha256       text,
  iniciado_em      timestamptz not null default now(),
  encerrado_em     timestamptz
);

create table auditoria (
  id           bigserial primary key,
  ocorrido_em  timestamptz not null default now(),
  usuario_id   text not null,                           -- 'local' nesta fase
  acao         text not null,                           -- 'visualizou','criou','alterou','exportou','apagou','simulou'
  entidade     text not null,                           -- nome da tabela ou 'arquivo'
  entidade_id  text not null,
  desenho      char(1) not null check (desenho in ('A','B')),
  detalhes     jsonb not null default '{}'              -- NUNCA dado pessoal, nunca caminho absoluto
);
create index auditoria_entidade_idx on auditoria (entidade, entidade_id, ocorrido_em);
```

Toda leitura de malha, medida, simulação, relatório ou PDF por rota do Next.js insere uma linha em `auditoria`. Logs de aplicação (stdout, Sentry no futuro) só contêm IDs e pseudônimos, nunca `detalhes` de anamnese.

---

## 18. Validação humana: sessão de Bland-Altman e planilha do art. 5º (ADR 0017)

Só no desenho B (recurso `medicao_automatica_3d`); em A toda rota abaixo responde `403 desligado_no_desenho_a` antes de tocar banco, disco ou rede. Mutações seguem o §7 do proxy (JSON, Origin, token local). Tudo em `DATA_DIR/validacao/` (§5.4), nunca em `pacientes/`.

| Rota | Faz | Cliente recebe |
|---|---|---|
| `POST /api/validacao/sessoes` | `{ operador, tipo_operador?: "humano"\|"simulado", repeticoes?: 2..5, torsos?: [nome], semente? }`. Abre a sessão com os torsos sintéticos que têm gabarito | vista pública (201) |
| `GET /api/validacao/sessoes[/<id>]` | lista ou lê | vista pública |
| `GET /api/validacao/sessoes/<id>/itens/<i>/malha` | GLB processado do scan do item (sessão aberta) | `model/gltf-binary` |
| `POST /api/validacao/sessoes/<id>/itens/<i>` | `{ landmarks }` com os 10 landmarks, `origem: "clique"`; só o próximo item pendente; uma vez por item (409 `fora_de_ordem` / `item_ja_registrado`; 422 `landmarks_incompletos` / `origem_invalida`) | vista pública |
| `POST /api/validacao/sessoes/<id>/encerrar` | `{ observacoes? }` (≤ 500, sem `@`); exige todos os itens (409 `sessao_incompleta`) | vista pública com `scans` e `resultado` |
| `POST /api/validacao/sessoes/<id>/cancelar` | abandona sem resultado | vista pública |
| `GET /api/validacao/planilha?formato=csv\|json[&separador=virgula\|ponto-e-virgula]` | planilha art. 5º; audita `exportou` | CSV (anexo) ou JSON |

**Vista pública** (sessão aberta ou cancelada): `id`, `estado`, `operador` (código pseudônimo `^[A-Z0-9][A-Z0-9-]{1,15}$`), `tipo_operador`, `repeticoes`, `versao_software`, datas, `landmarks_exigidos`, `itens[] { indice, scan_id, repeticao, concluido }` e `proximo_indice`. **Nunca** traz nome do torso, gabarito, landmarks gravados ou distâncias. Com sessão aberta sobre um torso:
- `GET /api/sinteticos/<nome>/gabarito.json` → `403 gabarito_oculto_sessao_aberta`;
- `POST /api/sinteticos/<nome>/importar` devolve `gabarito: null` e `gabarito_bloqueado: true`;
- sessões encerradas com esse torso saem sem `scans` nem `resultado` (`resultado_oculto: "sessao_aberta_com_mesmo_torso"`) na lista, no GET e no encerramento;
- `POST /api/benchmark` e `GET /api/benchmark/arquivo` → `409 benchmark_indisponivel_sessao_aberta` (se o torso for o do benchmark).

Com **qualquer** sessão aberta, a planilha → `409 planilha_indisponivel_sessao_aberta`. Arquivo de sessão inválido → fail closed: tudo bloqueado até correção ou remoção manual (ADR 0017).

**`sessao_bland_altman/1.0`** (arquivo `validacao/sessoes/<id>.json`, só no servidor): campos da vista + `desenho`, `semente`, `scans[] { scan_id, torso, sha256_gabarito, sha256_obj }`, `itens[] { ..., registrado_em, landmarks, distancias (§3.1, do /medir), avisos }`, `observacoes`, `resultado`.

**`resultado`**: `pares[] { medida: "<distancia>:<tipo>", distancia, tipo, referencia_mm, medido_mm, desvio_mm, scan_id, torso, repeticao }`, Bland-Altman `geral`, `n_imf` (à parte), `sem_n_imf`, `euclidiana`, `geodesica` (cada um: `n`, `vies_mm`, `dp_mm`, `loa_inferior_mm`, `loa_superior_mm`, `erro_abs_max_mm`, `dentro_de_2mm`, `dentro_de_3mm`, `por_medida`; fórmula do §7.7), `intra_operador { n_grupos, dp_intra_mm, coeficiente_repetibilidade_mm, bland_altman_rep2_rep1 }`, `notas` (pseudo-replicação; pares ≠ sujeitos) e `criterios { n_pares, n_pares_min_30, loa_dentro_3mm, loa_dentro_2mm, n_imf_relatado_a_parte, scans_distintos, vale_para_fase1 (false com torso sintético), motivo_fase1 }`.

**Planilha `planilha_validacao_art5/1.0`**: uma linha por par. As fontes são `docs/validacao/v<versao>-web-marcos-0-1.json` (`fonte = registro_e2e`, operador simulado) e as sessões encerradas (`fonte = sessao_bland_altman`). Colunas, nesta ordem: `versao_software, data, fonte, registro, commit, desenho, operador, tipo_operador, scan_id, sintetico, repeticao, medida, tipo_distancia, n_imf, referencia_mm, medido_mm, desvio_mm, observacoes`. `scan_id = sintetico:<nome>`. `desvio_mm = medido − referência`. CSV em RFC 4180, UTF-8 com BOM e CRLF; células de texto iniciadas por `= + - @` ganham `'`. O JSON acrescenta `resumo[]` por registro ou sessão (geral, N-IMF, sem N-IMF) e `notas`. Nenhuma linha tem nome, pseudônimo de paciente, caminho absoluto ou e-mail.
