import { uuidSchema, vetor3Schema } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { atualizarMetaMalha, malhaPorId } from "@/db/repositorio";
import { fatorRegua } from "@/medidas/geometria";
import { ClienteMesh } from "@/mesh/cliente";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  regua_mm: z.number().positive(),
  pontos: z.tuple([vetor3Schema, vetor3Schema]),
});

/**
 * POST /api/malhas/<id>/reescalar — calibração por régua (ADR 0003 item 4). O web decide o
 * fator (regua_mm / |p2 − p1|) e o services/mesh reescreve processada.*. Landmarks marcados
 * antes deste passo são invalidados pelo cliente.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const corpo = corpoSchema.parse(await lerJson(req));
    const fator = fatorRegua(corpo.pontos[0], corpo.pontos[1], corpo.regua_mm);
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const meta = await new ClienteMesh({ desenho }).reescalar({
      malha_dir: m.malha_dir,
      fator,
      regua: { regua_mm: corpo.regua_mm, pontos: corpo.pontos },
    });
    await transacao(async (c) => {
      await atualizarMetaMalha(m.id, meta, c);
      await registrarAuditoria(
        { usuarioId: usuarioAtual(), acao: "alterou", entidade: "malhas", entidadeId: m.id, desenho, detalhes: { operacao: "reescalar", fator, regua_mm: corpo.regua_mm } },
        c,
      );
    });
    return json({ malha_id: m.id, fator, meta, landmarks_invalidados: true });
  } catch (e) {
    return tratarErro(e, "malhas.reescalar");
  }
}
