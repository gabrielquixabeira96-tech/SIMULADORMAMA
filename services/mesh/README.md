# services/mesh — placeholder (Marco 0)

Serviço Python 3.11 (FastAPI) de processamento de malha. **Ainda não implementado**; este README fixa o que o agente Python deve construir e onde.

Leia antes de codar: `docs/contratos.md` (inteiro; sobretudo §1, §2, §3, §4, §5, §7, §9, §10, §12), `docs/adr/0001`, `0003`, `0009`, `0010`, `0011`, e `config/schemas/`.

## Escopo (Marcos 0, 1 e 2)

- **Torso sintético paramétrico** (`python -m mesh.cli torso --preset t01_simetrico_300 --saida data/sinteticos` e `POST /torso-sintetico`): parâmetros `torso_parametros/1.0` (`config/torsos_presets.json`), saída OBJ+MTL+textura procedural+GLB em **mm, quadro anatômico** (origem na fúrcula, +Y cranial, +Z anterior, +X esquerda da paciente) e `gabarito.json` (`gabarito/1.0`) com landmarks exatos, euclidianas, geodésicas MMP na malha densa e volume adicionado real. Determinístico por `semente`.
- `POST /processar`: OBJ/PLY → recorte abaixo do pescoço → limpeza → decimação por quádricas 30–50k vértices (Open3D/`fast-simplification`; **nunca `pymeshlab`**) → `processada.obj/.mtl`, `textura.png`, `processada.glb` (mesma ordem de vértices; `asset.extras.unidade="mm"`), `meta.json` (`malha_meta/1.0`).
- `POST /reescalar`, `POST /medir` (euclidiana conferida a 0,01 mm; geodésica MMP via `pygeodesic`; volume `plano_base_elipse` com incerteza; quadro anatômico pela fórmula §1.1), `POST /validar-bland-altman`, `GET /saude`.
- Modelo geométrico-paramétrico (`config/simulacao.json`, tudo `nao_calibrado`) implementando `SimuladorDeformacao` (§12.1) e `POST /morphs` → um `.glb` por (plano, imf) com morph targets esparsos nomeados `mt__<implante>__<plano>__<imf>[__dir|__esq]` em `mesh.extras.targetNames` + `manifest.json` (`morphs/1.0`).
- Interfaces vazias `GeradorFEBio` e `SurrogateONNX` (§12.1) lançando `NotImplementedError`.
- Testes pytest: escala (caixa envolvente do torso em mm), gabarito ±1 mm, geodésica decimada vs densa ≤1 mm/1 %, monotonicidade, simetria (≤0,1 mm), `imf=manter` (sulco ≤1 mm), contratos (jsonschema contra `config/schemas/`), recusa de caminhos fora de `DATA_DIR`.
- Cabeçalho `X-Desenho` lido e logado em toda rota; `X-Desenho: A` com `incluir_volume: true` gera aviso no log (o web nunca deve fazer isso).

## Estrutura sugerida

```
services/mesh/
  pyproject.toml          # name: mesh; deps: fastapi, uvicorn, pydantic, numpy, trimesh, open3d, pygeodesic, pygltflib, Pillow, jsonschema; [dev]: pytest, ruff, pip-licenses
  mesh/
    __init__.py  versao.py (lê ../../VERSION)  servidor.py (FastAPI; --host --port)  cli.py
    caminhos.py           # resolve e valida caminhos relativos a DATA_DIR
    sintetico/            # gerador paramétrico, textura procedural, gabarito
    processar/            # leitura OBJ/PLY, recorte, limpeza, decimação, exportação OBJ/GLB
    medir/                # euclidiana, geodésica (MMP), volume, quadro anatômico, bland_altman
    simulacao/            # interfaces.py (§12.1), geometrico.py, morphs.py (glTF esparso), config.py
  tests/                  # pytest; fixtures pequenas em tests/fixtures/ (< 1 MB)
```

`DATA_DIR` vem do ambiente (padrão `../../data`). O serviço escuta só em `127.0.0.1:8765` (sem auth nesta fase).
