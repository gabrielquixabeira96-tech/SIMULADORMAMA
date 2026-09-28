import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { raizRepo } from "@/config/ambiente";
import { TEXTO_FAIXA_DEMO } from "@/config/aviso";
import { blandAltman, type ResultadoBlandAltman } from "./estatistica";
import { ehNimf, listarSessoes, type ResultadoSessao } from "./sessao";

/**
 * Planilha de validação do art. 5º da RDC 657/2022 (ESTRATEGIA, "Próximos passos": versão, data,
 * scan, medidas e desvios; ADR 0017). Uma linha por par de medida (medido × referência), a partir de:
 *  1. registros de componente versionados `docs/validacao/v<versao>-web-marcos-0-1.json`
 *     (operador simulado do e2e `validacao.spec.ts`);
 *  2. sessões de Bland-Altman ENCERRADAS em DATA_DIR/validacao/sessoes (operador humano ou simulado).
 * Só torsos sintéticos: nenhuma linha tem nome, pseudônimo de paciente, caminho absoluto ou e-mail.
 * CSV gerado à mão (RFC 4180), sem dependência nova (ADR 0009).
 */

export const ESQUEMA_PLANILHA = "planilha_validacao_art5/1.0";

export const COLUNAS = [
  "versao_software",
  "data",
  "fonte",
  "registro",
  "commit",
  "desenho",
  "operador",
  "tipo_operador",
  "scan_id",
  "sintetico",
  "repeticao",
  "medida",
  "tipo_distancia",
  "n_imf",
  "referencia_mm",
  "medido_mm",
  "desvio_mm",
  "observacoes",
] as const;
export type Coluna = (typeof COLUNAS)[number];
export type Linha = Record<Coluna, string | number | null>;

export interface GrupoResumo {
  fonte: string;
  registro: string;
  versao_software: string;
  data: string;
  operador: string;
  tipo_operador: string;
  geral: ResultadoBlandAltman;
  n_imf: ResultadoBlandAltman;
  sem_n_imf: ResultadoBlandAltman;
}

export interface Planilha {
  esquema: typeof ESQUEMA_PLANILHA;
  gerada_em: string;
  versao_software: string;
  colunas: readonly Coluna[];
  linhas: Linha[];
  resumo: GrupoResumo[];
  notas: string[];
  /** Só em instância de demonstração sintética (ADR 0018): toda linha sai com fonte `demo:<fonte>`. */
  demo?: true;
}

/** Prefixo da coluna `fonte` para linhas vindas de demonstração sintética (ADR 0018). */
export const PREFIXO_FONTE_DEMO = "demo:";
export const NOTA_DEMO = `${TEXTO_FAIXA_DEMO}. Planilha exportada de instância de demonstração (ADR 0018): linhas com fonte "demo:..." não valem como validação.`;

const NOTAS = [
  "Desvio = medido − referência (mm). Referência = gabarito analítico do torso sintético (contratos §4.3).",
  "N-IMF (n_imf=sim) é relatado à parte no resumo (ESTRATEGIA fase 1).",
  "Todos os scans são torsos sintéticos paramétricos: não contam para o critério da fase 1 (≥ 30 pares em ≥ 5 voluntárias ou manequim, LoA ±3 mm).",
  "Operador identificado só por código pseudônimo; nenhum dado de paciente.",
  "O LoA do resumo trata repetições, scans e tipos de medida como pares independentes (pseudo-replicação; Bland & Altman 2007): tende a ficar estreito demais com medidas repetidas. n ≥ 30 pares não substitui ≥ 5 sujeitos.",
];

const registroE2eSchema = z.object({
  esquema: z.literal("validacao_componente/web-marcos-0-1"),
  versao_software: z.string(),
  data: z.string(),
  commit_base: z.string().optional(),
  parametros: z.object({ jitter_px: z.number().optional() }).passthrough().optional(),
  pares: z.array(
    z.object({
      medida: z.string(),
      distancia: z.string(),
      tipo: z.enum(["euclidiana", "geodesica"]),
      referencia_mm: z.number(),
      medido_mm: z.number(),
      torso: z.string(),
      operador: z.string(),
    }),
  ),
});

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const scanSintetico = (torso: string) => `sintetico:${torso}`;

async function linhasDosRegistros(dirValidacao: string): Promise<{ linhas: Linha[]; resumo: GrupoResumo[] }> {
  let nomes: string[] = [];
  try {
    nomes = (await readdir(dirValidacao)).filter((n) => /^v\d+\.\d+\.\d+-web-marcos-0-1\.json$/.test(n)).sort();
  } catch {
    return { linhas: [], resumo: [] };
  }
  const linhas: Linha[] = [];
  const resumo: GrupoResumo[] = [];
  for (const nome of nomes) {
    let reg: z.infer<typeof registroE2eSchema>;
    try {
      reg = registroE2eSchema.parse(JSON.parse(await readFile(resolve(/*turbopackIgnore: true*/ dirValidacao, nome), "utf8")));
    } catch {
      continue;
    }
    const jitter = reg.parametros?.jitter_px;
    const obs = `operador simulado do e2e (projeção do gabarito${jitter !== undefined ? ` + jitter ±${jitter} px` : ""}); não é variabilidade humana`;
    for (const p of reg.pares) {
      const rep = /(\d+)$/.exec(p.operador)?.[1];
      linhas.push({
        versao_software: reg.versao_software,
        data: reg.data,
        fonte: "registro_e2e",
        registro: nome,
        commit: reg.commit_base ?? null,
        desenho: "B",
        operador: p.operador,
        tipo_operador: "simulado",
        scan_id: scanSintetico(p.torso),
        sintetico: "sim",
        repeticao: rep ? Number(rep) : null,
        medida: p.distancia,
        tipo_distancia: p.tipo,
        n_imf: ehNimf(p.distancia) ? "sim" : "nao",
        referencia_mm: p.referencia_mm,
        medido_mm: p.medido_mm,
        desvio_mm: r4(p.medido_mm - p.referencia_mm),
        observacoes: obs,
      });
    }
    resumo.push({
      fonte: "registro_e2e",
      registro: nome,
      versao_software: reg.versao_software,
      data: reg.data,
      operador: "simulado",
      tipo_operador: "simulado",
      geral: blandAltman(reg.pares),
      n_imf: blandAltman(reg.pares.filter((p) => ehNimf(p.distancia))),
      sem_n_imf: blandAltman(reg.pares.filter((p) => !ehNimf(p.distancia))),
    });
  }
  return { linhas, resumo };
}

async function linhasDasSessoes(): Promise<{ linhas: Linha[]; resumo: GrupoResumo[] }> {
  const linhas: Linha[] = [];
  const resumo: GrupoResumo[] = [];
  for (const s of await listarSessoes()) {
    if (s.estado !== "encerrada" || !s.resultado) continue;
    const r = s.resultado as ResultadoSessao;
    const data = (s.encerrada_em ?? s.criada_em).slice(0, 10);
    const obsBase = s.tipo_operador === "humano" ? "sessão cega ao gabarito; torso sintético" : "sessão cega ao gabarito; operador simulado; torso sintético";
    const obs = s.observacoes ? `${obsBase}; ${s.observacoes}` : obsBase;
    for (const p of r.pares) {
      linhas.push({
        versao_software: s.versao_software,
        data,
        fonte: s.demo ? `${PREFIXO_FONTE_DEMO}sessao_bland_altman` : "sessao_bland_altman",
        registro: `sessao:${s.id}`,
        commit: null,
        desenho: s.desenho,
        operador: s.operador,
        tipo_operador: s.tipo_operador,
        scan_id: scanSintetico(p.torso),
        sintetico: "sim",
        repeticao: p.repeticao,
        medida: p.distancia,
        tipo_distancia: p.tipo,
        n_imf: ehNimf(p.distancia) ? "sim" : "nao",
        referencia_mm: p.referencia_mm,
        medido_mm: p.medido_mm,
        desvio_mm: p.desvio_mm,
        observacoes: obs,
      });
    }
    resumo.push({ fonte: s.demo ? `${PREFIXO_FONTE_DEMO}sessao_bland_altman` : "sessao_bland_altman", registro: `sessao:${s.id}`, versao_software: s.versao_software, data, operador: s.operador, tipo_operador: s.tipo_operador, geral: r.geral, n_imf: r.n_imf, sem_n_imf: r.sem_n_imf });
  }
  return { linhas, resumo };
}

export async function montarPlanilha(opcoes: { versaoSoftware: string; geradaEm: string; dirValidacao?: string; demo?: boolean }): Promise<Planilha> {
  const reg = await linhasDosRegistros(opcoes.dirValidacao ?? resolve(/*turbopackIgnore: true*/ raizRepo(), "docs/validacao"));
  const ses = await linhasDasSessoes();
  const p: Planilha = {
    esquema: ESQUEMA_PLANILHA,
    gerada_em: opcoes.geradaEm,
    versao_software: opcoes.versaoSoftware,
    colunas: COLUNAS,
    linhas: [...reg.linhas, ...ses.linhas],
    resumo: [...reg.resumo, ...ses.resumo],
    notas: NOTAS,
  };
  if (!opcoes.demo) return p;
  // instância de demonstração (ADR 0018): toda linha e todo grupo marcados, mais a nota
  const marcar = (f: string | number | null) => (typeof f === "string" && !f.startsWith(PREFIXO_FONTE_DEMO) ? `${PREFIXO_FONTE_DEMO}${f}` : f);
  return {
    ...p,
    linhas: p.linhas.map((l) => ({ ...l, fonte: marcar(l.fonte) })),
    resumo: p.resumo.map((g) => ({ ...g, fonte: String(marcar(g.fonte)) })),
    notas: [NOTA_DEMO, ...p.notas],
    demo: true,
  };
}

// ------------------------------------------------------------------ CSV

export interface OpcoesCsv {
  /** "," (padrão, RFC 4180, ponto decimal) ou ";" (Excel em português: vírgula decimal) */
  separador: "," | ";";
}

/** Célula de texto: neutraliza fórmula (=, +, -, @ no início) e aplica aspas RFC 4180. */
function celulaTexto(v: string, sep: string): string {
  // fórmula mesmo após espaços/controles iniciais (" =1", "\r=1"); números vão por `celula`, não aqui
  if (/^\s*[=+\-@\t\r]/.test(v)) v = `'${v}`;
  const t = v.replace(/[\r\n]+/g, " ");
  return /["\s]/.test(t) || t.includes(sep) || t.includes("'") ? `"${t.replace(/"/g, '""')}"` : t;
}

function celula(v: string | number | null, sep: string): string {
  if (v === null) return "";
  if (typeof v === "number") {
    const s = String(v);
    return sep === ";" ? s.replace(".", ",") : s;
  }
  return celulaTexto(v, sep);
}

export function paraCsv(p: Planilha, op: OpcoesCsv = { separador: "," }): string {
  const sep = op.separador;
  const linhas = [COLUNAS.join(sep), ...p.linhas.map((l) => COLUNAS.map((c) => celula(l[c], sep)).join(sep))];
  // BOM UTF-8 para o Excel reconhecer a acentuação; CRLF (RFC 4180)
  return `﻿${linhas.join("\r\n")}\r\n`;
}
