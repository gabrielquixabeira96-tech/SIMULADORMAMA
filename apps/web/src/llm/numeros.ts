import type { Desenho, Distancias, MedidasDigitadas, Volumes } from "@simulador/contratos";
import { recursoAtivoEm } from "@/config/recursos";
import { extrairNumeros, valorDeDigitos } from "./extrairNumeros";

/**
 * Guarda dos "números calculados no texto do LLM" (ADR 0005/0006; contratos §14.3).
 * Regras (o relatório do Marco 2b usa este módulo):
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
  // Rótulos do catálogo (ex.: referência "RSM-105+") são dados do catálogo, não calculados.
  for (const it of dados.implantes_mostrados) for (const n of extrairNumeros(it.rotulo)) nums.push(n.valor);
  coletarNumeros(dados.medidas_digitadas, nums);
  coletarNumeros(dados.distancias, nums);
  coletarNumeros(dados.volumes, nums);
  return [...new Set(nums.flatMap(representacoes))].sort();
}

export const REGEX_NUMERO = /\d+([.,]\d+)?/g;

export interface Intruso {
  /** Parágrafo/seção onde apareceu. */
  secao: string;
  texto: string;
  valor: number;
  forma: "digitos" | "extenso";
}

export interface VerificacaoNumeros {
  ok: boolean;
  /** Trechos recusados, na ordem em que aparecem (compatível com a versão anterior). */
  intrusos: string[];
  detalhes: Intruso[];
}

const TOLERANCIA = 1e-9;

/** Valores numéricos aceitos a partir das representações textuais de `numeros_permitidos`. */
export function valoresPermitidos(permitidos: readonly string[]): number[] {
  const out = new Set<number>();
  for (const s of permitidos) {
    const v = valorDeDigitos(s);
    if (Number.isFinite(v)) out.add(v);
  }
  return [...out];
}

/**
 * Teste travado (ADR 0006 item 6): TODO número da prosa, em dígitos (vírgula ou ponto decimal,
 * milhar pt-BR) ou por extenso, deve ter o MESMO valor de algum item de `permitidos`. Valor
 * arredondado não passa ("212,3" quando o dado é 212,34 é recusado).
 */
export function verificarNumeros(paragrafos: Record<string, string>, permitidos: readonly string[]): VerificacaoNumeros {
  const exatos = new Set(permitidos);
  const valores = valoresPermitidos(permitidos);
  const detalhes: Intruso[] = [];
  for (const [secao, texto] of Object.entries(paragrafos)) {
    for (const n of extrairNumeros(texto)) {
      if (n.forma === "digitos" && exatos.has(n.texto)) continue;
      if (valores.some((v) => Math.abs(v - n.valor) <= TOLERANCIA)) continue;
      detalhes.push({ secao, ...n });
    }
  }
  return { ok: detalhes.length === 0, intrusos: detalhes.map((d) => d.texto), detalhes };
}
