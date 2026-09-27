/**
 * Detecção heurística de NOME PRÓPRIO em texto livre (LGPD; ADR 0006 item 5; revisão v0.1.1).
 * Sem dependência pesada (nada de NER): três sinais, cada um suficiente para recusar o envio.
 *
 *  1. Pronome de tratamento seguido de palavra capitalizada: "Sra. Ana", "Dona Joana",
 *     "Sr João", "Dr. Paulo", "Seu Antônio", "Srta. Luíza".
 *  2. Prenome brasileiro comum (lista abaixo), capitalizado, em qualquer posição: "Maria, 32 anos".
 *  3. Sequência de ≥ 2 palavras capitalizadas (com "de/da/do/dos/das/e" entre elas) FORA do início
 *     da frase: "…encaminhada por Carla Mendes Rocha…".
 *
 * Palavras de `NAO_NOMES` (fabricantes do catálogo, meses, termos clínicos capitalizados) não contam.
 * A detecção roda DEPOIS da higienização (`higienizarTextoLLM`), que já substitui nomes declarados
 * ("meu nome é…", "Paciente: …") por `[removido]`; o que sobrar é recusado com 422.
 */

const MAI = "A-ZÁÂÃÀÉÊÍÓÔÕÚÇ";
const MIN = "a-záâãàéêíóôõúçü";
const PALAVRA_CAP = `[${MAI}][${MIN}]+`;

/** Prenomes brasileiros frequentes (IBGE, Censo 2010), sem os que também são palavras comuns. */
export const PRENOMES = new Set(
  [
    "Maria", "Ana", "Francisca", "Antônia", "Antonia", "Adriana", "Juliana", "Márcia", "Marcia", "Fernanda", "Patrícia", "Patricia",
    "Aline", "Sandra", "Camila", "Amanda", "Bruna", "Jéssica", "Jessica", "Letícia", "Leticia", "Júlia", "Julia", "Luciana",
    "Vanessa", "Mariana", "Gabriela", "Vera", "Simone", "Beatriz", "Larissa", "Cláudia", "Claudia", "Rafaela", "Carla",
    "Daniela", "Renata", "Tatiane", "Priscila", "Bianca", "Cristiane", "Joana", "Joaquina", "Luiza", "Luísa", "Luisa", "Luíza",
    "Isabela", "Isabel", "Sofia", "Sophia", "Alice", "Helena", "Laura", "Valentina", "Manuela", "Giovanna", "Heloísa", "Heloisa",
    "Lorena", "Lívia", "Livia", "Rita", "Sônia", "Sonia", "Tereza", "Teresa", "Raimunda", "Josefa", "Lúcia", "Lucia", "Eliane",
    "Regina", "Rosana", "Débora", "Debora", "Natália", "Natalia", "Carolina", "Paula", "Raquel", "Tânia", "Tania", "Kelly",
    "Andréa", "Andrea", "Michele", "Elaine", "Viviane", "Silvana", "Rosângela", "Rosangela", "Fabiana", "Denise", "Mônica",
    "Monica", "Roberta", "Thaís", "Thais", "Yasmin", "Clara", "Cecília", "Cecilia", "Eduarda", "Emanuelly", "Rebeca",
    "José", "Jose", "João", "Joao", "Antônio", "Antonio", "Francisco", "Carlos", "Paulo", "Pedro", "Lucas", "Luiz", "Luís",
    "Marcos", "Gabriel", "Rafael", "Daniel", "Marcelo", "Bruno", "Eduardo", "Felipe", "Raimundo", "Rodrigo", "Manoel", "Manuel",
    "Mateus", "André", "Andre", "Fernando", "Fábio", "Fabio", "Leonardo", "Gustavo", "Guilherme", "Leandro", "Tiago", "Thiago",
    "Anderson", "Ricardo", "Márcio", "Marcio", "Jorge", "Sebastião", "Alexandre", "Roberto", "Sérgio", "Sergio", "Vinícius",
    "Vinicius", "Diego", "Miguel", "Arthur", "Heitor", "Bernardo", "Davi", "Samuel", "Enzo", "Joaquim", "Sônia",
  ].map((n) => n.normalize("NFC")),
);

/** Palavras capitalizadas que não são nome de pessoa (evita falso positivo em texto clínico). */
export const NAO_NOMES = new Set(
  [
    "Motiva", "Polytech", "Silimed", "Mentor", "Allergan", "Natrelle", "Sientra", "Eurosilicone", "Nagor", "Establishment", "Labs",
    "Ergonomix", "Round", "Diagon", "Gel", "Replicon", "Sublime", "Line", "Opticon", "Mesmo", "Microthane", "Matrix", "Aesthetics",
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
    "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo",
    "TEPID", "High", "Five", "Dual", "Plane", "Subglandular", "Subfascial", "Anvisa", "ANVISA", "SUS", "Unimed",
  ].map((n) => n.normalize("NFC")),
);

const PRONOMES = `(?:[Ss]r|[Ss]ra|[Ss]rta|[Dd]r|[Dd]ra|[Pp]rof|[Pp]rofa)\\.?|(?:[Dd]ona|Seu|Dom)`;
const RE_PRONOME = new RegExp(`(?<![\\p{L}])(${PRONOMES})\\s+(${PALAVRA_CAP})`, "gu");
const RE_PALAVRA = new RegExp(`(?<![\\p{L}])${PALAVRA_CAP}(?![\\p{L}])`, "gu");
const CONECTOR = "(?:d[aeo]s?|e)";
const RE_SEQUENCIA = new RegExp(`(?<![\\p{L}])${PALAVRA_CAP}(?:\\s+(?:${CONECTOR}\\s+)?${PALAVRA_CAP})+(?![\\p{L}])`, "gu");

export interface NomeDetectado {
  sinal: "pronome_de_tratamento" | "prenome_comum" | "palavras_capitalizadas";
  /** posição do trecho no texto (o trecho em si nunca é logado nem devolvido ao cliente) */
  inicio: number;
}

/** O índice `i` é início de frase (começo do texto ou depois de . ! ? : ; quebra de linha, travessão ou marcador)? */
function inicioDeFrase(texto: string, i: number): boolean {
  const antes = texto.slice(0, i).replace(/[\s"'“”«(\[-]+$/u, "");
  return antes === "" || /[.!?:;\n•–—]$/u.test(antes);
}

export function detectarNomes(textoBruto: string): NomeDetectado[] {
  const texto = textoBruto.normalize("NFC");
  const out: NomeDetectado[] = [];
  for (const m of texto.matchAll(RE_PRONOME)) {
    if (!NAO_NOMES.has(m[2]!)) out.push({ sinal: "pronome_de_tratamento", inicio: m.index! });
  }
  for (const m of texto.matchAll(RE_PALAVRA)) {
    if (PRENOMES.has(m[0])) out.push({ sinal: "prenome_comum", inicio: m.index! });
  }
  for (const m of texto.matchAll(RE_SEQUENCIA)) {
    let palavras = m[0].split(/\s+/).filter((w) => new RegExp(`^${PALAVRA_CAP}$`, "u").test(w));
    // no início da frase a 1ª palavra é capitalizada pela gramática; conta o resto
    if (inicioDeFrase(texto, m.index!)) palavras = palavras.slice(1);
    palavras = palavras.filter((w) => !NAO_NOMES.has(w));
    if (palavras.length >= 2) out.push({ sinal: "palavras_capitalizadas", inicio: m.index! });
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

export function contemNome(texto: string): boolean {
  return detectarNomes(texto).length > 0;
}
