import { log } from "@/log/logger";
import { getDesenho } from "./desenho";

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
    if (!process.env.APP_TOKEN_LOCAL) log.warn("token_local_desligado", { motivo: "APP_TOKEN_LOCAL ausente (só aceito em next dev)" });
    log.info("servidor_subindo", { desenho });
  } catch (e) {
    log.error("inicializacao_recusada", { erro: e });
    process.exit(1);
  }
}
