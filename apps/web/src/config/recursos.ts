import type { Desenho } from "@simulador/contratos";

/**
 * Mapa de recursos por desenho (ADR 0005; contratos §13). Módulo puro: pode ser usado no
 * cliente, mas o valor de `desenho` sempre vem do servidor (getDesenho), nunca de NEXT_PUBLIC_*.
 */
export const RECURSOS = [
  "medicao_automatica_3d",
  "volume_calculado",
  "alertas_tepid",
  "sugestao_implante",
  "numeros_calculados_no_relatorio",
] as const;

export type Recurso = (typeof RECURSOS)[number];
export type MapaRecursos = Readonly<Record<Recurso, boolean>>;

const MAPA: Readonly<Record<Desenho, MapaRecursos>> = Object.freeze({
  B: Object.freeze({
    medicao_automatica_3d: true,
    volume_calculado: true,
    alertas_tepid: true,
    sugestao_implante: true,
    numeros_calculados_no_relatorio: true,
  }),
  A: Object.freeze({
    medicao_automatica_3d: false,
    volume_calculado: false,
    alertas_tepid: false,
    sugestao_implante: false,
    numeros_calculados_no_relatorio: false,
  }),
});

export function recursosDoDesenho(desenho: Desenho): MapaRecursos {
  const mapa = MAPA[desenho];
  if (!mapa) throw new Error(`DESENHO inválido: ${String(desenho)}`);
  return mapa;
}

export function recursoAtivoEm(desenho: Desenho, recurso: Recurso): boolean {
  const mapa = recursosDoDesenho(desenho);
  if (!(recurso in mapa)) throw new Error(`recurso desconhecido: ${String(recurso)}`);
  return mapa[recurso];
}

/** Erro lançado quando um recurso desligado no desenho atual é acionado. */
export class RecursoDesligadoError extends Error {
  readonly codigo = "desligado_no_desenho_a" as const;
  constructor(readonly recurso: Recurso) {
    super(`recurso '${recurso}' desligado no desenho A`);
    this.name = "RecursoDesligadoError";
  }
}

export function exigirRecursoEm(desenho: Desenho, recurso: Recurso): void {
  if (!recursoAtivoEm(desenho, recurso)) throw new RecursoDesligadoError(recurso);
}
