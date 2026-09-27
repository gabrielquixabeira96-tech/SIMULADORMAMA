import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { uuidSchema } from "@simulador/contratos";
import { erro, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir, usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { registrarAuditoria } from "@/db/auditoria";
import { malhaPorId } from "@/db/repositorio";
import { redigirPrevistoManifest, tipoDoArquivo } from "@/malhas/arquivos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/malhas/<id>/arquivo?nome=processada.glb — nunca de public/; auditado; sem cache. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const desenho = getDesenho();
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return erro(400, "id_invalido", "id deve ser uuid");
    const nome = new URL(req.url).searchParams.get("nome") ?? "";
    const tipo = tipoDoArquivo(nome);
    if (!tipo) return erro(400, "nome_nao_permitido", "arquivo fora da lista permitida");
    const m = await malhaPorId(id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");
    const abs = caminhoEmDataDir(`${m.malha_dir}/${nome}`);
    let tamanho: number;
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new Error("não é arquivo");
      tamanho = s.size;
    } catch {
      return erro(404, "arquivo_nao_encontrado", "arquivo não encontrado");
    }
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "arquivo", entidadeId: m.id, desenho, detalhes: { nome } });
    if (nome === "morphs/manifest.json" && !recursoAtivoEm(desenho, "numeros_calculados_no_relatorio")) {
      // Em A o manifest sai sem `previsto` (números calculados; ADR 0005), mesmo que o arquivo em
      // disco tenha sido gerado em B.
      const redigido = JSON.stringify(redigirPrevistoManifest(JSON.parse(await readFile(abs, "utf8")), false));
      return new Response(redigido, {
        status: 200,
        headers: { "Content-Type": tipo, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    const corpo = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
    return new Response(corpo, {
      status: 200,
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(tamanho),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return tratarErro(e, "malhas.arquivo");
  }
}
