# ADR 0014 — Modelo geométrico-paramétrico v1 e morph targets

Status: aceito · Data: 2026-09-26 · Altera: `contratos.md` §9 (bloco `modelo_geometrico`, config 1.1) e §10.4 (campos opcionais do `POST /morphs`)

## Contexto

Marco 2 (`PROMPT.md`): forma do implante a partir de base, projeção e volume; posição na parede; deslocamento do tecido mole; coeficientes por plano; rebaixamento do sulco; morph targets pré-computados em glTF. Coeficientes em config, marcados `nao_calibrado`. FEBio e surrogate só como interfaces.

## Decisão

1. **Forma**: pegada elíptica `base × altura`; altura `P·(1 − ρ^k)^γ`, com `γ = borda_implante_expoente` (0,5 = borda elipsoidal, o "elipsoide truncado") e `k` resolvido em forma fechada (`média = (2/k)·B(2/k, γ+1)`) para que o volume da forma seja o `volume_ml` do catálogo. Anatômico: ápice a `ponto_max_projecao_fator` (0,62) da altura, de cima para baixo.
2. **Posição**: pegada centrada no ponto médio da base (medial–lateral), borda inferior no sulco (novo, se rebaixado), no quadro da base do ADR 0012.
3. **Tecido mole**: pele recebe o campo do implante com pegada alargada (`alargamento_base_fator`), volume transmitido `V × transmissao_projecao_fator × fator_de_tecido` (pinçamento opcional), polo superior atenuado (`preenchimento_polo_superior_fator`), suavização gaussiana (`suavizacao_sigma_mm`). Abaixo do sulco a pele não é empurrada (rampa `imf_transicao_mm`), preservando a prega. Direção: anterior da base sem componente cranial.
4. **Mamilo**: ajuste por núcleo compacto (σ = `mamilo_sigma_fator × base`) até o deslocamento anterior `deslocamento_mamilo_anterior_fator × P_efetiva` e cranial `deslocamento_mamilo_cranial_fator × P_efetiva`.
5. **Sulco** (`rebaixar`): translação caudal de `min(mm_por_100ml·V/100, maximo_mm)` no sulco, decaindo por núcleos compactos (lateral, cranial, caudal, profundidade).
6. Núcleos locais têm **suporte compacto** (`(1 − r²/R²)³`, R = 3σ) e a pele "da frente" é selecionada por normal e profundidade: costas e lado oposto ficam intactos (cauda do campo suavizado < 0,02 mm).
7. Novos coeficientes no bloco opcional `modelo_geometrico` de `config/simulacao.json` (versão 1.1), todos `nao_calibrado: true`; esquema `simulacao_config` estendido de forma aditiva.
8. **Morphs**: um `.glb` por (plano, imf), base = malha processada (mesma ordem de vértices e textura), um target por (implante, lado ∈ ambos/dir/esq), `POSITION` e `NORMAL` esparsos (|Δ| > 0,01 mm; `POSITION` com `min`/`max`), `mesh.extras.targetNames`, `asset.extras` com `unidade`, `quadro`, `esquema`, `versao_config_simulacao`, `nao_calibrado`, `modelo`. `POST /morphs` ganha os campos opcionais `catalogo_arquivo` (um arquivo de `config/catalogo/`) e `pinca_polo_superior_mm`.
9. Interfaces §12.1 em `services/mesh/mesh/simulacao/interfaces.py`; `GeradorFEBioStub` e `SurrogateONNXStub` levantam `NotImplementedError`.

## Propriedades testadas

Monotonicidade (volume maior no mesmo perfil/plano/IMF → mamilo mais projetado, no `previsto` e na malha), simetria (campo equivariante ao espelhamento em X; landmarks homólogos do t01 espelhados a < 0,1 mm), `manter` não move o sulco (0 mm), `rebaixar` move exatamente o configurado (±0,05 mm), todas as combinações geradas, snapshot de regressão do `previsto`.

## Alternativas

- Deslocar ao longo da normal de cada vértice: mais "natural" nas bordas, mas quebra a exatidão do rebaixamento e a equivariância com normais ruidosas. Rejeitado.
- Morph targets densos: 3–4× maiores. Rejeitado (contrato já pede esparsos).

## Consequências

Tudo é ilustração não calibrada; a fase 4 calibra os coeficientes com pares pré/pós. O web deve tratar `asset.extras.nao_calibrado` como informativo (sem mudança de campo obrigatório).

## Revisão v0.1.1 (2026-09-26) — nenhum coeficiente no código

Três constantes do modelo estavam fixas em `geometrico.py` (`PROF_SIGMA_MM = 40`, `FRENTE_PROF_MM = (-60, 30)` e o divisor `0,3` da rampa da normal) e `PADROES_MODELO` servia de fallback silencioso quando a config não trazia `modelo_geometrico`. Agora `config/simulacao.json` (versão **1.2**) traz `modelo_geometrico.profundidade_sigma_mm`, `frente_profundidade_min_mm`, `frente_profundidade_rampa_mm` e `frente_normal_rampa`, todos `nao_calibrado`, com os mesmos valores (o snapshot de regressão não muda); `modelo_geometrico` passou a ser obrigatório no schema e o `services/mesh` não tem mais valor padrão: qualquer chave ausente → `ErroSimulacao("config_simulacao_incompleta:<caminho>")`. Os limites do solver numérico do expoente do perfil (`k ∈ [0,3; 200]`) não são coeficientes do modelo e ficam no código.
