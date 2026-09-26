import { anamneseLLMSchema, relatorioProsaSchema, type AnamneseLLM, type RelatorioEntrada, type RelatorioProsa } from "./esquemas";
import baseAnamnese from "./mocks/anamnese.json";
import baseProsa from "./mocks/relatorio_prosa.json";
import type { ProvedorLLM, ResultadoLLM } from "./provedor";

/**
 * Provedor determinístico (ADR 0006): sem rede, mesma entrada → mesma saída. A anamnese usa
 * regras simples de palavras-chave sobre o texto higienizado; a prosa do relatório vem de
 * `mocks/relatorio_prosa.json`, que NÃO contém nenhum número (é também o substituto quando a
 * prosa de um provedor é recusada pelo teste travado).
 *
 * `prosa` permite injetar parágrafos (testes da "alucinação": o verificador tem de recusar).
 */
export interface OpcoesMock {
  prosa?: Partial<RelatorioProsa["paragrafos"]>;
}

export const PROSA_MOCK: RelatorioProsa = relatorioProsaSchema.parse(baseProsa);

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const PALAVRAS_NUM: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };

function numeroDe(s: string | undefined): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return PALAVRAS_NUM[s] ?? null;
}

function listaApos(t: string, re: RegExp): string[] {
  const m = t.match(re);
  if (!m?.[1]) return [];
  return m[1]
    .split(/,|\be\b/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1 && !/^(nega|nenhum|nenhuma|nada)$/.test(x))
    .map((x) => x.slice(0, 200));
}

/** Extração por regras (determinística). Exportada para teste direto. */
export function anamneseMock(textoHigienizado: string): AnamneseLLM {
  const bruto = textoHigienizado.trim();
  const t = normalizar(bruto);
  const a: AnamneseLLM = structuredClone(anamneseLLMSchema.parse(baseAnamnese));

  const primeira = bruto.split(/(?<=[.!?])\s+/)[0] ?? "";
  a.queixa_principal = primeira.slice(0, 1000);

  if (/assimetri/.test(t)) a.objetivo_estetico = "correcao_assimetria";
  else if (/discret|natural|pouco maior|sutil/.test(t)) a.objetivo_estetico = "aumento_discreto";
  else if (/bem maior|grande|marcad|volumos/.test(t)) a.objetivo_estetico = "aumento_marcado";
  else if (/aument|maior|volume/.test(t)) a.objetivo_estetico = "aumento_moderado";

  const tam = bruto.match(/(?:gostaria|deseja|quer|queria)[^.]*?(?:tamanho|ficar|maior|seios|mamas)[^.]*\./i);
  a.tamanho_desejado_descricao = tam ? tam[0].slice(0, 300) : null;

  const nul = /nuligesta|nunca engravidou|sem filhos|nao tem filhos/.test(t);
  const g = t.match(/\b(\d+|um|uma|dois|duas|tres|quatro|cinco)\s+(?:filhos?|filhas?|gestac\w*|gravidez\w*)/) ?? t.match(/\bg(\d)\b/);
  a.gestacoes.numero = nul ? 0 : numeroDe(g?.[1]);
  if (/nao amamentou|nunca amamentou/.test(t)) a.gestacoes.amamentou = false;
  else if (/amamentou|amamentacao/.test(t)) a.gestacoes.amamentou = true;
  if (/nao (?:planeja|pretende|deseja) (?:engravidar|ter (?:mais )?filhos)/.test(t)) a.gestacoes.planeja = "nao";
  else if (/(?:planeja|pretende|deseja) (?:engravidar|ter (?:mais )?filhos)/.test(t)) a.gestacoes.planeja = "sim";
  else if (/talvez|nao sabe se/.test(t) && /engravidar|filhos/.test(t)) a.gestacoes.planeja = "incerto";

  if (/ex-?tabagista|parou de fumar|ex-?fumante/.test(t)) a.tabagismo = "ex";
  else if (/nao fuma|nunca fumou|nega tabagismo|nao tabagista/.test(t)) a.tabagismo = "nunca";
  else if (/tabagista|fuma\b|fumante/.test(t)) a.tabagismo = "atual";

  a.alergias = listaApos(bruto, /alergi\w*\s+(?:a|ao|à|as|aos|de)\s+([^.;]+)/i);
  a.medicamentos = listaApos(bruto, /(?:usa|uso de|toma|em uso de)\s+([^.;]+)/i);
  a.comorbidades_relatadas = listaApos(bruto, /(?:comorbidades?|doenças?|tem|portadora de)\s*:?\s+((?:hipertens|diabet|hipotireoid|asma|depress|ansiedad)[^.;]*)/i);
  a.cirurgias_mamarias_previas = listaApos(bruto, /(?:cirurgia|operou)[^.;]*?(?:mama|seio|mamária)s?\s*(?:prévias?)?\s*:?\s*([^.;]*)/i).filter((x) => !/^nunca/.test(normalizar(x)));
  a.expectativas_irreais_sinalizadas = /perfeit|garanti|igual a (?:foto|atriz|famosa)|sem cicatriz/.test(t);

  const nao: string[] = [];
  if (a.gestacoes.numero === null) nao.push("gestacoes.numero");
  if (a.gestacoes.amamentou === null) nao.push("gestacoes.amamentou");
  if (a.gestacoes.planeja === "nao_informado") nao.push("gestacoes.planeja");
  if (a.tabagismo === "nao_informado") nao.push("tabagismo");
  if (a.tamanho_desejado_descricao === null) nao.push("tamanho_desejado_descricao");
  if (a.alergias.length === 0) nao.push("alergias");
  if (a.medicamentos.length === 0) nao.push("medicamentos");
  if (a.comorbidades_relatadas.length === 0) nao.push("comorbidades_relatadas");
  if (a.cirurgias_mamarias_previas.length === 0) nao.push("cirurgias_mamarias_previas");
  a.campos_nao_informados = nao;
  return anamneseLLMSchema.parse(a);
}

export class ProvedorMock implements ProvedorLLM {
  readonly modo = "mock" as const;
  constructor(private readonly opcoes: OpcoesMock = {}) {}

  async registrarAnamnese(textoHigienizado: string): Promise<ResultadoLLM<AnamneseLLM>> {
    const t0 = performance.now();
    return { saida: anamneseMock(textoHigienizado), modo: "mock", modelo: "mock", latencia_ms: performance.now() - t0 };
  }

  async redigirProsaRelatorio(entrada: RelatorioEntrada): Promise<ResultadoLLM<RelatorioProsa>> {
    void entrada;
    const t0 = performance.now();
    const saida = relatorioProsaSchema.parse({ esquema: "relatorio_prosa/1.0", paragrafos: { ...PROSA_MOCK.paragrafos, ...this.opcoes.prosa } });
    return { saida, modo: "mock", modelo: "mock", latencia_ms: performance.now() - t0 };
  }
}
