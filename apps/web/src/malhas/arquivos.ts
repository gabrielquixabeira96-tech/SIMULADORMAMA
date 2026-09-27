/** Lista fixa de arquivos de malha servíveis por rota (ADR 0003 item 7). */
const NOMES_FIXOS: Record<string, string> = {
  "processada.glb": "model/gltf-binary",
  "morphs/manifest.json": "application/json",
};
const REGEX_MORPH = /^morphs\/(subglandular|dual_plane)__(manter|rebaixar)\.glb$/;

/** Content-Type do arquivo permitido, ou null se o nome estiver fora da lista. */
export function tipoDoArquivo(nome: string): string | null {
  if (Object.hasOwn(NOMES_FIXOS, nome)) return NOMES_FIXOS[nome] ?? null;
  if (REGEX_MORPH.test(nome)) return "model/gltf-binary";
  return null;
}

/**
 * Anula `previsto` (números calculados pelo modelo) de cada target do manifest `morphs/1.0`
 * quando o desenho não permite números calculados (DESENHO=A; ADR 0005). Não muta a entrada.
 */
export function redigirPrevistoManifest<T>(manifest: T, calculadosPermitidos: boolean): T {
  if (calculadosPermitidos) return manifest;
  const m = manifest as { arquivos?: Array<{ targets?: Array<Record<string, unknown>> }> };
  if (!m || !Array.isArray(m.arquivos)) return manifest;
  return {
    ...(manifest as object),
    arquivos: m.arquivos.map((a) => ({ ...a, targets: Array.isArray(a.targets) ? a.targets.map((t) => ({ ...t, previsto: null })) : a.targets })),
  } as T;
}

/**
 * Gabarito sem os números que o desenho desliga (ADR 0005): em A, `distancias` e `volumes` viram
 * null e os parâmetros de volume/N-IMF do gerador saem. Os landmarks (âncora) ficam.
 */
export function redigirGabarito(g: Record<string, unknown>, medir: boolean, volume: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...g };
  if (!medir) out.distancias = null;
  if (!volume) out.volumes = null;
  if ((!medir || !volume) && out.parametros && typeof out.parametros === "object") {
    const p = { ...(out.parametros as Record<string, unknown>) };
    if (!volume) delete p.volume_ml;
    if (!medir) delete p.n_imf_mm;
    out.parametros = p;
  }
  return out;
}
