import { landmarksSchema, uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { bloquearSeDesligado, erro, json, lerJson, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { malhaPorId } from "@/db/repositorio";
import { distanciasEuclidianas } from "@/medidas/geometria";
import { ClienteMesh } from "@/mesh/cliente";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ malha_id: uuidSchema, landmarks: landmarksSchema });

/**
 * POST /api/medidas/medir — PRÉVIA de geodésicas e volume via services/mesh (não grava).
 * DESENHO=A → 403 `desligado_no_desenho_a` antes de qualquer acesso a banco ou rede.
 */
export async function POST(req: Request) {
  const bloqueio = bloquearSeDesligado("medicao_automatica_3d");
  if (bloqueio) return bloqueio;
  try {
    const desenho = getDesenho();
    const corpo = corpoSchema.parse(await lerJson(req));
    const m = await malhaPorId(corpo.malha_id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const euclidianas = Object.fromEntries(Object.entries(distanciasEuclidianas(corpo.landmarks)).filter(([, v]) => v !== null)) as Record<string, number>;
    const r = await new ClienteMesh({ desenho }).medir(m.malha_dir, corpo.landmarks, euclidianas);
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "malhas", entidadeId: m.id, desenho, detalhes: { operacao: "medir_previa" } });
    return json(r);
  } catch (e) {
    return tratarErro(e, "medidas.medir");
  }
}
