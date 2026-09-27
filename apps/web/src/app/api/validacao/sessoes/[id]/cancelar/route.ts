import { bloquearSeDesligado, json } from "@/api/respostas";
import { auditarSessao, erroValidacao, RECURSO_VALIDACAO } from "@/validacao/http";
import { cancelarSessao, vistaPublica } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/validacao/sessoes/<id>/cancelar — abandona a sessão (sem resultado; o gabarito continua oculto). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const { id } = await ctx.params;
    const s = await cancelarSessao(id);
    await auditarSessao("alterou", s.id, { operacao: "cancelou" });
    return json(vistaPublica(s));
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.cancelar");
  }
}
