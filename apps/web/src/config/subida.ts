import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "@/log/logger";
import { hostsForaDoLoopback, modoBenchmarkNaRede } from "@/seguranca/requisicao";
import { dataDir } from "./ambiente";
import { getDesenho } from "./desenho";

/**
 * Exceção controlada do ADR 0003 (revisão v0.1.2): benchmark alcançável pela rede local só numa
 * instância SEPARADA e sem dados de paciente. No modo "benchmark na rede" (`BENCHMARK_HABILITADO=1`
 * e algum host fora do loopback em `APP_HOSTS_PERMITIDOS`), a subida é recusada se `DATABASE_URL`
 * estiver definido (os pacientes vivem no Postgres; o benchmark não usa banco) ou se
 * `DATA_DIR/pacientes` existir.
 */
export function verificarBenchmarkNaRede(
  env: { BENCHMARK_HABILITADO?: string | undefined; APP_HOSTS_PERMITIDOS?: string | undefined; DATABASE_URL?: string | undefined },
  existePacientes: () => boolean,
): void {
  if (!modoBenchmarkNaRede(env)) return;
  const hosts = hostsForaDoLoopback(env.APP_HOSTS_PERMITIDOS).join(", ");
  const base = `BENCHMARK_HABILITADO=1 com APP_HOSTS_PERMITIDOS fora do loopback (${hosts}) é instância só de benchmark (ADR 0003, revisão v0.1.2)`;
  if ((env.DATABASE_URL ?? "").trim() !== "") throw new Error(`${base}: DATABASE_URL tem de ficar vazio`);
  if (existePacientes()) throw new Error(`${base}: exige um DATA_DIR sem pacientes/`);
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
    verificarBenchmarkNaRede({ BENCHMARK_HABILITADO: process.env.BENCHMARK_HABILITADO, APP_HOSTS_PERMITIDOS: process.env.APP_HOSTS_PERMITIDOS, DATABASE_URL: process.env.DATABASE_URL }, () => existsSync(join(dataDir(), "pacientes")));
    if (!process.env.APP_TOKEN_LOCAL) log.warn("token_local_desligado", { motivo: "APP_TOKEN_LOCAL ausente (só aceito em next dev)" });
    log.info("servidor_subindo", { desenho });
  } catch (e) {
    log.error("inicializacao_recusada", { erro: e });
    process.exit(1);
  }
}
