import { randomInt } from "node:crypto";
import { PSEUDONIMO_REGEX } from "@simulador/contratos";

/** Alfabeto do pseudônimo: 0-9 e A-Z sem I e O (contratos §1.2). */
export const ALFABETO_PSEUDONIMO = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Gera `P-XXXXXX` aleatório (CSPRNG). O vínculo pseudônimo → identidade fica FORA do sistema.
 */
export function gerarPseudonimo(): string {
  let s = "P-";
  for (let i = 0; i < 6; i++) s += ALFABETO_PSEUDONIMO[randomInt(ALFABETO_PSEUDONIMO.length)];
  if (!PSEUDONIMO_REGEX.test(s)) throw new Error("pseudônimo gerado fora do formato");
  return s;
}
