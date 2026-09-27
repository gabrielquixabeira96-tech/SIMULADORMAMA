# ADR 0013 — Heurística de unidade por escala logarítmica

Status: aceito · Data: 2026-09-26 · Altera: `contratos.md` §7.2 (`unidade_origem = "desconhecida"`)

## Contexto

A regra antiga (maior dimensão da caixa < 5 → m; < 500 → cm; senão mm) classificava como **cm** um torso recortado em **mm** com menos de 500 mm (ex.: 475 mm), inflando a malha 10×. Torsos recortados têm tipicamente 250–700 mm.

## Decisão

Escolher a unidade (m, cm, mm) cuja conversão deixa a maior dimensão mais perto, em escala logarítmica, de **500 mm**. Equivale aos limiares nas médias geométricas: `< 5` → m; `< 158,1` (= 500/√10) → cm; senão mm. Se a dimensão convertida ficar fora de **[150, 2500] mm**, o `/processar` avisa `unidade_inferida_duvidosa:calibrar_pela_regua`. A régua (ADR 0003) continua sendo a única escala válida.

## Alternativas

- Só baixar o limiar para 100: arbitrário, sem simetria entre as unidades.
- Usar o comprimento médio de aresta: depende da resolução do scanner, não do tamanho do corpo.

## Consequências

- Corpo inteiro em cm com mais de 158 cm seria lido como mm e avisado como duvidoso; não é caso de uso (o recorte é o tórax e o 3D Scanner App exporta metros).
- Teste: tubos de 250, 475, 625 e 1400 mm em m, cm e mm são todos classificados corretamente.
