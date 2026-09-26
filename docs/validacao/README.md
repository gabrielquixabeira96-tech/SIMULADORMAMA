# Registros de validação (art. 5º da RDC 657/2022)

Cada versão do software (arquivo `VERSION`) tem **um registro** aqui, criado antes do primeiro commit daquela versão e atualizado quando os testes de acurácia rodam:

- `v<versao>.md` — documento humano: front matter YAML + "O que mudou", "Como reproduzir", "Desvios e pendências".
- `v<versao>.json` — sidecar de máquina no esquema `validacao/1.0` (`config/schemas/validacao.schema.json`), gerado/atualizado pela CI.

Formato detalhado em `docs/contratos.md` §15. A CI (`scripts/ci.sh`) falha se faltar o registro da versão corrente ou se `versao_software` do JSON divergir de `VERSION`.

Conteúdo mínimo de cada registro: versão, data, commit, desenhos testados (A/B), ambiente, parâmetros (torsos, decimação, geodésica, versões das configs TEPID e simulação) e resultados dos critérios dos marcos (erro máximo contra o gabarito, Bland-Altman, latência, monotonicidade, simetria, contagem de testes). Registros nunca são apagados; guarda mínima de 10 anos após descarte do software (RDC 657) — o repositório git é o meio de guarda nesta fase.

| Versão | Data | Status |
|---|---|---|
| [0.0.1](v0.0.1.md) | 2026-09-26 | sem_testes (fundação: ADRs, contratos, esqueleto) |
