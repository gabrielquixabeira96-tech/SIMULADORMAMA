import { filtroDeQuery } from "@simulador/contratos";
import { json, tratarErro } from "@/api/respostas";
import { listarParaEscolhaManual, sugerirImplantes } from "@/catalogo/catalogo";
import { getDesenho } from "@/config/desenho";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalogo — ESCOLHA MANUAL (A e B): lista filtrada pela query (`filtroDeQuery`), em
 * ordem neutra por id (sem ranking nem "recomendado"). Filtro inválido → 400 (ZodError).
 * `?sugerir=1` → guarda da sugestão de implante: A → 403; B → 501.
 */
export async function GET(req: Request) {
  try {
    const desenho = getDesenho();
    const params = new URL(req.url).searchParams;
    const sugerir = params.get("sugerir");
    if (sugerir && sugerir !== "0") sugerirImplantes(desenho);
    return json({ ordem: "neutra_por_id", implantes: listarParaEscolhaManual(filtroDeQuery(params)) });
  } catch (e) {
    return tratarErro(e, "catalogo");
  }
}
