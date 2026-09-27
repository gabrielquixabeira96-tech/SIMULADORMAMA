# Registros de validação (art. 5º da RDC 657/2022)

Cada versão do software (arquivo `VERSION`) tem **um registro** aqui, criado antes do primeiro commit daquela versão e atualizado quando os testes de acurácia rodam:

- `v<versao>.md` — documento humano: front matter YAML + "O que mudou", "Como reproduzir", "Desvios e pendências".
- `v<versao>.json` — sidecar de máquina no esquema `validacao/1.0` (`config/schemas/validacao.schema.json`), gerado/atualizado por `bash scripts/validacao.sh` (via `scripts/registro_validacao.py`), não pela CI; a CI (`scripts/ci.sh`) só confere que ele existe e valida contra o schema.

Formato detalhado em `docs/contratos.md` §15. A CI (`scripts/ci.sh`) falha se faltar o registro da versão corrente ou se `versao_software` do JSON divergir de `VERSION`.

Conteúdo mínimo de cada registro: versão, data, commit (`git describe --always --dirty` do código validado, capturado antes de gerar os artefatos; `arvore_suja: true` reprova o registro), desenhos testados (A/B), ambiente, parâmetros (torsos, decimação, geodésica, versões das configs TEPID e simulação) e resultados dos critérios dos marcos (erro máximo contra o gabarito, Bland-Altman, latência, monotonicidade, simetria, contagem de testes). Registros nunca são apagados; guarda mínima de 10 anos após descarte do software (RDC 657) — o repositório git é o meio de guarda nesta fase.

Registros de componente (`v<versao>-<componente>.md/.json`, esquema `validacao_componente/...`) trazem o detalhe de cada parte e são gerados pelos próprios testes; o consolidado `v<versao>.md/.json` (`validacao/1.0`) é gerado por `bash scripts/validacao.sh` → `scripts/registro_validacao.py` a partir das saídas dos testes (nada digitado à mão). `scripts/validar_config.py` valida só os consolidados contra `config/schemas/validacao.schema.json`.

Textos versionados por versão, escritos à mão e lidos pelo gerador: `mudancas-v<versao>.md` ("O que mudou") e `pendencias-v<versao>.md` ("Desvios e pendências"; o gerador acrescenta as pendências que dependem de números medidos, como latência p95 ≥ 100 ms por interação e o resultado do glTF-Validator). Os `.glb` são conferidos por comando com o Khronos glTF-Validator (`node scripts/validar_gltf.mjs <arquivos>`, chamado pelo `scripts/validacao.sh`; resultado em `gltf_validator` do `v<versao>-services-mesh.json`).

**Planilha do art. 5º** (versão, data, scan, medidas, referência, desvios, operador; ADR 0017): gerada sob demanda, no desenho B, por `GET /api/validacao/planilha?formato=csv` (ou `json`, com resumo de Bland-Altman por grupo e N-IMF à parte), a partir dos `v<versao>-web-marcos-0-1.json` deste diretório e das sessões de Bland-Altman encerradas em `DATA_DIR/validacao/sessoes/` (ferramenta `/validacao/bland-altman`: operador por código pseudônimo, cego ao gabarito, com repetição). A sessão com cirurgião (≥ 30 pares em ≥ 5 voluntárias ou manequim, LoA ±3 mm) é tarefa humana pendente; com torsos sintéticos a planilha marca `vale_para_fase1 = false`.

A tabela abaixo é mantida por `scripts/registro_validacao.py`: a cada geração ele insere ou substitui (idempotente) a linha da versão corrente, em ordem decrescente; linhas de outras versões (e suas erratas) não são tocadas.

| Versão | Data | Status | Registro consolidado | Registros de componente |
|---|---|---|---|---|
| 0.1.1 | 2026-09-26 | aprovado (9/9 critérios) | [v0.1.1.md](v0.1.1.md) · [json](v0.1.1.json) | [services-mesh](v0.1.1-services-mesh.md) ([json](v0.1.1-services-mesh.json)) · [web-marcos-0-1](v0.1.1-web-marcos-0-1.md) ([json](v0.1.1-web-marcos-0-1.json)) · [web-marco2-latencia](v0.1.1-web-marco2-latencia.md) ([json](v0.1.1-web-marco2-latencia.json)) |
| 0.1.0 | 2026-09-26 | aprovado (Marcos 0, 1, 2 e 2b; operador do M1 simulado; latência em SwiftShader). **Errata (v0.1.1):** o registro cita o commit `5292a27` (véspera do release), não o do código liberado (`18227b1`), e não marcava árvore suja; corrigido no gerador a partir da v0.1.1 (`git describe --always --dirty`) | [v0.1.0.md](v0.1.0.md) · [json](v0.1.0.json) | [services-mesh](v0.1.0-services-mesh.md) ([json](v0.1.0-services-mesh.json)) · [web-marcos-0-1](v0.1.0-web-marcos-0-1.md) ([json](v0.1.0-web-marcos-0-1.json)) · [web-marco2-latencia](v0.1.0-web-marco2-latencia.md) ([json](v0.1.0-web-marco2-latencia.json)) |
| 0.0.1 | 2026-09-26 | sem_testes (fundação: ADRs, contratos, esqueleto); registros de componente gerados durante o desenvolvimento dos marcos | [v0.0.1.md](v0.0.1.md) · [json](v0.0.1.json) | [services-mesh](v0.0.1-services-mesh.md) · [web-marcos-0-1](v0.0.1-web-marcos-0-1.md) ([json](v0.0.1-web-marcos-0-1.json)) · [web-marco2-latencia](v0.0.1-web-marco2-latencia.md) ([json](v0.0.1-web-marco2-latencia.json)) |
