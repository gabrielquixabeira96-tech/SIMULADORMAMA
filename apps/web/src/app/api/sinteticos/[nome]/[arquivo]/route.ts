import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { erro, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir } from "@/config/ambiente";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIPOS: Record<string, string> = {
  "torso.glb": "model/gltf-binary",
  "torso.obj": "text/plain; charset=utf-8",
  "torso.mtl": "text/plain; charset=utf-8",
  "textura.png": "image/png",
  "gabarito.json": "application/json",
};

/** GET /api/sinteticos/<nome>/<arquivo> — lista fixa de arquivos do torso sintético. */
export async function GET(_req: Request, ctx: { params: Promise<{ nome: string; arquivo: string }> }) {
  try {
    const { nome, arquivo } = await ctx.params;
    if (!/^[a-z0-9_]+$/.test(nome)) return erro(400, "nome_invalido", "nome de torso inválido");
    const tipo = Object.hasOwn(TIPOS, arquivo) ? TIPOS[arquivo] : undefined;
    if (!tipo) return erro(400, "nome_nao_permitido", "arquivo fora da lista permitida");
    const abs = caminhoEmDataDir(`sinteticos/${nome}/${arquivo}`);
    const s = await stat(abs).catch(() => null);
    if (!s?.isFile()) return erro(404, "arquivo_nao_encontrado", "arquivo não encontrado");
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>, {
      headers: { "Content-Type": tipo, "Content-Length": String(s.size), "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return tratarErro(e, "sinteticos.arquivo");
  }
}
