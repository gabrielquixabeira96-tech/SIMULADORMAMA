import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { benchmarkHabilitado } from "@/benchmark/servidor";
import { configPublica } from "@/config/publica";
import { BenchmarkLatencia } from "@/simulacao/BenchmarkLatencia";

// A flag é lida em runtime no servidor (nunca no build nem no cliente).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Benchmark de latência — simulador mamário" };

/**
 * /benchmark — benchmark de latência da simulação para o hardware-alvo (iPad). Só existe com
 * `BENCHMARK_HABILITADO=1` no servidor; sem a variável, 404. Torso sintético apenas.
 */
export default function PaginaBenchmark() {
  if (!benchmarkHabilitado()) notFound();
  const config = configPublica();
  return (
    <>
      <header className="cabecalho">
        <h1>Benchmark de latência da simulação</h1>
        <p className="nota">
          Torso sintético paramétrico (nenhum dado de paciente). Mede, NESTE aparelho, do toque/arraste até o quadro desenhado: slider antes/depois, troca de plano/IMF e de implante (1 painel) e
          slider na comparação lado a lado (2 painéis). Deixe a aba em primeiro plano e o aparelho sem outras tarefas durante a medição.
        </p>
      </header>
      <BenchmarkLatencia versaoSoftware={config.versao_software} envelopeMm={config.envelope_rms_mm} />
    </>
  );
}
