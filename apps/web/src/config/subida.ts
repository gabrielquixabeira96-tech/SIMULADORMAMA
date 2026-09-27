import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "@/log/logger";
import { hostsForaDoLoopback } from "@/seguranca/requisicao";
import { dataDir } from "./ambiente";
import { getDesenho } from "./desenho";

/**
 * Exceção controlada do ADR 0003 (revisão v0.1.2): benchmark alcançável pela rede local só numa
 * instância SEPARADA cujo DATA_DIR não tem `pacientes/`. Com `BENCHMARK_HABILITADO=1` e algum host
 * fora do loopback em `APP_HOSTS_PERMITIDOS`, a existência de `DATA_DIR/pacientes` impede a subida.
 */
export function verificarBenchmarkNaRede(
  env: { BENCHMARK_HABILITADO?: string | undefined; APP_HOSTS_PERMITIDOS?: string | undefined },
  existePacientes: () => boolean,
): void {
  if (env.BENCHMARK_HABILITADO !== "1") return;
  const hosts = hostsForaDoLoopback(env.APP_HOSTS_PERMITIDOS);
  if (hosts.length === 0) return;
  if (existePacientes()) {
    throw new Error(
      `BENCHMARK_HABILITADO=1 com APP_HOSTS_PERMITIDOS fora do loopback (${hosts.join(", ")}) exige um DATA_DIR sem pacientes/ (instância só de benchmark; ADR 0003, revisão v0.1.2)`,
    );
  }
}

/**
 * Chamado por instrumentation.ts (runtime Node): DESENHO inválido → encerra o processo. Em
 * produção (`next start`), `APP_TOKEN_LOCAL` ausente também encerra (ADR 0003 item 7).
 */
export function validarAmbienteNaSubida(): void {
  try {
    const desenho = getDesenho();
    if (process.env.NODE_ENV === "production" && !process.env.APP_TOKEN_LOCAL) {
      throw new Error("APP_TOKEN_LOCAL obrigatório em produção (next start); veja .env.example");
    }
    verificarBenchmarkNaRede({ BENCHMARK_HABILITADO: process.env.BENCHMARK_HABILITADO, APP_HOSTS_PERMITIDOS: process.env.APP_HOSTS_PERMITIDOS }, () => existsSync(join(dataDir(), "pacientes")));
    if (!process.env.APP_TOKEN_LOCAL) log.warn("token_local_desligado", { motivo: "APP_TOKEN_LOCAL ausente (só aceito em next dev)" });
    log.info("servidor_subindo", { desenho });
  } catch (e) {
    log.error("inicializacao_recusada", { erro: e });
    process.exit(1);
  }
}
