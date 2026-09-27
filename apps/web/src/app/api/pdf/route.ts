import { uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson } from "@/api/respostas";
import { isoComFuso, usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { tratarErroLLM } from "@/llm/erros";
import { atendimentoPorId, registrarPdf, relatorioPorId, ultimoRelatorio } from "@/llm/repositorio";
import { caminhoRelativoPdf, salvarPdf } from "@/pdf/armazenar";
import { gerarPdfAtendimento } from "@/pdf/gerarPdf";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ atendimento_id: uuidSchema, relatorio_id: uuidSchema.nullable().optional() });

/**
 * POST /api/pdf — gera o PDF do atendimento a partir do relatório gravado (o último, ou
 * `relatorio_id`). Salva em DATA_DIR, registra caminho relativo + SHA-256 e audita a geração.
 */
export async function POST(req: Request) {
  try {
    const desenho = getDesenho();
    const c = corpoSchema.parse(await lerJson(req));
    const at = await atendimentoPorId(c.atendimento_id);
    if (!at) return erro(404, "atendimento_nao_encontrado", "atendimento não encontrado");
    if (at.desenho !== desenho) return erro(409, "desenho_divergente", "atendimento registrado em outro desenho");
    const rel = c.relatorio_id ? await relatorioPorId(c.relatorio_id) : await ultimoRelatorio(at.id);
    if (!rel || rel.atendimento_id !== at.id) return erro(409, "relatorio_ausente", "gere o relatório antes do PDF");
    const geradoEm = isoComFuso();
    const bytes = await gerarPdfAtendimento(rel.payload, geradoEm);
    const caminho = caminhoRelativoPdf(at.id, rel.id);
    const s = salvarPdf(caminho, bytes);
    await transacao(async (cl) => {
      await registrarPdf(at.id, caminho, s.sha256, cl);
      await registrarAuditoria(
        { usuarioId: usuarioAtual(), acao: "criou", entidade: "arquivo", entidadeId: at.id, desenho, detalhes: { tipo: "pdf_atendimento", relatorio_id: rel.id, sha256: s.sha256, bytes: s.bytes } },
        cl,
      );
    });
    return json({ atendimento_id: at.id, relatorio_id: rel.id, sha256: s.sha256, bytes: s.bytes, gerado_em: geradoEm }, 201);
  } catch (e) {
    return tratarErroLLM(e, "pdf.gerar");
  }
}
