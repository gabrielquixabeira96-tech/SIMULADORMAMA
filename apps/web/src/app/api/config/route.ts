import { json, tratarErro } from "@/api/respostas";
import { configPublica } from "@/config/publica";

export const dynamic = "force-dynamic";

/** GET /api/config — flag DESENHO e mapa de recursos para o cliente (ADR 0005). */
export async function GET() {
  try {
    return json(configPublica());
  } catch (e) {
    return tratarErro(e, "config");
  }
}
