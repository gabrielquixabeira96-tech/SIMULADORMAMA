# ADR 0011 — Geodésica e volume calculados só no `services/mesh`

Status: aceito · Data: 2026-09-26

## Contexto

Marco 0 exige erro ≤ ±1 mm contra o gabarito e Marco 1 LoA de Bland-Altman dentro de ±2 mm. `ESTRATEGIA.md` atribui a antropometria a "three.js raycast; Python". Uma geodésica por Dijkstra sobre arestas (o que é simples de fazer em JS) superestima o caminho em até ~8 % numa malha de 30–50 mil vértices — 10–15 mm num SSN-N de 200 mm, o que sozinho estoura o critério. Ter dois cálculos independentes (JS e Python) para a mesma grandeza criaria duas "verdades".

## Decisão

1. **Euclidianas**: calculadas pelo web (fórmula fechada) e **conferidas** pelo Python em `/medir` (divergência > 0,01 mm = erro 422). Não há ambiguidade possível.
2. **Geodésicas, volume e quadro anatômico**: calculados **exclusivamente** pelo `services/mesh` (`POST /medir`), com algoritmo de referência **MMP exato** (`pygeodesic`, MIT) — ou método do calor (`potpourri3d`, MIT) se validado < 0,5 mm contra MMP nos sintéticos. O gabarito dos torsos sintéticos usa o mesmo algoritmo na malha densa.
3. O web **pode** exibir uma prévia por Dijkstra rotulada "aproximada" enquanto aguarda `/medir`, mas nunca grava esse valor.
4. **Volume**: estimador único `plano_base_elipse` (`contratos.md` §3.2), sempre com incerteza relativa configurável (`simulacao.incerteza.volume_relativa_fator`). O gabarito informa o volume real adicionado, então o erro do estimador é medido e vai ao registro de validação.
5. `services/mesh` é, portanto, o **oráculo de antropometria**: os testes de regressão de medida vivem nele; o web testa apenas a integração (chama, grava, exibe, respeita A/B).

## Alternativas

- Geodésica em JS/WASM (ex.: port do MMP ou heat method em WebAssembly): viável, mas duplicaria o algoritmo e a validação; ganho só de latência (a chamada local leva < 1 s). Rejeitada nesta fase.
- Aceitar Dijkstra como valor registrado com correção empírica: introduz um fator não calibrado numa medida que deveria ser determinística. Rejeitada.

## Consequências

- O viewer depende do `services/mesh` para fechar uma medida; sem o serviço, a UI mostra "aguardando serviço de malha" e não grava.
- Um único lugar para otimizar/validar antropometria; a fase avançada (landmarks automáticos) entra no mesmo serviço.
