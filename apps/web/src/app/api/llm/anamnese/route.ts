import { uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { json, lerJson } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { pacientePorId } from "@/db/repositorio";
import { estruturarAnamnese, LIMITE_TEXTO_ANAMNESE } from "@/llm/anamnese";
import { tratarErroLLM } from "@/llm/erros";
import { obterProvedor } from "@/llm/fabrica";
import { salvarAnamnese } from "@/llm/repositorio";
import { obterOuCriarAtendimento, PedidoInvalidoError } from "@/llm/servicoRelatorio";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  paciente_id: uuidSchema,
  atendimento_id: uuidSchema.nullable().optional(),
  texto: z.string().trim().min(1).max(LIMITE_TEXTO_ANAMNESE),
});

/**
 * POST /api/llm/anamnese — texto livre → anamnese/1.0 validada (Marco 2b; ADR 0006).
 * O texto é higienizado antes do LLM e NUNCA é gravado nem logado; grava-se só o JSON validado
 * em atendimentos.anamnese. Auditado. Funciona em mock sem ANTHROPIC_API_KEY.
 */
export async function POST(req: Request) {
  try {
    const desenho = getDesenho();
    const corpo = corpoSchema.parse(await lerJson(req));
    const paciente = await pacientePorId(corpo.paciente_id);
    if (!paciente) throw new PedidoInvalidoError(404, "paciente_nao_encontrado", "paciente não encontrado");
    const { atendimento } = await obterOuCriarAtendimento(paciente.id, corpo.atendimento_id, desenho);
    const r = await estruturarAnamnese(corpo.texto, obterProvedor(), { atendimentoId: atendimento.id });
    await salvarAnamnese(atendimento.id, r.anamnese);
    await registrarAuditoria({
      usuarioId: usuarioAtual(),
      acao: atendimento.anamnese ? "alterou" : "criou",
      entidade: "atendimentos",
      entidadeId: atendimento.id,
      desenho,
      detalhes: { campo: "anamnese", llm_modo: r.modo, n_nao_informados: r.anamnese.campos_nao_informados.length },
    });
    return json({ atendimento_id: atendimento.id, anamnese: r.anamnese, modo: r.modo }, 201);
  } catch (e) {
    return tratarErroLLM(e, "llm.anamnese");
  }
}
