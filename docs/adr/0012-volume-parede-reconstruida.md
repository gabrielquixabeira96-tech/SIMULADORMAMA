# ADR 0012 — Estimador de volume v2: parede torácica reconstruída

Status: aceito · Data: 2026-09-26 · Altera: `contratos.md` §3.2 e §3.3 (sem mudar campos JSON)

## Contexto

O estimador `plano_base_elipse` v1 (§3.2) media a altura da pele sobre o plano que passa pela base medial, base lateral e sulco. Numa parede torácica curva, esse plano corta o tórax: a "lente" de parede anterior ao plano (85–137 mL nos torsos sintéticos) era contada como mama. Erro nos 3 presets: +35 a +45 %; o volume real ficava fora da faixa de ±15 %.

## Decisão

1. Mantém-se o quadro (plano pela base, elipse `a = base/2`, `b = |(sulco − centro)·e2|`), mas a altura de referência passa a ser a **parede reconstruída**: polinômio cúbico em `(x/a, y/b)` ajustado às alturas da pele frontal no **anel periférico** `1,05 ≤ r ≤ 1,30` (fora da mama), com rejeição robusta iterativa (resíduo > +2,5 DP ou < −4 DP, DP pela MAD) para descartar tecido mamário que vaze para o anel e dobras.
2. Volume = soma sobre as faces frontais em `r ≤ 1,05` de área projetada × média de `max(h − h_parede, 0)`.
3. Com menos de 30 pontos no anel, volta ao plano (v1) e avisa `volume_X:anel_insuficiente_parede_plana`.
4. **O id `plano_base_elipse` é mantido** no campo `metodo`, porque o web (`packages/contratos`, `volumeSchema`) o valida como literal. Nenhum campo JSON mudou; o comportamento mudou.
5. Critério nos sintéticos (§3.3): erro ≤ ±10 % e faixa `±volume_relativa_fator` (0,15) contendo o valor real. Resultado v0.0.1: −3,1 a −4,6 % (decimada), em todos os cenários do registro de validação.

## Alternativas

- Interpolação harmônica (Laplace) do contorno: não reproduz a curvatura da parede (achata), deixa parte da lente. Rejeitada.
- Polinômio quadrático: erro −5 a −17 % (curvatura da superelipse não é quadrática). Quártico: instável na extrapolação (+3 a +19 % conforme o anel). Cúbico foi o mais estável (−3 a −12 % em todos os anéis testados).
- Renomear o método (`parede_reconstruida_elipse`): mais honesto, mas quebraria o zod do web. Fica como sugestão para a versão 2.0 do contrato.

## Consequências

- `volume_plano_base_elipse(..., parede="plano")` preserva o v1 para comparação (teste documenta a superestimação).
- Em scans reais, braço ou axila no anel lateral são tratados pela rejeição robusta; o erro ainda precisa ser medido com dados reais (fase 3).
