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

## Node — instalado (apps/web, packages/contratos; Marco 1)

Inventário de `pnpm licenses list` em 2026-09-26 (lockfile `pnpm-lock.yaml`). Dependências diretas:

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| next, @next/env | 16.3.6 | MIT | app (App Router), carga do `.env` da raiz |
| react, react-dom | 19.2.8 | MIT | UI |
| three | 0.186.1 | MIT | viewer 3D (GLTF/OBJ/MTL/PLY loaders) |
| @react-three/fiber | 9.8.1 | MIT | viewer 3D |
| @react-three/drei | 10.7.9 | MIT | OrbitControls, Line |
| zod | 4.6.5 | MIT | validação dos contratos (`@simulador/contratos`) |
| pg | 8.23.0 | MIT | Postgres |
| fflate | 0.8.3 | MIT | upload `.zip` |
| typescript | 5.9.3 | Apache-2.0 | (dev) typecheck |
| eslint, eslint-config-next | 9.39.5, 16.3.6 | MIT | (dev) lint |
| vitest | 3.2.7 | MIT | (dev) testes unitários/API/banco |
| msw | 2.15.0 | MIT | (dev) mock do contrato HTTP do services/mesh |
| jsdom, @testing-library/react, @testing-library/dom | 27.4.0, 16.3.3, 10.4.2 | MIT | (dev) testes de componentes |
| @playwright/test | 1.56.1 | Apache-2.0 | (dev) e2e (Chromium 1194 pré-instalado) |

Transitivas (todas as ~530): MIT 448 · Apache-2.0 31 · ISC 24 · BSD-2-Clause 9 · BSD-3-Clause 4 · MIT-0 2 · CC0-1.0 2 · BlueOak-1.0.0 2 · Python-2.0 1 (`argparse`, dev) · MPL-2.0 1 (`axe-core`, dev, sem modificação) · CC-BY-4.0 1 (`caniuse-lite`, dados; atribuição: Alexis Deveria, caniuse.com) · 0BSD 1 · (MIT OR CC0-1.0) 1.

**Atenção (pendente de decisão do orquestrador):** `next` traz `sharp` como dependência *opcional*, e o `sharp` baixa `@img/sharp-libvips-*` sob **LGPL-3.0-or-later**. O app não usa `next/image` nem `sharp`. Proposta: remover no root (`"pnpm": { "overrides": { "sharp": "-" } }` ou `overrides` no `pnpm-workspace.yaml`) e regenerar o lockfile.

## services/mesh (Python 3.11) — instaladas (Marcos 0/1, `pip-licenses` em `services/mesh/.venv`)

Runtime: numpy, scipy, trimesh, rtree, fast-simplification, pygeodesic, fastapi, starlette, uvicorn, pydantic, Pillow, jsonschema e suas transitivas. Dev: pytest, httpx, ruff, pip-licenses. Open3D **não** foi instalado (decimação feita por `fast-simplification`, MIT); `pymeshlab`/`gdist` ausentes.

| Name                      | Version   | License                                            | URL                                                            |
|---------------------------|-----------|----------------------------------------------------|----------------------------------------------------------------|
| Pygments                  | 2.21.0    | BSD-2-Clause                                       | https://pygments.org                                           |
| annotated-doc             | 0.0.5     | MIT                                                | https://github.com/fastapi/annotated-doc                       |
| annotated-types           | 0.8.0     | MIT                                                | https://github.com/annotated-types/annotated-types             |
| anyio                     | 4.15.1    | MIT                                                | https://anyio.readthedocs.io/en/stable/versionhistory.html     |
| attrs                     | 26.1.0    | MIT                                                | https://www.attrs.org/en/stable/changelog.html                 |
| certifi                   | 2026.7.22 | Mozilla Public License 2.0 (MPL 2.0)               | https://github.com/certifi/python-certifi                      |
| click                     | 8.5.0     | BSD-3-Clause                                       | https://github.com/pallets/click/                              |
| fast_simplification       | 0.2.0     | MIT                                                | https://github.com/pyvista/fast-simplification                 |
| fastapi                   | 0.141.1   | MIT                                                | https://github.com/fastapi/fastapi                             |
| h11                       | 0.16.0    | MIT License                                        | https://github.com/python-hyper/h11                            |
| httpcore                  | 1.0.9     | BSD-3-Clause                                       | https://www.encode.io/httpcore/                                |
| httpx                     | 0.28.1    | BSD License                                        | https://github.com/encode/httpx                                |
| idna                      | 3.20      | BSD-3-Clause                                       | https://github.com/kjd/idna                                    |
| iniconfig                 | 2.3.0     | MIT                                                | https://github.com/pytest-dev/iniconfig                        |
| jsonschema                | 4.26.0    | MIT                                                | https://github.com/python-jsonschema/jsonschema                |
| jsonschema-specifications | 2025.9.1  | MIT                                                | https://github.com/python-jsonschema/jsonschema-specifications |
| numpy                     | 2.4.6     | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | https://numpy.org                                              |
| packaging                 | 26.3      | Apache-2.0 OR BSD-2-Clause                         | https://github.com/pypa/packaging                              |
| pillow                    | 12.3.0    | MIT-CMU                                            | https://python-pillow.github.io                                |
| pluggy                    | 1.6.0     | MIT License                                        | UNKNOWN                                                        |
| pydantic                  | 2.13.5    | MIT                                                | https://github.com/pydantic/pydantic                           |
| pydantic_core             | 2.46.5    | MIT                                                | https://github.com/pydantic                                    |
| pygeodesic                | 0.1.11    | MIT License                                        | https://github.com/mhogg/pygeodesic                            |
| pytest                    | 9.1.1     | MIT                                                | https://docs.pytest.org/en/latest/                             |
| referencing               | 0.37.0    | MIT                                                | https://github.com/python-jsonschema/referencing               |
| rpds-py                   | 2026.6.3  | MIT                                                | https://github.com/crate-py/rpds                               |
| rtree                     | 1.4.1     | MIT                                                | https://github.com/Toblerity/rtree                             |
| ruff                      | 0.16.9    | MIT                                                | https://docs.astral.sh/ruff                                    |
| scipy                     | 1.17.1    | BSD License                                        | https://scipy.org/                                             |
| starlette                 | 1.7.0     | BSD-3-Clause                                       | https://github.com/Kludex/starlette                            |
| trimesh                   | 5.1.0     | MIT License                                        | https://github.com/mikedh/trimesh                              |
| typing-inspection         | 0.4.4     | MIT                                                | https://github.com/pydantic/typing-inspection                  |
| typing_extensions         | 4.16.0    | PSF-2.0                                            | https://github.com/python/typing_extensions                    |
| uvicorn                   | 0.54.0    | BSD-3-Clause                                       | https://uvicorn.dev/                                           |

Código nativo embutido: `pygeodesic` inclui a biblioteca de geodésica exata de Danil Kirsanov (MIT, 2008); `fast-simplification` inclui Fast-Quadric-Mesh-Simplification (MIT, Sven Forstmann); `rtree` inclui libspatialindex (MIT). `certifi` (MPL-2.0) é transitiva de `httpx` (só dev/testes), sem modificação. A textura do torso sintético é procedural (gerada por código, sem imagem de terceiros).
