import { bloquearSeDesligado, json } from "@/api/respostas";
import { erroValidacao, RECURSO_VALIDACAO } from "@/validacao/http";
import { bloqueioGabarito, lerSessao, vistaPublica } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/validacao/sessoes/<id> — vista pública (resultado e gabarito só depois de encerrada). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const { id } = await ctx.params;
    const s = await lerSessao(id);
    return json(vistaPublica(s, await bloqueioGabarito()));
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.ler");
  }
}
