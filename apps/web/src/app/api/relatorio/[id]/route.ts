import { uuidSchema } from "@simulador/contratos";
import { erro, json } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { tratarErroLLM } from "@/llm/erros";
import { relatorioPorId } from "@/llm/repositorio";

export const dynamic = "force-dynamic";

/** GET /api/relatorio/<id> — relatório gravado (texto exato). Auditado como 'visualizou'. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const r = await relatorioPorId(id);
    if (!r) return erro(404, "relatorio_nao_encontrado", "relatório não encontrado");
    if (r.desenho !== desenho) return erro(409, "desenho_divergente", "relatório registrado em outro desenho");
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "relatorios", entidadeId: r.id, desenho, detalhes: { atendimento_id: r.atendimento_id } });
    return json({ relatorio: r.payload });
  } catch (e) {
    return tratarErroLLM(e, "relatorio.ler");
  }
}
