import { IMFS, LADOS, PLANOS, previstoSchema, uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { desligadoNoDesenhoA, erro, json, lerJson, tratarErro } from "@/api/respostas";
import { buscarImplante } from "@/catalogo/catalogo";
import { usuarioAtual } from "@/config/ambiente";
import { carregarConfigSimulacaoUI } from "@/config/arquivosConfig";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { inserirSimulacao, listarSimulacoes, malhaPorId, upsertImplante } from "@/db/repositorio";
import { previstoProibidoPorFoto } from "@/foto/servidor";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  implante_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  plano: z.enum(PLANOS),
  imf: z.enum(IMFS),
  lado: z.enum(LADOS),
  // identificador de versão, nunca texto livre (vai para banco, relatório e PDF); tem de ser a do servidor
  versao_config_simulacao: z.string().regex(/^[0-9A-Za-z._-]{1,32}$/),
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
    // Em A nenhum número calculado é gravado (ADR 0005): `previsto` não nulo é recusado.
    if (corpo.previsto != null && !recursoAtivoEm(desenho, "numeros_calculados_no_relatorio")) return desligadoNoDesenhoA("numeros_calculados_no_relatorio");
    // a versão gravada é a do servidor (config/simulacao.json); outra → 409 (morphs de outra configuração)
    const versaoConfig = carregarConfigSimulacaoUI().versao;
    if (corpo.versao_config_simulacao !== versaoConfig) return erro(409, "versao_config_divergente", `versao_config_simulacao deve ser ${versaoConfig} (config/simulacao.json do servidor)`);
    const implante = buscarImplante(corpo.implante_id);
    if (!implante) return erro(422, "implante_desconhecido", "implante fora do catálogo");
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    // malha de fotos sem perfil: a profundidade é só ilustração (ADR 0021) — nenhum `previsto` gravado, nem em B
    if (corpo.previsto != null && (await previstoProibidoPorFoto(m.malha_dir)))
      return erro(422, "previsto_sem_perfil", "malha reconstruída sem foto de perfil: a profundidade é só ilustração e não há números de projeção");
    const simId = await transacao(async (c) => {
      await upsertImplante(implante, c);
      const sid = await inserirSimulacao(
        { malhaId: m.id, implanteId: implante.id, plano: corpo.plano, imf: corpo.imf, lado: corpo.lado, versaoConfig, naoCalibrado: corpo.nao_calibrado, previsto: corpo.previsto ?? null },
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
    const calculados = recursoAtivoEm(desenho, "numeros_calculados_no_relatorio") && !(await previstoProibidoPorFoto(m.malha_dir));
    return json({ simulacoes: lista.map((s) => ({ ...s, previsto: calculados ? s.previsto : null })) });
  } catch (e) {
    return tratarErro(e, "simulacoes.listar");
  }
}
