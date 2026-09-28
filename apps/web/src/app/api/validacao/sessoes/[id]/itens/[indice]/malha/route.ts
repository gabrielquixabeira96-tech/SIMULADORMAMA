import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { bloquearSeDesligado, erro } from "@/api/respostas";
import { caminhoEmDataDir } from "@/config/ambiente";
import { auditarSessao, erroValidacao, indiceDeParam, RECURSO_VALIDACAO } from "@/validacao/http";
import { lerSessao, malhaDoItem } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/validacao/sessoes/<id>/itens/<indice>/malha — GLB processado do scan do item (mesma
 * ordem de vértices do processada.obj usado pelo /medir). O endereço usa só o índice do item: o
 * nome do torso não aparece para o cliente. Só com a sessão aberta.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; indice: string }> }) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const { id, indice } = await ctx.params;
    const s = await lerSessao(id);
    if (s.estado !== "aberta") return erro(409, "sessao_nao_aberta", `sessão ${s.estado}`);
    const i = indiceDeParam(indice);
    const malhaDir = await malhaDoItem(s, i);
    const abs = caminhoEmDataDir(`${malhaDir}/processada.glb`);
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) return erro(404, "arquivo_nao_encontrado", "malha processada não encontrada");
    await auditarSessao("visualizou", s.id, { operacao: "malha_item", indice: i });
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>, {
      headers: { "Content-Type": "model/gltf-binary", "Content-Length": String(st.size), "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.malha");
  }
}
