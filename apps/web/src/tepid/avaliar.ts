import {
  CAMPOS_DIGITADOS,
  type AlertaTepid,
  type CampoDigitado,
  type Desenho,
  type MedidasDigitadas,
  type RegraTepid,
  type TabelaTepid,
  type TepidConfig,
} from "@simulador/contratos";
import { recursoAtivoEm } from "@/config/recursos";

/**
 * TEPID digitado (contratos §8). Todos os números (faixas, limiares, tabelas) vêm de
 * config/tepid.json — nada é hard-coded aqui. Regras e tabelas só são avaliadas quando
 * `alertas_tepid` está ativo (DESENHO=B); em A só a validação de faixa dos campos.
 */

export interface ErroCampo {
  campo: CampoDigitado;
  lado: "dir" | "esq";
  mensagem: string;
}

export type ResultadoValidacao = { ok: true; valores: MedidasDigitadas } | { ok: false; erros: ErroCampo[] };

export function validarValoresTepid(entrada: unknown, config: TepidConfig): ResultadoValidacao {
  const erros: ErroCampo[] = [];
  const obj = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const valores = {} as MedidasDigitadas;
  for (const campo of CAMPOS_DIGITADOS) {
    const def = config.campos[campo];
    const bruto = (obj[campo] && typeof obj[campo] === "object" ? obj[campo] : {}) as Record<string, unknown>;
    const lados = {} as { dir: number; esq: number };
    for (const lado of ["dir", "esq"] as const) {
      const v = bruto[lado];
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
      if (!Number.isFinite(n)) {
        erros.push({ campo, lado, mensagem: `${def.rotulo}: valor obrigatório (mm)` });
        continue;
      }
      if (n < def.min || n > def.max) {
        erros.push({ campo, lado, mensagem: `${def.rotulo}: fora da faixa ${def.min}–${def.max} mm` });
        continue;
      }
      lados[lado] = n;
    }
    valores[campo] = lados;
  }
  // Campos extras são recusados (contrato estrito).
  for (const k of Object.keys(obj)) {
    if (!(CAMPOS_DIGITADOS as readonly string[]).includes(k)) {
      erros.push({ campo: k as CampoDigitado, lado: "dir", mensagem: `campo desconhecido: ${k}` });
    }
  }
  return erros.length ? { ok: false, erros } : { ok: true, valores };
}

function aplicaOperador(r: RegraTepid, v: number): boolean {
  switch (r.operador) {
    case "<":
      return v < (r.limiar_mm as number);
    case "<=":
      return v <= (r.limiar_mm as number);
    case ">":
      return v > (r.limiar_mm as number);
    case ">=":
      return v >= (r.limiar_mm as number);
    case "entre":
      return v >= (r.limiar_min_mm as number) && v <= (r.limiar_max_mm as number);
  }
}

export function avaliarRegras(valores: MedidasDigitadas, config: TepidConfig): AlertaTepid[] {
  const alertas: AlertaTepid[] = [];
  for (const regra of config.regras) {
    if (regra.campo === "volume_ml") continue; // depende do implante; não há volume digitado aqui
    const par = valores[regra.campo];
    for (const lado of ["dir", "esq"] as const) {
      const v = par[lado];
      if (aplicaOperador(regra, v)) {
        alertas.push({
          regra_id: regra.id,
          campo: regra.campo,
          lado,
          valor_mm: v,
          alerta: regra.alerta,
          conferir_no_texto_original: regra.conferir_no_texto_original,
        });
      }
    }
  }
  return alertas;
}

/** Consulta de tabela: linear sem extrapolação (fora da faixa → null), degrau ou faixas. */
export function consultarTabela(t: TabelaTepid, x: number): number | null {
  if (t.faixas) {
    for (const f of t.faixas) {
      if ("ate" in f && x <= f.ate) return f.valor;
      if ("acima" in f && x > f.acima) return f.valor;
    }
    return null;
  }
  const pts = [...(t.pontos ?? [])].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  const primeiro = pts[0]!;
  const ultimo = pts[pts.length - 1]!;
  if (x < primeiro[0] || x > ultimo[0]) return null;
  if (t.interpolar === "degrau") {
    let v = primeiro[1];
    for (const [px, py] of pts) if (px <= x) v = py;
    return v;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    if (x >= x0 && x <= x1) return x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
  }
  return null;
}

export interface ReferenciaTabela {
  tabela_id: string;
  descricao: string | null;
  lado: "dir" | "esq";
  entrada: string;
  valor_entrada: number;
  saida: string;
  valor_saida: number | null;
  conferir_no_texto_original: boolean;
}

export function avaliarTabelas(valores: MedidasDigitadas, config: TepidConfig): ReferenciaTabela[] {
  const out: ReferenciaTabela[] = [];
  for (const t of config.tabelas) {
    if (t.entrada === "volume_ml") continue; // exige volume do implante (Marco 2)
    const par = valores[t.entrada];
    for (const lado of ["dir", "esq"] as const) {
      out.push({
        tabela_id: t.id,
        descricao: t.descricao ?? null,
        lado,
        entrada: t.entrada,
        valor_entrada: par[lado],
        saida: t.saida,
        valor_saida: consultarTabela(t, par[lado]),
        conferir_no_texto_original: t.conferir_no_texto_original,
      });
    }
  }
  return out;
}

export interface AvaliacaoTepid {
  desenho: Desenho;
  alertas: AlertaTepid[];
  referencias: ReferenciaTabela[];
}

/** Em DESENHO=A devolve sempre listas vazias (regras e tabelas ignoradas). */
export function avaliarTepid(valores: MedidasDigitadas, config: TepidConfig, desenho: Desenho): AvaliacaoTepid {
  if (!recursoAtivoEm(desenho, "alertas_tepid")) return { desenho, alertas: [], referencias: [] };
  return { desenho, alertas: avaliarRegras(valores, config), referencias: avaliarTabelas(valores, config) };
}
