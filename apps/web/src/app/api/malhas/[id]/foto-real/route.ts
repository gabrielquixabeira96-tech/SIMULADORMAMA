import { uuidSchema } from "@simulador/contratos";
import { erro, json, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { carregarConfigSimulacaoUI } from "@/config/arquivosConfig";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { registrarAuditoria } from "@/db/auditoria";
import { malhaPorId } from "@/db/repositorio";
import { fotoRealPublica } from "@/foto/publica";
import { avaliacaoLiberadaAgora, lerReconstrucao } from "@/foto/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/malhas/<id>/foto-real — câmeras das fotos (K, R, t; C1), halo, incerteza e, na malha de
 * torso sintético, o erro contra o gabarito, para a vista "Foto real" do modo foto (plano "foto →
 * 3D", P3-lite). 404 `sem_reconstrucao` se a malha não veio de fotos. Em A, sem números calculados
 * (ADR 0005): só as câmeras (desenho) e o halo (incerteza). Auditado; sem cache. As fotos saem pela
 * rota de arquivo (lista fixa), nunca por aqui.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const lida = await lerReconstrucao(m.malha_dir);
    if (!lida) return erro(404, "sem_reconstrucao", "malha sem reconstrução por fotos");
    await registrarAuditoria({
      usuarioId: usuarioAtual(),
      acao: "visualizou",
      entidade: "arquivo",
      entidadeId: m.id,
      desenho,
      detalhes: { nome: lida.fonte === "glb" ? "processada.glb#reconstrucao" : "reconstrucao.json" },
    });
    return json(
      fotoRealPublica(lida.reconstrucao, {
        envelopeMm: carregarConfigSimulacaoUI().envelope_rms_mm,
        numerosPermitidos: recursoAtivoEm(desenho, "medicao_automatica_3d"),
        observado: lida.observado,
        // cegamento da sessão de Bland-Altman (ADR 0017): torso com sessão aberta → sem erro contra o gabarito
        avaliacao: await avaliacaoLiberadaAgora(lida.avaliacao),
      }),
    );
  } catch (e) {
    return tratarErro(e, "malhas.foto_real");
  }
}
