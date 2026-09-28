import { readFile } from "node:fs/promises";
import { uuidSchema } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir } from "@/config/ambiente";
import { torsoUtilizavel } from "@/config/demo";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { pacientePorId } from "@/db/repositorio";
import { registrarMalha } from "@/malhas/registrar";
import { ErroUpload, prepararUpload, type ArquivoUpload } from "@/malhas/upload";
import { bloqueioGabarito, gabaritoBloqueado } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.strictObject({ paciente_id: uuidSchema });
const gabaritoSchema = z
  .object({
    esquema: z.literal("gabarito/1.0"),
    landmarks: z.record(z.string(), z.object({ posicao: z.tuple([z.number(), z.number(), z.number()]) }).passthrough()),
    distancias: z.record(z.string(), z.object({ euclidiana_mm: z.number(), geodesica_mm: z.number().nullable() }).nullable()),
  })
  .passthrough();

/**
 * POST /api/sinteticos/<nome>/importar — o torso sintético entra pelo MESMO caminho de uma
 * malha enviada (ADR 0003 item 9): cópia para pacientes/<pseudonimo>/malhas/<id>/original,
 * /processar, registro `sintetica=true` e auditoria. Devolve também o gabarito (não é dado de
 * paciente) para conferência e para os landmarks `origem: "gabarito"`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ nome: string }> }) {
  try {
    const desenho = getDesenho();
    const { nome } = await ctx.params;
    if (!/^[a-z0-9_]+$/.test(nome)) return erro(400, "nome_invalido", "nome de torso inválido");
    // modo demo (ADR 0018): só torsos gerados pelo services/mesh
    if (!(await torsoUtilizavel(nome))) return erro(404, "torso_nao_encontrado", "torso sintético não encontrado");
    const corpo = corpoSchema.parse(await lerJson(req));
    const paciente = await pacientePorId(corpo.paciente_id);
    if (!paciente) return erro(404, "paciente_nao_encontrado", "paciente não encontrado");
    const entradas: ArquivoUpload[] = [];
    for (const a of ["torso.obj", "torso.mtl", "textura.png"]) {
      try {
        entradas.push({ nome: a, dados: new Uint8Array(await readFile(caminhoEmDataDir(`sinteticos/${nome}/${a}`))) });
      } catch {
        if (a === "torso.obj") return erro(404, "torso_nao_encontrado", "torso sintético não encontrado");
      }
    }
    let gabarito: z.infer<typeof gabaritoSchema> | null = null;
    // Cegueira da sessão de Bland-Altman (ADR 0017): sem gabarito enquanto houver sessão aberta com o torso.
    const bloqueado = gabaritoBloqueado(await bloqueioGabarito(), nome);
    if (!bloqueado) {
      try {
        gabarito = gabaritoSchema.parse(JSON.parse(await readFile(caminhoEmDataDir(`sinteticos/${nome}/gabarito.json`), "utf8")));
      } catch {
        gabarito = null;
      }
    }
    const r = await registrarMalha({ paciente, upload: prepararUpload(entradas), unidade: "mm", recorte: "abaixo_do_pescoco", sintetica: true, desenho, origem: "sintetico" });
    // Em A nenhuma distância sai para a UI, nem as do gabarito (ADR 0005); os landmarks servem de âncora.
    const distancias = recursoAtivoEm(desenho, "medicao_automatica_3d") ? gabarito?.distancias ?? null : null;
    return json({ ...r, torso: nome, gabarito: gabarito ? { landmarks: gabarito.landmarks, distancias } : null, gabarito_bloqueado: bloqueado }, 201);
  } catch (e) {
    if (e instanceof ErroUpload) return erro(e.status, e.codigo, e.message);
    return tratarErro(e, "sinteticos.importar");
  }
}
