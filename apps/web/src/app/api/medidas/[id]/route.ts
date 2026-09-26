import { uuidSchema } from "@simulador/contratos";
import { erro, json, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { registrarAuditoria } from "@/db/auditoria";
import { medidasPorId } from "@/db/repositorio";

export const dynamic = "force-dynamic";

/** GET /api/medidas/<id> — registro medidas/1.0. Auditado. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const m = await medidasPorId(id);
    if (!m) return erro(404, "medida_nao_encontrada", "registro de medidas não encontrado");
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "medidas", entidadeId: m.id, desenho });
    // Registro gravado em B lido numa instalação A: números calculados não saem (ADR 0005).
    if (!recursoAtivoEm(desenho, "medicao_automatica_3d") && (m.payload.distancias !== null || m.payload.volumes !== null)) {
      return json({ ...m.payload, distancias: null, volumes: null, geodesica: null, redigido_no_desenho_a: true });
    }
    return json(m.payload);
  } catch (e) {
    return tratarErro(e, "medidas.ler");
  }
}
