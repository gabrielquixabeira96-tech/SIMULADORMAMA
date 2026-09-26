import { json, tratarErro } from "@/api/respostas";
import { carregarCatalogo, sugerirImplantes } from "@/catalogo/catalogo";
import { getDesenho } from "@/config/desenho";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalogo — lista em ordem neutra (sem ranking nem "recomendado").
 * `?sugerir=1` → guarda da sugestão de implante: A → 403; B → 501 (Marco 2).
 */
export async function GET(req: Request) {
  try {
    const desenho = getDesenho();
    const sugerir = new URL(req.url).searchParams.get("sugerir");
    if (sugerir && sugerir !== "0") sugerirImplantes(desenho);
    return json({ ordem: "neutra_por_id", implantes: carregarCatalogo() });
  } catch (e) {
    return tratarErro(e, "catalogo");
  }
}
