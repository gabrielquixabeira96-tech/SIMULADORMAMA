/**
 * Remoção de dado pessoal de estruturas que vão para log ou auditoria (LGPD; ADR 0002 item 4;
 * contratos §17). Estratégia dupla: (1) chaves sensíveis têm o valor inteiro removido;
 * (2) em todo texto, padrões de CPF, e-mail, telefone, data completa e caminho absoluto são
 * substituídos. IDs (UUID) e pseudônimos (P-XXXXXX) são preservados.
 */

export const REMOVIDO = "[removido]";
export const CAMINHO = "[caminho]";

const CHAVES_SENSIVEIS = new Set([
  "nome",
  "name",
  "nome_completo",
  "sobrenome",
  "cpf",
  "rg",
  "cns",
  "documento",
  "email",
  "e_mail",
  "telefone",
  "celular",
  "phone",
  "contato",
  "nascimento",
  "data_nascimento",
  "data_de_nascimento",
  "idade",
  "endereco",
  "address",
  "cep",
  "anamnese",
  "texto",
  "texto_livre",
  "queixa",
  "queixa_principal",
  "prontuario",
  "senha",
  "password",
  "token",
  "authorization",
  "cookie",
  "api_key",
  "apikey",
  "anthropic_api_key",
  "database_url",
]);

function normalizarChave(k: string): string {
  return k
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function chaveSensivel(k: string): boolean {
  return CHAVES_SENSIVEIS.has(normalizarChave(k));
}

const B = "(?<![\\w-])"; // fronteira que não corta UUIDs nem pseudônimos
const E = "(?![\\w-])";
const PADROES: Array<[RegExp, string]> = [
  // e-mail
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REMOVIDO],
  // URL com credencial (postgres://user:senha@host)
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi, REMOVIDO],
  // CPF com ou sem máscara
  [new RegExp(`${B}\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}${E}`, "g"), REMOVIDO],
  // telefone BR: (65) 99999-9999, +55 65 999999999, 6533334444
  [new RegExp(`${B}(?:\\+?55[\\s-]?)?\\(?\\d{2}\\)?[\\s-]?9?\\d{4}[\\s-]?\\d{4}${E}`, "g"), REMOVIDO],
  // data completa dd/mm/aaaa ou dd-mm-aaaa
  [new RegExp(`${B}\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}${E}`, "g"), REMOVIDO],
  // caminho absoluto POSIX (/home/..., /var/...) ou Windows (C:\...)
  [/(?<![\w.])\/(?:home|root|Users|var|tmp|mnt|opt|srv|data|private|Volumes)(?:\/[^\s"',;:)]*)?/g, CAMINHO],
  [/\b[A-Za-z]:\\[^\s"',;)]*/g, CAMINHO],
];

export function higienizarTexto(s: string): string {
  let out = s;
  for (const [re, sub] of PADROES) out = out.replace(re, sub);
  return out;
}

/** Cópia profunda higienizada de qualquer valor (limite de profundidade contra ciclos). */
export function higienizar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 8) return "[profundo]";
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return higienizarTexto(valor);
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (typeof valor === "bigint") return valor.toString();
  if (valor instanceof Date) return valor.toISOString();
  if (valor instanceof Error) {
    return { nome: valor.name, mensagem: higienizarTexto(valor.message) };
  }
  if (Array.isArray(valor)) return valor.map((v) => higienizar(v, profundidade + 1));
  if (typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      out[k] = chaveSensivel(k) ? REMOVIDO : higienizar(v, profundidade + 1);
    }
    return out;
  }
  return String(valor);
}
