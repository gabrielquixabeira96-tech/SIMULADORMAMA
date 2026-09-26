import { uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { carregarTepidConfig } from "@/config/arquivosConfig";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { inserirTepid, pacientePorId } from "@/db/repositorio";
import { avaliarTepid, validarValoresTepid } from "@/tepid/avaliar";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ paciente_id: uuidSchema, valores: z.unknown() });

/** POST /api/tepid — grava o TEPID digitado; `alertas` é sempre [] em A. Auditado. */
export async function POST(req: Request) {
  try {
    const desenho = getDesenho();
    const corpo = corpoSchema.parse(await lerJson(req));
    const config = carregarTepidConfig();
    const v = validarValoresTepid(corpo.valores, config);
    if (!v.ok) return erro(400, "valores_invalidos", "valores fora das faixas de config/tepid.json", { erros: v.erros });
    const paciente = await pacientePorId(corpo.paciente_id);
    if (!paciente) return erro(404, "paciente_nao_encontrado", "paciente não encontrado");
    const r = avaliarTepid(v.valores, config, desenho);
    const id = await inserirTepid({ pacienteId: paciente.id, desenho, versaoConfig: config.versao, valores: v.valores, alertas: r.alertas });
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "criou", entidade: "tepid", entidadeId: id, desenho, detalhes: { paciente_id: paciente.id, n_alertas: r.alertas.length } });
    return json({ id, ...r, valores: v.valores, versao_config: config.versao }, 201);
  } catch (e) {
    return tratarErro(e, "tepid.gravar");
  }
}
