import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { erro, tratarErro } from "@/api/respostas";
import { benchmarkHabilitado, caminhoArquivoBenchmark } from "@/benchmark/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/benchmark/arquivo?nome=morphs/<plano>__<imf>.glb — só os 4 .glb de morphs do torso
 * sintético do benchmark (lista fixa). Sem `BENCHMARK_HABILITADO=1`: 404.
 */
export async function GET(req: Request) {
  if (!benchmarkHabilitado()) return erro(404, "nao_encontrado", "rota não encontrada");
  try {
    const nome = new URL(req.url).searchParams.get("nome") ?? "";
    const abs = caminhoArquivoBenchmark(nome);
    if (!abs) return erro(400, "nome_nao_permitido", "arquivo fora da lista permitida");
    const s = await stat(abs).catch(() => null);
    if (!s?.isFile()) return erro(404, "arquivo_nao_encontrado", "arquivo não encontrado (rode POST /api/benchmark antes)");
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(s.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return tratarErro(e, "benchmark.arquivo");
  }
}
