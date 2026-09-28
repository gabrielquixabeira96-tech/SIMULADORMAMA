"""Reconstrucao do torso a partir de 1-3 fotos por ajuste de template parametrico (plano foto3d, P1).

Convencoes (contrato C1 `reconstrucao/1.0`):
- Mundo = quadro anatomico em mm (origem na furcula; +X esquerda da paciente, +Y cranial, +Z anterior).
- Camera pinhole no padrao OpenCV: x_cam = R X + t; eixos da camera x para a direita da imagem, y para
  baixo, z para a frente (profundidade positiva). Pixel (u, v) continuo com origem no canto superior
  esquerdo da imagem (o centro do pixel da coluna i fica em u = i + 0,5).
- K, R serializados como 9 numeros coluna-major (como THREE.Matrix3.elements; contratos §1.1); t como 3.
"""
