/**
 * Extração de TODOS os números de um texto em português do Brasil, para o teste travado do
 * relatório (ADR 0006 item 6). Cobre:
 *  - dígitos com vírgula decimal ("4,5"), ponto decimal ("4.5") e milhar pt-BR ("1.000", "1.000,5");
 *  - números por extenso ("trezentos", "vinte e cinco", "quatro vírgula cinco", "mil e duzentos").
 *
 * Decisões (documentadas porque afetam o que é "número"):
 *  - "um"/"uma" isolados são artigo, não número (senão toda frase seria recusada); contam quando
 *    compõem número ("vinte e um", "um vírgula cinco", "um mil").
 *  - "cento" isolado depois de "por" é "por cento" (não 100).
 *  - "meio"/"meia" só contam depois de "e" dentro de um número ("trezentos e meio").
 *  - Ordinais ("primeira", "segundo") não são números.
 *  - "d{1,3}.ddd" (grupos de 3 depois do ponto) é milhar pt-BR; demais "." e "," são decimal.
 *  - O texto é normalizado com NFKC antes da extração: dígitos de largura total ("３２０"),
 *    sobrescritos e frações Unicode viram dígitos ASCII e são verificados normalmente.
 *  - Numeral NÃO ASCII que sobrar depois do NFKC (`\p{N}`: "٣٢٠", "३२०", "〇"…) é sempre recusado
 *    (forma "nao_ascii"): o relatório só escreve dígitos ASCII.
 *  - Numeral romano (≥ 2 letras maiúsculas válidas: "CCCXX", "XIV") é sempre recusado (forma "romano").
 *  - Palavras de quantidade ("dezena(s)", "centena(s)", "milhar(es)", "dúzia", "dobro", "triplo",
 *    "metade", "um terço"…) são sempre recusadas (forma "quantidade"): exprimem número sem dígito.
 */

export interface NumeroEncontrado {
  /** Trecho do texto original (dígitos) ou das palavras normalizadas (extenso). */
  texto: string;
  valor: number;
  forma: FormaNumero;
}

export type FormaNumero = "digitos" | "extenso" | "nao_ascii" | "romano" | "quantidade";

export const REGEX_DIGITOS = /[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]+)?|[0-9]+(?:[.,][0-9]+)?/g;

/** Qualquer numeral Unicode que não seja dígito ASCII (depois do NFKC). */
const REGEX_NAO_ASCII = /(?:(?![0-9])\p{N})+/gu;
/** Romano válido com ≥ 2 letras (evita "D"/"E" de direita/esquerda e o "I" isolado). */
const REGEX_ROMANO = /(?<![\p{L}\p{N}])(?=[MDCLXVI]{2,}(?![\p{L}\p{N}]))M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?![\p{L}\p{N}])/gu;
const ROMANOS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** Palavras que exprimem quantidade sem ser numeral (normalizadas sem acento, minúsculas). */
export const PALAVRAS_QUANTIDADE: Record<string, number> = {
  dezena: 10, dezenas: 10, centena: 100, centenas: 100, milhar: 1000, milhares: 1000, milheiro: 1000,
  duzia: 12, duzias: 12, dobro: 2, triplo: 3, quadruplo: 4, quintuplo: 5, sextuplo: 6, decuplo: 10, centuplo: 100,
  metade: 0.5, metades: 0.5, terco: 1 / 3, tercos: 1 / 3, quarto: 0.25, quartos: 0.25,
};
/** Frações que também são termo anatômico/comum ("terço inferior", "quarto"): só contam depois de numeral ("um terço"). */
const SO_APOS_NUMERAL = new Set(["terco", "tercos", "quarto", "quartos"]);

/** Converte a representação em dígitos (pt-BR ou com ponto decimal) em número. */
export function valorDeDigitos(s: string): number {
  const t = s.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(",", "."));
}

const VALORES: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezassete: 17,
  dezoito: 18,
  dezenove: 19,
  dezanove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};
const MULTIPLICADORES: Record<string, number> = { mil: 1000, milhao: 1_000_000, milhoes: 1_000_000, bilhao: 1e9, bilhoes: 1e9 };
const DECIMAL = new Set(["virgula", "ponto"]);
const MEIO = new Set(["meio", "meia"]);

const ehNumeral = (w: string | undefined): boolean => w !== undefined && (w in VALORES || w in MULTIPLICADORES);

function normalizarPalavras(texto: string): string[] {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // hífen entre palavras não une números ("vinte-e-um" é raro; tratar como separador)
      .match(/[a-z]+|\d+(?:[.,]\d+)*/g) ?? []
  );
}

/** Lê um inteiro por extenso a partir de `i`; devolve valor, próximo índice e palavras consumidas. */
function lerInteiro(p: string[], i: number): { valor: number; fim: number; usadas: string[] } | null {
  if (!ehNumeral(p[i])) return null;
  let total = 0;
  let grupo = 0;
  let j = i;
  const usadas: string[] = [];
  for (;;) {
    const w = p[j];
    if (w !== undefined && w in VALORES) {
      grupo += VALORES[w]!;
      usadas.push(w);
      j++;
    } else if (w !== undefined && w in MULTIPLICADORES) {
      total += (grupo || 1) * MULTIPLICADORES[w]!;
      grupo = 0;
      usadas.push(w);
      j++;
    } else break;
    // "e" liga partes do mesmo número ("vinte e cinco", "mil e duzentos") ou "e meio"
    if (p[j] === "e" && (ehNumeral(p[j + 1]) || MEIO.has(p[j + 1] ?? ""))) {
      if (MEIO.has(p[j + 1]!)) {
        grupo += 0.5;
        usadas.push("e", p[j + 1]!);
        j += 2;
        break;
      }
      usadas.push("e");
      j++;
      continue;
    }
    // Sem "e": continua só se for multiplicador ("duzentos mil") ou após multiplicador ("mil duzentos")
    if (w !== undefined && (w in MULTIPLICADORES ? ehNumeral(p[j]) : p[j] !== undefined && p[j]! in MULTIPLICADORES)) continue;
    break;
  }
  return { valor: total + grupo, fim: j, usadas };
}

/** Parte decimal por extenso: dígitos soletrados ("zero cinco") ou um inteiro ("vinte e cinco"). */
function lerDecimal(p: string[], i: number): { digitos: string; fim: number; usadas: string[] } | null {
  // soletrado: sequência de palavras de 0 a 9 sem "e"
  let j = i;
  let soletrado = "";
  const usadas: string[] = [];
  while (p[j] !== undefined && p[j]! in VALORES && VALORES[p[j]!]! <= 9 && !(p[j + 1] === "e")) {
    soletrado += String(VALORES[p[j]!]);
    usadas.push(p[j]!);
    j++;
  }
  if (soletrado.length > 1) return { digitos: soletrado, fim: j, usadas };
  const inteiro = lerInteiro(p, i);
  if (!inteiro) return null;
  return { digitos: String(inteiro.valor), fim: inteiro.fim, usadas: inteiro.usadas };
}

/** Números por extenso em um texto. */
export function extrairNumerosPorExtenso(texto: string): NumeroEncontrado[] {
  const p = normalizarPalavras(texto);
  const out: NumeroEncontrado[] = [];
  let i = 0;
  while (i < p.length) {
    const inteiro = lerInteiro(p, i);
    if (!inteiro) {
      i++;
      continue;
    }
    let valor = inteiro.valor;
    let fim = inteiro.fim;
    const usadas = [...inteiro.usadas];
    if (DECIMAL.has(p[fim] ?? "")) {
      const dec = lerDecimal(p, fim + 1);
      if (dec) {
        valor = Number(`${Math.trunc(valor)}.${dec.digitos}`) + (valor % 1);
        usadas.push(p[fim]!, ...dec.usadas);
        fim = dec.fim;
      }
    }
    const artigo = usadas.length === 1 && (usadas[0] === "um" || usadas[0] === "uma");
    const porCento = usadas.length === 1 && usadas[0] === "cento" && p[i - 1] === "por";
    if (!artigo && !porCento) out.push({ texto: usadas.join(" "), valor, forma: "extenso" });
    i = fim;
  }
  return out;
}

/** Números em dígitos (qualquer formato pt-BR/en com separador único). */
export function extrairNumerosEmDigitos(texto: string): NumeroEncontrado[] {
  return [...texto.matchAll(REGEX_DIGITOS)].map((m) => ({ texto: m[0], valor: valorDeDigitos(m[0]), forma: "digitos" as const }));
}

function valorRomano(s: string): number {
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMANOS[s[i]!]!;
    const prox = ROMANOS[s[i + 1] ?? ""] ?? 0;
    t += v < prox ? -v : v;
  }
  return t;
}

/** Numerais não ASCII (depois do NFKC) e romanos: sempre recusados pelo verificador. */
export function extrairNumeraisProibidos(texto: string): NumeroEncontrado[] {
  const t = texto.normalize("NFKC");
  const out: NumeroEncontrado[] = [];
  for (const m of t.matchAll(REGEX_NAO_ASCII)) out.push({ texto: m[0], valor: Number.NaN, forma: "nao_ascii" });
  for (const m of t.matchAll(REGEX_ROMANO)) if (m[0]) out.push({ texto: m[0], valor: valorRomano(m[0]), forma: "romano" });
  return out;
}

/**
 * Palavras de quantidade ("dezenas", "dobro", "metade", "dúzia"…): sempre recusadas. "terço" e
 * "quarto" só contam depois de numeral ("um terço", "três quartos"), para não pegar "terço inferior".
 */
export function extrairPalavrasDeQuantidade(texto: string): NumeroEncontrado[] {
  const p = normalizarPalavras(texto.normalize("NFKC"));
  const out: NumeroEncontrado[] = [];
  p.forEach((w, i) => {
    if (!(w in PALAVRAS_QUANTIDADE)) return;
    if (SO_APOS_NUMERAL.has(w) && !ehNumeral(p[i - 1])) return;
    out.push({ texto: w, valor: Number.NaN, forma: "quantidade" });
  });
  return out;
}

/** Todos os números do texto (NFKC): dígitos + extenso + numerais proibidos + palavras de quantidade. */
export function extrairNumeros(texto: string): NumeroEncontrado[] {
  const t = texto.normalize("NFKC");
  return [...extrairNumerosEmDigitos(t), ...extrairNumerosPorExtenso(t), ...extrairNumeraisProibidos(t), ...extrairPalavrasDeQuantidade(t)];
}
