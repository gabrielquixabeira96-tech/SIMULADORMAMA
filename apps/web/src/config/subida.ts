import { log } from "@/log/logger";
import { getDesenho } from "./desenho";

/** Chamado por instrumentation.ts (runtime Node): DESENHO inválido → encerra o processo. */
export function validarAmbienteNaSubida(): void {
  try {
    log.info("servidor_subindo", { desenho: getDesenho() });
  } catch (e) {
    log.error("inicializacao_recusada", { erro: e });
    process.exit(1);
  }
}
