import { readdir, stat } from "node:fs/promises";
import { json, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir } from "@/config/ambiente";

export const dynamic = "force-dynamic";

/**
 * GET /api/sinteticos — torsos sintéticos gerados pelo services/mesh em DATA_DIR/sinteticos
 * (contratos §4.2). Não são dados de paciente; servem ao critério do Marco 0 (abrir no viewer).
 */
export async function GET() {
  try {
    let nomes: string[] = [];
    try {
      nomes = (await readdir(caminhoEmDataDir("sinteticos"), { withFileTypes: true }))
        .filter((d) => d.isDirectory() && /^[a-z0-9_]+$/.test(d.name))
        .map((d) => d.name)
        .sort();
    } catch {
      nomes = [];
    }
    const torsos = [];
    for (const nome of nomes) {
      const tem = async (a: string) => stat(caminhoEmDataDir(`sinteticos/${nome}/${a}`)).then((s) => s.isFile()).catch(() => false);
      torsos.push({ nome, glb: await tem("torso.glb"), obj: await tem("torso.obj"), gabarito: await tem("gabarito.json") });
    }
    return json({ torsos });
  } catch (e) {
    return tratarErro(e, "sinteticos.listar");
  }
}
