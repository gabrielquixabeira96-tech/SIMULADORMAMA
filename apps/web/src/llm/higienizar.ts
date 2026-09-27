import { createHash } from "node:crypto";
import { REMOVIDO, higienizarTexto } from "@/log/higienizar";

/**
 * Higienização do texto livre ANTES de qualquer envio ao LLM (contratos §14.1; ADR 0006 item 5).
 * Remove: CPF, RG, CNS/prontuário (sequências ≥ 8 dígitos), telefone, e-mail, URL, datas completas
 * e nomes declarados ("meu nome é…", "Nome: …", "paciente Fulana…"). Substitui por `[removido]`.
 * O texto bruto nunca é persistido; só o SHA-256 do texto higienizado.
 */

export { REMOVIDO };

const R = REMOVIDO;
const PALAVRA_NOME = "[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][a-záâãàéêíóôõúç]+";
const SEQ_NOME = `${PALAVRA_NOME}(?:\\s+(?:d[aeo]s?\\s+)?${PALAVRA_NOME}){0,5}`;

const PADROES_LLM: Array<[RegExp, string]> = [
  // URL (http, https, www)
  [/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi, R],
  // RG com rótulo, com ou sem máscara (ex.: "RG 12.345.678-9", "RG: MG-12.345.678")
  [/\bRG\b\s*(?:n[ºo°.]?\s*)?[:.-]?\s*(?:[A-Z]{2}[\s-]?)?[\dXx][\dXx.\s-]{4,}[\dXx]/gi, `RG ${R}`],
  // data completa por extenso ("12 de março de 1990")
  [/\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+\d{4}\b/gi, R],
  // data completa aaaa-mm-dd
  [/\b\d{4}-\d{2}-\d{2}\b/g, R],
  // nome declarado
  [new RegExp(`(?<![\\p{L}])((?:[Mm]eu nome [ée]|[Mm]e chamo|[Cc]hamo-me|[Nn]ome(?: completo)?\\s*:|[Pp]aciente\\s*:?))\\s*${SEQ_NOME}`, "gu"), `$1 ${R}`],
  // sequência longa de dígitos (≥ 8, contígua ou com "." "-" "/"): CNS, prontuário, documento
  [/(?<![\w-])\d[\d./-]{6,}\d(?![\w-])/g, "$DIGITOS8"],
  // grupos de 3-4 dígitos separados por espaço (CNS "123 4567 8901 2345")
  [/(?<![\w-])\d{3,4}(?:\s\d{3,4}){2,}(?![\w-])/g, R],
];

export function higienizarTextoLLM(bruto: string): string {
  let s = higienizarTexto(bruto); // CPF, e-mail, telefone, data dd/mm/aaaa, caminho absoluto
  for (const [re, sub] of PADROES_LLM) {
    s =
      sub === "$DIGITOS8"
        ? s.replace(re, (trecho) => ((trecho.match(/\d/g)?.length ?? 0) >= 8 ? R : trecho))
        : s.replace(re, sub);
  }
  return s;
}

export function sha256Texto(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
