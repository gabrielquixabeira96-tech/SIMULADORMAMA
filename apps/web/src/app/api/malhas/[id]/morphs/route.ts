import { IMFS, PLANOS, landmarksSchema, uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { buscarImplante } from "@/catalogo/catalogo";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { malhaPorId } from "@/db/repositorio";
import { ClienteMesh } from "@/mesh/cliente";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.strictObject({
  landmarks: landmarksSchema,
  /** 1 implante (simulação) ou 2 (comparação lado a lado), escolhidos pelo cirurgião. */
  implantes: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).min(1).max(2),
  pinca_polo_superior_mm: z.strictObject({ dir: z.number().positive(), esq: z.number().positive() }).nullable().optional(),
});

/**
 * POST /api/malhas/<id>/morphs — pede ao services/mesh os morph targets dos implantes
 * ESCOLHIDOS (contratos §10.4), nos 2 planos × 2 IMF, lados separados. Vale em A e B
 * (simulação é ilustração; ADR 0005). Exige os 10 landmarks (a base define a pegada).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const corpo = corpoSchema.parse(await lerJson(req));
    const implantes = [...new Set(corpo.implantes)];
    const desconhecidos = implantes.filter((i) => !buscarImplante(i));
    if (desconhecidos.length) return erro(422, "implante_desconhecido", "implante fora do catálogo", { implantes: desconhecidos });
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const manifest = await new ClienteMesh({ desenho }).morphs({
      malha_dir: m.malha_dir,
      landmarks: corpo.landmarks,
      implantes,
      planos: [...PLANOS],
      imfs: [...IMFS],
      lados: "separados",
      ...(corpo.pinca_polo_superior_mm ? { pinca_polo_superior_mm: corpo.pinca_polo_superior_mm } : {}),
    });
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "criou", entidade: "arquivo", entidadeId: m.id, desenho, detalhes: { operacao: "morphs", implantes } });
    return json(manifest);
  } catch (e) {
    return tratarErro(e, "malhas.morphs");
  }
}
