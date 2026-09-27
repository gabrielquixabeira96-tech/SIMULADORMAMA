import { json } from "@/api/respostas";
import { getDesenho } from "@/config/desenho";
import { ClienteMesh } from "@/mesh/cliente";

export const dynamic = "force-dynamic";

/** GET /api/mesh/saude — estado do services/mesh para a UI ("aguardando serviço de malha"). */
export async function GET() {
  try {
    const s = await new ClienteMesh({ desenho: getDesenho() }).saude();
    return json({ disponivel: true, versao_software: s.versao_software, contrato: s.contrato });
  } catch {
    return json({ disponivel: false });
  }
}
