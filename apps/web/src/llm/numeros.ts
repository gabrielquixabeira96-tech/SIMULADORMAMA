import type { Desenho, Distancias, MedidasDigitadas, Volumes } from "@simulador/contratos";
import { recursoAtivoEm } from "@/config/recursos";

/**
 * Guarda dos "números calculados no texto do LLM" (ADR 0005/0006; contratos §14.3).
 * O relatório ainda não existe (Marco 2b); este módulo já fixa a regra:
 * - `montarDadosTravados` zera distâncias e volumes em DESENHO=A;
 * - `numerosPermitidos` só contém o que o template exibirá;
 * - `verificarNumeros` recusa prosa com qualquer número fora da lista.
 */

export interface ImplanteMostrado {
  id: string;
  rotulo: string;
  plano: "subglandular" | "dual_plane";
  imf: "manter" | "rebaixar";
  base_mm?: number;
  projecao_mm?: number;
  volume_ml?: number;
}

export interface DadosTravados {
  implantes_mostrados: ImplanteMostrado[];
  medidas_digitadas: MedidasDigitadas | null;
  distancias: Distancias | null;
  volumes: Volumes | null;
}

export function montarDadosTravados(
  entrada: { implantes: ImplanteMostrado[]; medidasDigitadas: MedidasDigitadas | null; distancias: Distancias | null; volumes: Volumes | null },
  desenho: Desenho,
): DadosTravados {
  const calculados = recursoAtivoEm(desenho, "numeros_calculados_no_relatorio");
  return {
    implantes_mostrados: entrada.implantes,
    medidas_digitadas: entrada.medidasDigitadas,
    distancias: calculados ? entrada.distancias : null,
    volumes: calculados && recursoAtivoEm(desenho, "volume_calculado") ? entrada.volumes : null,
  };
}

/** Representações textuais aceitas de um número: "300", "4,5", "4.5", "212,3", "212.30". */
export function representacoes(n: number): string[] {
  // Só representações sem perda em relação ao valor serializado (2 casas).
  const alvo = Number(n.toFixed(2));
  const out = new Set<string>();
  for (const casas of [0, 1, 2]) {
    const s = n.toFixed(casas);
    if (Number(s) !== alvo) continue;
    out.add(s);
    out.add(s.replace(".", ","));
  }
  return [...out];
}

function coletarNumeros(v: unknown, acc: number[]): void {
  if (typeof v === "number" && Number.isFinite(v)) acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => coletarNumeros(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => coletarNumeros(x, acc));
}

export function numerosPermitidos(dados: DadosTravados, extras: number[] = []): string[] {
  const nums: number[] = [...extras];
  coletarNumeros(dados.implantes_mostrados.map(({ base_mm, projecao_mm, volume_ml }) => ({ base_mm, projecao_mm, volume_ml })), nums);
  coletarNumeros(dados.medidas_digitadas, nums);
  coletarNumeros(dados.distancias, nums);
  coletarNumeros(dados.volumes, nums);
  return [...new Set(nums.flatMap(representacoes))].sort();
}

export const REGEX_NUMERO = /\d+([.,]\d+)?/g;

export interface VerificacaoNumeros {
  ok: boolean;
  intrusos: string[];
}

/** Toda sequência numérica da prosa deve pertencer a `permitidos` (teste travado, ADR 0006). */
export function verificarNumeros(paragrafos: Record<string, string>, permitidos: readonly string[]): VerificacaoNumeros {
  const set = new Set(permitidos);
  const intrusos: string[] = [];
  for (const texto of Object.values(paragrafos)) {
    for (const m of texto.matchAll(REGEX_NUMERO)) if (!set.has(m[0])) intrusos.push(m[0]);
  }
  return { ok: intrusos.length === 0, intrusos };
}
