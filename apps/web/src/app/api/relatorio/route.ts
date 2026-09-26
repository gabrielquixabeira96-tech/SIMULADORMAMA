import { uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { json, lerJson } from "@/api/respostas";
import { getDesenho } from "@/config/desenho";
import { tratarErroLLM } from "@/llm/erros";
import { obterProvedor } from "@/llm/fabrica";
import { gerarRelatorioDoPedido } from "@/llm/servicoRelatorio";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  paciente_id: uuidSchema,
  malha_id: uuidSchema.nullable().optional(),
  medida_id: uuidSchema.nullable().optional(),
  atendimento_id: uuidSchema.nullable().optional(),
});

/**
 * POST /api/relatorio — relatório para a paciente (relatorio/1.0): números do template travado
 * (dados do banco), prosa do LLM verificada pelo teste travado; em A sem números calculados.
 * Grava em `relatorios` e audita (inclusive a prosa recusada).
 */
export async function POST(req: Request) {
  try {
    const desenho = getDesenho();
    const c = corpoSchema.parse(await lerJson(req));
    const relatorio = await gerarRelatorioDoPedido({ pacienteId: c.paciente_id, malhaId: c.malha_id, medidaId: c.medida_id, atendimentoId: c.atendimento_id }, desenho, obterProvedor());
    return json({ relatorio }, 201);
  } catch (e) {
    return tratarErroLLM(e, "relatorio.gerar");
  }
}
