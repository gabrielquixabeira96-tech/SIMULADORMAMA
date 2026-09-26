import { uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { json, lerJson } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { pacientePorId } from "@/db/repositorio";
import { estruturarAnamnese, higienizarSemNome, LIMITE_TEXTO_ANAMNESE } from "@/llm/anamnese";
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
    // Recusa (422) texto com nome de pessoa ANTES de tocar no banco ou no provedor.
    higienizarSemNome(corpo.texto);
    const paciente = await pacientePorId(corpo.paciente_id);
    if (!paciente) throw new PedidoInvalidoError(404, "paciente_nao_encontrado", "paciente não encontrado");
    // atendimento informado: valida (404/422/409) ANTES de gastar a chamada ao LLM
    if (corpo.atendimento_id) await obterOuCriarAtendimento(paciente.id, corpo.atendimento_id, desenho);
    const r = await estruturarAnamnese(corpo.texto, obterProvedor(), { atendimentoId: corpo.atendimento_id ?? undefined });
    // criação do atendimento (se preciso), gravação da anamnese e auditoria: uma transação só
    // (a chamada ao LLM fica fora dela, para não segurar conexão durante a rede)
    const atendimentoId = await transacao(async (c) => {
      const { atendimento } = await obterOuCriarAtendimento(paciente.id, corpo.atendimento_id, desenho, c);
      await salvarAnamnese(atendimento.id, r.anamnese, c);
      await registrarAuditoria(
        {
          usuarioId: usuarioAtual(),
          acao: atendimento.anamnese ? "alterou" : "criou",
          entidade: "atendimentos",
          entidadeId: atendimento.id,
          desenho,
          detalhes: { campo: "anamnese", llm_modo: r.modo, n_nao_informados: r.anamnese.campos_nao_informados.length },
        },
        c,
      );
      return atendimento.id;
    });
    return json({ atendimento_id: atendimentoId, anamnese: r.anamnese, modo: r.modo }, 201);
  } catch (e) {
    return tratarErroLLM(e, "llm.anamnese");
  }
}
