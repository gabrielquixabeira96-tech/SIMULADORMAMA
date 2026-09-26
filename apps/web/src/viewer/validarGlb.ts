/**
 * Conferência do asset glTF (contratos §5.3; ADR 0010): o carregador DEVE rejeitar `.glb`
 * sem `asset.extras.unidade == "mm"`. O viewer nunca aplica escala.
 */
export interface ResultadoAssetGlb {
  ok: boolean;
  motivo?: string;
  quadro?: "scan" | "anatomico";
  esquema?: string;
}

export function validarAssetGlb(asset: unknown, esquemaEsperado?: string): ResultadoAssetGlb {
  const extras = (asset as { extras?: Record<string, unknown> } | undefined)?.extras;
  if (!extras || typeof extras !== "object") return { ok: false, motivo: "glb sem asset.extras (unidade desconhecida)" };
  if (extras.unidade !== "mm") return { ok: false, motivo: `glb com unidade '${String(extras.unidade)}' (esperado 'mm')` };
  const quadro = extras.quadro;
  if (quadro !== "scan" && quadro !== "anatomico") return { ok: false, motivo: "glb sem asset.extras.quadro válido" };
  if (esquemaEsperado && extras.esquema !== esquemaEsperado) return { ok: false, motivo: `glb com esquema '${String(extras.esquema)}' (esperado '${esquemaEsperado}')` };
  return { ok: true, quadro, esquema: typeof extras.esquema === "string" ? extras.esquema : undefined };
}

/** A malha não pode ter transformação de nó (contratos §5.3): matriz identidade. */
export function ehIdentidade(elementos: ArrayLike<number>, tol = 1e-9): boolean {
  for (let i = 0; i < 16; i++) {
    const esperado = i % 5 === 0 ? 1 : 0;
    if (Math.abs((elementos[i] ?? NaN) - esperado) > tol) return false;
  }
  return true;
}
