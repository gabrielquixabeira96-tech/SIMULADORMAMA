# ADR 0010 — Sistema de coordenadas e unidades

Status: aceito · Data: 2026-09-26

## Contexto

Web (three.js, Y-up, unidade livre), glTF (Y-up, metros por especificação), OBJ do 3D Scanner App (metros, Y-up ARKit), Python (trimesh/Open3D, unidade livre) e clínica (cm no TEPID, cc/mL em implantes) usam convenções diferentes. Erros de unidade e de eixo são a causa mais comum de divergência entre implementadores.

## Decisão

1. **Uma unidade em todo o sistema: milímetro.** OBJ, PLY, GLB, JSON, SQL e UI interna em mm; volume em mL. A UI pode *exibir* cm, mas nunca armazena. Sufixos obrigatórios `_mm`, `_ml`, `_graus`, `_pct`, `_fator`.
2. **Eixos**: destro, **+Y cranial, +Z anterior, +X lado esquerdo da paciente** (o padrão three.js/glTF, sem rotações na carga). Lados nomeados `dir`/`esq` sempre da paciente.
3. **glTF em mm, desviando da convenção "metros"** da especificação, com `asset.extras.unidade = "mm"` obrigatório e conferido pelo carregador. Motivo: um só fator em todo o sistema elimina escalas de nó, e os arquivos são internos (não trocados com Blender/Unity). Se um dia for preciso exportar para ferramentas externas, um conversor aplica ×0,001.
4. **Dois quadros**: `scan` (como recebido, após mm e régua) e `anatomico` (origem na fúrcula, eixos por landmarks, fórmula única em `contratos.md` §1.1). Malhas de pacientes ficam em `scan`; sintéticos nascem em `anatomico`; a transformação é serializada em `medidas.quadro_anatomico.matriz` (coluna-major).
5. **Índices base 0** na malha processada; landmarks com `posicao` (ponto exato) e `vertice` (mais próximo).

## Alternativas

- glTF em metros com `scale=1000` no nó ou no loader: correto pela spec, mas cria dois "mundos" (mm no OBJ, m no GLB) e todo bug de 1000× fica invisível até medir. Rejeitado.
- Z-up (convenção médica DICOM/LPS): exigiria rotação em todo carregamento three.js. Rejeitado.
- Unidade cm (como a clínica): comum em antropometria, mas a decimação, os deltas dos morphs e os limiares de 0,01 mm ficam em frações. Rejeitado.

## Consequências

- Todo teste de contrato inclui um "teste de escala" (torso sintético com largura conhecida → caixa envolvente em mm).
- Conversões só acontecem nas bordas: na entrada (`unidade_origem`), na exibição (mm→cm) e num eventual exportador externo.
