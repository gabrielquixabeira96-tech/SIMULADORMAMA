import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { erro, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { redigirGabarito } from "@/malhas/arquivos";
import { torsosComSessaoAberta } from "@/validacao/sessao";

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
    const desenho = getDesenho();
    const { nome, arquivo } = await ctx.params;
    if (!/^[a-z0-9_]+$/.test(nome)) return erro(400, "nome_invalido", "nome de torso inválido");
    const tipo = Object.hasOwn(TIPOS, arquivo) ? TIPOS[arquivo] : undefined;
    if (!tipo) return erro(400, "nome_nao_permitido", "arquivo fora da lista permitida");
    const abs = caminhoEmDataDir(`sinteticos/${nome}/${arquivo}`);
    const s = await stat(abs).catch(() => null);
    if (!s?.isFile()) return erro(404, "arquivo_nao_encontrado", "arquivo não encontrado");
    // Cegueira da sessão de Bland-Altman (ADR 0017): gabarito oculto enquanto houver sessão aberta com o torso.
    if (arquivo === "gabarito.json" && (await torsosComSessaoAberta()).has(nome)) {
      return erro(403, "gabarito_oculto_sessao_aberta", "gabarito oculto: há sessão de validação aberta com este torso");
    }
    const medir = recursoAtivoEm(desenho, "medicao_automatica_3d");
    const volume = recursoAtivoEm(desenho, "volume_calculado");
    if (arquivo === "gabarito.json" && (!medir || !volume)) {
      const g = JSON.parse(await readFile(abs, "utf8")) as Record<string, unknown>;
      return new Response(JSON.stringify(redigirGabarito(g, medir, volume)), { headers: { "Content-Type": tipo, "Cache-Control": "private, no-store" } });
    }
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>, {
      headers: { "Content-Type": tipo, "Content-Length": String(s.size), "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return tratarErro(e, "sinteticos.arquivo");
  }
}
