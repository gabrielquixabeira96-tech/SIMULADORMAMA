# Licenças de terceiros

Inventário inicial (versão 0.0.1, Marco 0). Ainda **não há dependências instaladas**; este arquivo será regenerado por `scripts/licencas.sh` a cada marco. Política em `docs/adr/0009-licencas.md`.

## Permitidas

MIT, BSD-2/3-Clause, Apache-2.0, ISC, 0BSD, Zlib, PostgreSQL, Python-2.0, MPL-2.0 (arquivo separado, sem modificação), CC0-1.0 / CC-BY-4.0 (assets, com atribuição).

## Proibidas (nunca presentes)

RBSM, iRBSM, liRBSM; SMPL, SMPL-X e topologias derivadas; Depth Anything 2 Base/Large; Depth Anything 3 Giant/Large/Nested; FLUX dev; VGGT original; SAM 3D Body ("SAM License"); `pymeshlab` (GPL-3); `gdist` (LGPL); qualquer GPL/AGPL/SSPL/BUSL/CC-NC/"research only".

## Dependências previstas (a confirmar na instalação)

| Camada | Pacote | Licença esperada | Uso |
|---|---|---|---|
| web | next, react, react-dom | MIT | app |
| web | three, @react-three/fiber, @react-three/drei | MIT | viewer 3D |
| web | zod | MIT | validação dos contratos |
| web | pg, drizzle-orm (opcional) | MIT | Postgres |
| web | @anthropic-ai/sdk | MIT | LLM (tool use) |
| web | @react-pdf/renderer ou pdf-lib | MIT | PDF do atendimento |
| web | vitest, @playwright/test, eslint, typescript | MIT / Apache-2.0 | testes e lint |
| python | fastapi, uvicorn, pydantic | MIT | API HTTP |
| python | numpy | BSD-3 | numérico |
| python | trimesh | MIT | malhas |
| python | open3d | MIT | decimação, limpeza |
| python | pygeodesic (ou potpourri3d) | MIT | geodésica MMP (ou calor) |
| python | fast-simplification (alternativa) | MIT | decimação |
| python | pygltflib | MIT | escrita de glTF/GLB com morph targets |
| python | Pillow | MIT-CMU (HPND) | textura procedural |
| python | jsonschema | MIT | validação dos contratos |
| python | pytest, ruff, pip-licenses | MIT | testes, lint, inventário |
| infra | postgresql 16 | PostgreSQL | banco |

Nenhum modelo de forma corporal, peso de rede neural ou dataset externo é usado nas fases 0–2.
