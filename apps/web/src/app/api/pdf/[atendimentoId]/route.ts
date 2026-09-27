import { uuidSchema } from "@simulador/contratos";
import { erro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { tratarErroLLM } from "@/llm/erros";
import { atendimentoPorId } from "@/llm/repositorio";
import { lerPdf } from "@/pdf/armazenar";

export const dynamic = "force-dynamic";

/**
 * GET /api/pdf/<atendimentoId> — PDF mais recente do atendimento. `?download=1` baixa
 * (auditado 'exportou'); sem ele abre no navegador (auditado 'visualizou'). Sem link público,
 * sem cache, sem compartilhamento.
 */
export async function GET(req: Request, ctx: { params: Promise<{ atendimentoId: string }> }) {
  try {
    const desenho = getDesenho();
    const { atendimentoId } = await ctx.params;
    if (!uuidSchema.safeParse(atendimentoId).success) return erro(400, "id_invalido", "id deve ser uuid");
    const at = await atendimentoPorId(atendimentoId);
    if (!at) return erro(404, "atendimento_nao_encontrado", "atendimento não encontrado");
    if (at.desenho !== desenho) return erro(409, "desenho_divergente", "atendimento registrado em outro desenho");
    if (!at.pdf_caminho) return erro(404, "pdf_nao_gerado", "PDF ainda não gerado");
    const buf = lerPdf(at.pdf_caminho, at.pdf_sha256);
    const download = new URL(req.url).searchParams.get("download") === "1";
    await registrarAuditoria({
      usuarioId: usuarioAtual(),
      acao: download ? "exportou" : "visualizou",
      entidade: "arquivo",
      entidadeId: at.id,
      desenho,
      detalhes: { tipo: "pdf_atendimento", modo: download ? "download" : "leitura", sha256: at.pdf_sha256 },
    });
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="atendimento-${at.pseudonimo}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return tratarErroLLM(e, "pdf.ler");
  }
}
