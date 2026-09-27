import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { carregarTepidConfig } from "@/config/arquivosConfig";
import { getDesenho } from "@/config/desenho";
import { avaliarTepid, validarValoresTepid } from "@/tepid/avaliar";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ valores: z.unknown() });

/**
 * POST /api/tepid/avaliar — valida faixas (sempre) e avalia regras/tabelas (só em B).
 * Não grava nada. Em A a resposta traz `alertas: []` e `referencias: []`.
 */
export async function POST(req: Request) {
  try {
    const desenho = getDesenho();
    const corpo = corpoSchema.parse(await lerJson(req));
    const config = carregarTepidConfig();
    const v = validarValoresTepid(corpo.valores, config);
    if (!v.ok) return erro(400, "valores_invalidos", "valores fora das faixas de config/tepid.json", { erros: v.erros });
    const r = avaliarTepid(v.valores, config, desenho);
    return json({ ...r, valores: v.valores, versao_config: config.versao, status_config: config.status, nota: config.fonte.nota });
  } catch (e) {
    return tratarErro(e, "tepid.avaliar");
  }
}
