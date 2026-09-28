import { bloquearSeDesligado, json, lerJson } from "@/api/respostas";
import { getDesenho } from "@/config/desenho";
import { auditarSessao, erroValidacao, indiceDeParam, RECURSO_VALIDACAO } from "@/validacao/http";
import { registrarItem, vistaPublica } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/validacao/sessoes/<id>/itens/<indice> — registra os 10 landmarks marcados pelo operador
 * no scan do item. As distâncias (euclidianas + geodésicas do services/mesh) ficam SÓ no servidor:
 * a resposta é a vista pública (item concluído), sem nenhum número medido nem do gabarito.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; indice: string }> }) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const { id, indice } = await ctx.params;
    const s = await registrarItem(id, indiceDeParam(indice), await lerJson(req), getDesenho());
    await auditarSessao("alterou", s.id, { operacao: "registrou_item", indice: Number(indice) });
    return json(vistaPublica(s));
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.item");
  }
}
