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
