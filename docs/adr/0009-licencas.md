# ADR 0009 — Licenças permitidas e proibidas

Status: aceito · Data: 2026-09-26

## Contexto

`PROMPT.md` restrição 7 e `ESTRATEGIA.md` ("Stack técnica"): produto comercial futuro; vários modelos e assets de corpo humano têm licença não comercial. Exige-se `THIRD_PARTY_LICENSES.md`.

## Decisão

1. **Permitidas** para dependências de runtime e build: MIT, BSD-2/3, Apache-2.0, ISC, 0BSD, Zlib, PostgreSQL, Python-2.0, MPL-2.0 (só em arquivo separado, sem modificação), CC0/CC-BY-4.0 para assets (com atribuição). Unlicense aceita.
2. **Proibidas em qualquer forma** (código, pesos, topologia, assets derivados), por serem não comerciais ou de licença restritiva: RBSM, iRBSM, liRBSM; SMPL, SMPL-X e qualquer topologia derivada (inclusive a de Anny em modo SMPL-X); Depth Anything 2 Base/Large; Depth Anything 3 Giant/Large/Nested; FLUX dev; VGGT original; SAM 3D Body ("SAM License"). Também proibidas: GPL-2/3, AGPL, LGPL ligada estaticamente, SSPL, BUSL, CC-BY-NC/ND, "research only". Casos concretos já identificados: **`pymeshlab` (GPL-3)** — usar Open3D (MIT) ou `fast-simplification` (MIT) para decimação; **`libigl` Python** (MPL-2.0 com partes GPL) — evitar; **`geodesic` via `gdist`** (LGPL, extensão compilada) — usar `pygeodesic` (MIT) ou `potpourri3d` (MIT).
3. **Seguras para a fase avançada** (não usar agora): Depth Anything 3 Small/Base (Apache-2.0), Anny (código Apache-2.0, assets CC0, sem topologia SMPL-X), Spark (MIT), FEBio (MIT), ONNX Runtime (MIT).
4. **Processo**: `THIRD_PARTY_LICENSES.md` é gerado por `scripts/licencas.sh` (`pnpm licenses list --json` + `pip-licenses --format=markdown`, ambos MIT) e revisado a cada marco; a CI falha se aparecer licença fora da lista permitida ou nome de pacote da lista proibida (`grep` em `pnpm-lock.yaml`, `requirements*.txt`/`pyproject.toml`).
5. Fontes, ícones e texturas: só CC0/OFL/MIT; a textura do torso sintético é procedural (gerada por código).

## Alternativas

- Permitir GPL em ferramentas de desenvolvimento (não distribuídas): tecnicamente possível, mas confunde o inventário; proibido por simplicidade.
- Adiar o inventário para a fase 5: risco de descobrir dependência inviável tarde. Rejeitado; inventário desde o Marco 0.

## Consequências

- Alguns algoritmos ficam mais trabalhosos (decimação sem MeshLab); aceito.
- Qualquer modelo de corpo/forma no futuro passa por checagem de licença antes de download.

## Revisão v0.1.1 (2026-09-26) — bibliotecas de runtime do compilador e checagem por nome

1. **Bibliotecas de runtime do compilador embutidas nas wheels.** As wheels oficiais de `numpy` e `scipy` (em `numpy.libs/`, `scipy.libs/`) trazem **libgfortran** (GPL-3.0-or-later com **GCC Runtime Library Exception 3.1**) e **libquadmath** (LGPL-2.1-or-later); a de `fast-simplification` traz **libgomp** (GPL-3.0-or-later com a mesma exceção). Decisão: **aceitas**, como exceção documentada ao item 2 ("GPL/LGPL proibidas"), porque (a) a GCC Runtime Library Exception autoriza expressamente distribuir o programa que usa essas bibliotecas sob qualquer licença — é o que permite software proprietário compilado com GCC; (b) libquadmath é LGPL carregada **dinamicamente** como `.so` separado, sem modificação e substituível, o que cumpre a LGPL-2.1 sem contaminar nosso código (a proibição do item 2 é de LGPL **ligada estaticamente**); (c) não há alternativa prática: todo numpy/scipy distribuído depende delas. Condições: nunca ligar estaticamente, nunca modificar, manter o aviso em `THIRD_PARTY_LICENSES.md` (seção do services/mesh, parágrafo preservado à mão pelo `scripts/licencas.sh`) e, na distribuição comercial (fase 5), incluir os textos das licenças. O `pip-licenses` só enxerga o pacote Python (BSD), por isso o registro é manual.
2. **Checagem de nomes proibidos só em manifestos e lockfiles.** O `grep` da CI no texto inteiro dos manifestos não cobria `depth-anything-3`, `da3`, `FLUX.1-dev`, `black-forest-labs`, `sam3d` nem `smpl`, e ampliá-lo por texto daria falso positivo (hashes de integridade, comentários, docs). Agora `scripts/checar_proibidos.py` extrai só **nomes de pacote** de `pnpm-lock.yaml`, dos `package.json`, do `pyproject.toml`, de `requirements*.txt` e do `pip list` do venv (pega transitivas) e compara com a lista do item 2 (nome inteiro, escopo como `@black-forest-labs/*`, e tokens como `smpl`, `sam3d`, `da3`). Documentação e ADRs podem citar os nomes livremente.
3. **Inventário falha fechado**: `scripts/licencas.sh --checar` falha se `pnpm licenses list` falhar ou vier vazio e se o venv não tiver `pip-licenses`; a CI cria o venv **antes** dessa etapa.
