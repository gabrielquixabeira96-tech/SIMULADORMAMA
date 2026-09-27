import { erro, json, tratarErro } from "@/api/respostas";
import { IMPLANTES_BENCHMARK, TORSO_BENCHMARK, benchmarkHabilitado, prepararBenchmark } from "@/benchmark/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/benchmark — prepara o torso sintético e os morphs do benchmark de latência (página
 * /benchmark). Sem `BENCHMARK_HABILITADO=1` no servidor: 404, como se a rota não existisse.
 * Devolve o manifest sem números previstos; não toca em pacientes nem no banco.
 */
export async function POST() {
  if (!benchmarkHabilitado()) return erro(404, "nao_encontrado", "rota não encontrada");
  try {
    const manifest = await prepararBenchmark();
    return json({ torso: TORSO_BENCHMARK, implantes: IMPLANTES_BENCHMARK, manifest });
  } catch (e) {
    return tratarErro(e, "benchmark.preparar");
  }
}
