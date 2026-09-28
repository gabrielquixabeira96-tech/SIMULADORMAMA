/**
 * "Fotos de exemplo" do e2e (plano "foto → 3D"): as pastas `sinteticos/<torso>/foto/` (frente +
 * oblíqua D + perfil D) e `sinteticos/t01_simetrico_300/foto_frente/` (só a frontal) preparadas pelo
 * PIPELINE REAL do services/mesh (`mesh.cli fotos-exemplo`: fotos sintéticas renderizadas do torso →
 * /reconstruir-foto com ajuste do template e a foto projetada no atlas → avaliacao.json contra o
 * gabarito). Nada é commitado; nenhuma imagem real.
 *
 * Copia as de `data/sinteticos` quando já preparadas e atualizadas (a CI roda `scripts/mesh.sh fotos`
 * antes do e2e); senão gera no DATA_DIR do e2e com o mesmo comando (~2 min por torso).
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const VARIANTES_FOTO: Record<string, readonly string[]> = { t01_simetrico_300: ["foto", "foto_frente"] };
const variantes = (t: string) => VARIANTES_FOTO[t] ?? ["foto"];
const pronta = (pasta: string) => existsSync(join(pasta, "reconstrucao.json")) && existsSync(join(pasta, "avaliacao.json"));

export function prepararFotosExemplo(origem: string, dir: string, torsos: readonly string[], raizRepo: string): void {
  let faltam = false;
  for (const t of torsos) {
    const destino = join(dir, "sinteticos", t);
    if (!existsSync(join(destino, "gabarito.json"))) continue;
    for (const v of variantes(t)) {
      const real = join(origem, t, v);
      // só copia se a reconstrução for do MESMO torso (gabarito idêntico ao copiado para o e2e)
      if (pronta(real) && mesmoGabarito(join(origem, t), destino)) {
        cpSync(real, join(destino, v), { recursive: true });
        if (existsSync(join(origem, t, "fotos"))) cpSync(join(origem, t, "fotos"), join(destino, "fotos"), { recursive: true });
      } else faltam = true;
    }
  }
  if (faltam) execSync("bash scripts/mesh.sh fotos", { cwd: raizRepo, stdio: "inherit", env: { ...process.env, DATA_DIR: dir } });
  for (const t of torsos)
    for (const v of variantes(t))
      if (existsSync(join(dir, "sinteticos", t, "gabarito.json")) && !pronta(join(dir, "sinteticos", t, v)))
        throw new Error(`fotos de exemplo ausentes em ${t}/${v} (bash scripts/mesh.sh fotos)`);
}

function mesmoGabarito(a: string, b: string): boolean {
  try {
    return readFileSync(join(a, "gabarito.json")).equals(readFileSync(join(b, "gabarito.json")));
  } catch {
    return false;
  }
}
