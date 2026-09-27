import { uuidSchema } from "@simulador/contratos";
import { erro, json, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { malhaPorId } from "@/db/repositorio";

export const dynamic = "force-dynamic";

/** GET /api/malhas/<id> — metadados (malha_meta/1.0). Auditado. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "malhas", entidadeId: m.id, desenho });
    return json({
      id: m.id,
      paciente_id: m.paciente_id,
      pseudonimo: m.pseudonimo,
      formato_origem: m.formato_origem,
      unidade_origem: m.unidade_origem,
      fator_escala_acumulado: m.fator_escala_acumulado,
      sintetica: m.sintetica,
      meta: m.meta,
      criado_em: m.criado_em,
    });
  } catch (e) {
    return tratarErro(e, "malhas.ler");
  }
}
