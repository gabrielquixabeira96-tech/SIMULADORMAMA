import { bloquearSeDesligado, json, lerJson } from "@/api/respostas";
import { auditarSessao, erroValidacao, RECURSO_VALIDACAO } from "@/validacao/http";
import { bloqueioGabarito, encerrarSessao, vistaPublica, type ResultadoSessao } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/validacao/sessoes/<id>/encerrar — só com todos os itens marcados. Lê os gabaritos no
 * servidor, calcula viés, LoA 95 % (geral, N-IMF à parte, sem N-IMF, por tipo) e a repetibilidade
 * intra-operador, grava em DATA_DIR/validacao/sessoes/<id>.json e devolve o resultado.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const { id } = await ctx.params;
    const s = await encerrarSessao(id, await lerJson(req));
    const r = s.resultado as ResultadoSessao;
    await auditarSessao("alterou", s.id, { operacao: "encerrou", n_pares: r.criterios.n_pares, n_imf: r.n_imf.n });
    // outra sessão aberta com o mesmo torso? então o resultado fica oculto até ela terminar
    return json(vistaPublica(s, await bloqueioGabarito()));
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.encerrar");
  }
}
