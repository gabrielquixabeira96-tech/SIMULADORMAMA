# data/

Raiz local de arquivos (`DATA_DIR`). Tudo aqui, exceto este README, esta no `.gitignore`.

- `pacientes/<pseudonimo>/...` — malhas, medidas, simulacoes e PDFs (layout em `docs/contratos.md` secao 5.4). Nunca commitar.
- `sinteticos/<nome>/` — torsos sinteticos gerados por `python -m mesh.cli torso` (regeneraveis; nao commitar).
  Com `bash scripts/mesh.sh fotos` (ADR 0021): `fotos/` (fotos sinteticas renderizadas do torso, mascaras e registros) e
  `foto/`, `foto_frente/` (so t01) — a reconstrucao 3D a partir dessas fotos, com `avaliacao.json` contra o gabarito.

Nenhuma imagem real de nudez existe ou pode existir neste repositorio ou nesta pasta durante as fases 0-2.
