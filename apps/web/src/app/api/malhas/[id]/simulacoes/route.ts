import { IMFS, LADOS, PLANOS, previstoSchema, uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { buscarImplante } from "@/catalogo/catalogo";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { inserirSimulacao, listarSimulacoes, malhaPorId, upsertImplante } from "@/db/repositorio";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  implante_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  plano: z.enum(PLANOS),
  imf: z.enum(IMFS),
  lado: z.enum(LADOS),
  versao_config_simulacao: z.string().min(1),
  nao_calibrado: z.boolean(),
  previsto: previstoSchema.nullable().optional(),
});

/**
 * POST /api/malhas/<id>/simulacoes — registra que uma simulação foi MOSTRADA (ADR 0002 item 5;
 * é o que o PDF/TCLE cita como "simulações mostradas"). Auditado como 'simulou'.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const corpo = corpoSchema.parse(await lerJson(req));
    const implante = buscarImplante(corpo.implante_id);
    if (!implante) return erro(422, "implante_desconhecido", "implante fora do catálogo");
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const simId = await transacao(async (c) => {
      await upsertImplante(implante, c);
      const sid = await inserirSimulacao(
        { malhaId: m.id, implanteId: implante.id, plano: corpo.plano, imf: corpo.imf, lado: corpo.lado, versaoConfig: corpo.versao_config_simulacao, naoCalibrado: corpo.nao_calibrado, previsto: corpo.previsto ?? null },
        c,
      );
      await registrarAuditoria(
        { usuarioId: usuarioAtual(), acao: "simulou", entidade: "simulacoes", entidadeId: sid, desenho, detalhes: { malha_id: m.id, implante_id: implante.id, plano: corpo.plano, imf: corpo.imf, lado: corpo.lado } },
        c,
      );
      return sid;
    });
    return json({ id: simId }, 201);
  } catch (e) {
    return tratarErro(e, "simulacoes.registrar");
  }
}

/** GET /api/malhas/<id>/simulacoes — simulações mostradas (para relatório/PDF). Em A sem `previsto`. Auditado. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const lista = await listarSimulacoes(m.id);
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "simulacoes", entidadeId: m.id, desenho, detalhes: { n: lista.length } });
    const calculados = recursoAtivoEm(desenho, "numeros_calculados_no_relatorio");
    return json({ simulacoes: lista.map((s) => ({ ...s, previsto: calculados ? s.previsto : null })) });
  } catch (e) {
    return tratarErro(e, "simulacoes.listar");
  }
}
