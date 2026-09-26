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
