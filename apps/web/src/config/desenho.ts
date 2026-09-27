import type { Desenho } from "@simulador/contratos";
import { log } from "@/log/logger";
import { exigirRecursoEm, recursoAtivoEm, recursosDoDesenho, type MapaRecursos, type Recurso } from "./recursos";

let avisouAusente = false;

/**
 * Lê a flag regulatória `DESENHO` (ADR 0005). SÓ NO SERVIDOR.
 * Ausente → "B" (padrão local) com aviso; inválida → lança (o processo não deve subir).
 */
export function getDesenho(): Desenho {
  const bruto = process.env.DESENHO;
  if (bruto === undefined || bruto.trim() === "") {
    if (!avisouAusente) {
      avisouAusente = true;
      log.warn("desenho_ausente_usando_B", {});
    }
    return "B";
  }
  const v = bruto.trim();
  if (v !== "A" && v !== "B") {
    throw new Error(`DESENHO inválido: '${v}' (use A ou B)`);
  }
  return v;
}

/** Única forma de consultar a flag no código do servidor. */
export function recursoAtivo(recurso: Recurso): boolean {
  return recursoAtivoEm(getDesenho(), recurso);
}

export function exigirRecurso(recurso: Recurso): void {
  exigirRecursoEm(getDesenho(), recurso);
}

export function recursosAtuais(): MapaRecursos {
  return recursosDoDesenho(getDesenho());
}

export type { Recurso, MapaRecursos };
