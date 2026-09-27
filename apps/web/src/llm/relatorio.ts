import { DISTANCIA_IDS, ROTULOS_DISTANCIAS, type Desenho, type DistanciaId } from "@simulador/contratos";
import { AVISO_FIXO } from "@/config/aviso";
import { recursoAtivoEm } from "@/config/recursos";
import { relatorioEntradaSchema, PARAGRAFOS_PROSA, type ParagrafoProsa, type RelatorioEntrada, type RelatorioProsa } from "./esquemas";
import { PROSA_MOCK } from "./mock";
import { numerosPermitidos, verificarNumeros, type DadosTravados, type VerificacaoNumeros } from "./numeros";
import { LLMNaoConfiguradoError, ProvedorLLMIndisponivelError, SaidaLLMInvalidaError, type ModoLLM, type ProvedorLLM } from "./provedor";

/**
 * Relatório para a paciente (Marco 2b; contratos §14.3; ADR 0006 item 6).
 * - Seções numéricas: TEMPLATE travado (este arquivo), a partir de `dados_travados`.
 * - Parágrafos de prosa: LLM (ou mock), verificados pelo teste travado de números.
 * - O texto final inteiro (template + prosa) passa de novo pelo verificador antes de ser gravado.
 * Em DESENHO=A não há seção calculada e a prosa só pode citar números digitados e do catálogo.
 */

export type OrigemProsa = "llm" | "mock" | "mock_substituto";

export interface SecaoRelatorio {
  id: string;
  titulo: string;
  origem: "template" | "prosa";
  /** true = número calculado pelo 3D (só existe em B; data-testid relatorio-numero-calculado). */
  calculado: boolean;
  linhas: string[];
}

export interface SimulacaoMostrada {
  id: string;
  implante_id: string;
  rotulo: string;
  plano: "subglandular" | "dual_plane";
  imf: "manter" | "rebaixar";
  lado: "ambos" | "dir" | "esq";
  versao_config_simulacao: string;
  nao_calibrado: boolean;
  mostrada_em: string;
}

export interface ParametrosRelatorio {
  versao_config: { simulacao: string; tepid: string };
  envelope_rms_mm: number;
  nao_calibrado: boolean;
  aviso: string;
}

export interface RelatorioFinal {
  esquema: "relatorio/1.0";
  relatorio_id: string;
  atendimento_id: string;
  pseudonimo: string;
  desenho: Desenho;
  versao_software: string;
  gerado_em: string;
  parametros: ParametrosRelatorio;
  dados_travados: DadosTravados;
  simulacoes_mostradas: SimulacaoMostrada[];
  numeros_permitidos: { prosa: string[]; texto_final: string[] };
  prosa: RelatorioProsa;
  prosa_origem: OrigemProsa;
  prosa_rejeitada: { motivo: string; intrusos: string[] } | null;
  llm: { modo: ModoLLM; modelo: string };
  secoes: SecaoRelatorio[];
  verificacao: VerificacaoNumeros;
}

export class RelatorioInconsistenteError extends Error {
  readonly codigo = "relatorio_inconsistente" as const;
  constructor(readonly intrusos: string[]) {
    super(`texto final do relatório com números fora dos dados: ${intrusos.join(", ")}`);
    this.name = "RelatorioInconsistenteError";
  }
}

// ------------------------------------------------------------------ formatação

/** Número no formato pt-BR sem perda (até 2 casas): 212.34 → "212,34"; 300 → "300". */
export function fmtNum(n: number): string {
  return String(Number(n.toFixed(2))).replace(".", ",");
}

export const ROTULO_PLANO: Record<SimulacaoMostrada["plano"], string> = { subglandular: "subglandular", dual_plane: "dual plane (plano duplo)" };
export const ROTULO_IMF: Record<SimulacaoMostrada["imf"], string> = { manter: "manter o sulco inframamário", rebaixar: "rebaixar o sulco inframamário" };
export const ROTULO_LADO: Record<SimulacaoMostrada["lado"], string> = { ambos: "ambos os lados", dir: "lado direito", esq: "lado esquerdo" };

const ROTULO_DIGITADA: Record<string, string> = {
  base_mm: "Largura da base",
  apss_mm: "Estiramento anterior da pele (APSS)",
  pinca_polo_superior_mm: "Pinçamento do polo superior",
  pinca_sulco_mm: "Pinçamento no sulco inframamário",
  n_imf_estirado_mm: "Mamilo–sulco sob estiramento (N-IMF)",
};

const TITULO_PROSA: Record<ParagrafoProsa, string> = {
  introducao: "Introdução",
  o_que_foi_simulado: "O que foi simulado",
  limitacoes: "Limitações",
  proximos_passos: "Próximos passos",
};

// ------------------------------------------------------------------ números permitidos

export interface ListasPermitidas {
  /** O que a PROSA do LLM pode citar. Em A: só digitados + catálogo. */
  prosa: string[];
  /** O que o texto final (template + prosa) pode conter: acrescenta a constante do envelope. */
  textoFinal: string[];
}

export function listasPermitidas(dados: DadosTravados, desenho: Desenho, envelopeMm: number): ListasPermitidas {
  const calculados = recursoAtivoEm(desenho, "numeros_calculados_no_relatorio");
  return {
    prosa: calculados ? numerosPermitidos(dados, [envelopeMm]) : numerosPermitidos(dados),
    textoFinal: numerosPermitidos(dados, [envelopeMm]),
  };
}

export function montarEntradaRelatorio(dados: DadosTravados, desenho: Desenho, pseudonimo: string, permitidosProsa: string[]): RelatorioEntrada {
  return relatorioEntradaSchema.parse({
    esquema: "relatorio_entrada/1.0",
    desenho,
    pseudonimo,
    dados_travados: {
      implantes_mostrados: dados.implantes_mostrados.map((i) => ({ id: i.id, rotulo: i.rotulo, plano: i.plano, imf: i.imf, base_mm: i.base_mm, projecao_mm: i.projecao_mm, volume_ml: i.volume_ml })),
      medidas_digitadas: dados.medidas_digitadas,
      distancias: dados.distancias,
      volumes: dados.volumes,
    },
    numeros_permitidos: permitidosProsa,
    avisos_obrigatorios: [AVISO_FIXO],
  });
}

// ------------------------------------------------------------------ template travado

export function secoesTemplate(dados: DadosTravados, desenho: Desenho, envelopeMm: number): Record<string, SecaoRelatorio> {
  const calculados = recursoAtivoEm(desenho, "numeros_calculados_no_relatorio");
  const out: Record<string, SecaoRelatorio> = {};

  out.implantes = {
    id: "implantes",
    titulo: "Implantes mostrados na simulação",
    origem: "template",
    calculado: false,
    linhas:
      dados.implantes_mostrados.length === 0
        ? ["Nenhuma simulação de implante foi registrada neste atendimento."]
        : dados.implantes_mostrados.map((i) => {
            const specs = [
              i.volume_ml !== undefined ? `volume ${fmtNum(i.volume_ml)} mL` : null,
              i.base_mm !== undefined ? `base ${fmtNum(i.base_mm)} mm` : null,
              i.projecao_mm !== undefined ? `projeção ${fmtNum(i.projecao_mm)} mm` : null,
            ].filter(Boolean);
            return `${i.rotulo}: ${specs.join(", ")}; plano ${ROTULO_PLANO[i.plano]}; ${ROTULO_IMF[i.imf]}.`;
          }),
  };

  if (dados.medidas_digitadas) {
    out.medidas_digitadas = {
      id: "medidas_digitadas",
      titulo: "Medidas registradas pelo cirurgião (digitadas)",
      origem: "template",
      calculado: false,
      linhas: Object.entries(dados.medidas_digitadas).map(([k, v]) => `${ROTULO_DIGITADA[k] ?? k}: direita ${fmtNum(v.dir)} mm; esquerda ${fmtNum(v.esq)} mm.`),
    };
  }

  if (calculados && dados.distancias) {
    const d = dados.distancias;
    const linhas = DISTANCIA_IDS.filter((id: DistanciaId) => d[id]).map((id: DistanciaId) => {
      const x = d[id]!;
      return `${ROTULOS_DISTANCIAS[id]}: ${fmtNum(x.euclidiana_mm)} mm em linha reta${x.geodesica_mm !== null ? `; ${fmtNum(x.geodesica_mm)} mm sobre a pele` : ""}.`;
    });
    if (linhas.length) out.distancias = { id: "distancias", titulo: "Distâncias medidas no modelo tridimensional (calculadas)", origem: "template", calculado: true, linhas };
  }

  if (calculados && recursoAtivoEm(desenho, "volume_calculado") && dados.volumes) {
    const v = dados.volumes;
    const linhas = (["dir", "esq"] as const)
      .filter((l) => v[l])
      .map((l) => `Mama ${l === "dir" ? "direita" : "esquerda"}: ${fmtNum(v[l]!.valor_ml)} mL (faixa de ± ${fmtNum(v[l]!.incerteza_ml)} mL).`);
    if (linhas.length) out.volumes = { id: "volumes", titulo: "Volume mamário estimado no modelo tridimensional (calculado)", origem: "template", calculado: true, linhas };
  }

  out.incerteza = {
    id: "incerteza",
    titulo: "Incerteza da simulação",
    origem: "template",
    calculado: false,
    linhas: [`A superfície simulada é mostrada com envelope de incerteza de ±${fmtNum(envelopeMm)} mm (RMS).`, "Coeficientes do modelo não calibrados."],
  };
  out.aviso = { id: "aviso", titulo: "Aviso", origem: "template", calculado: false, linhas: [`${AVISO_FIXO}.`] };
  return out;
}

/** Ordem de leitura: prosa e template intercalados. */
const ORDEM: string[] = ["introducao", "implantes", "o_que_foi_simulado", "medidas_digitadas", "distancias", "volumes", "incerteza", "limitacoes", "proximos_passos", "aviso"];

export function montarSecoes(template: Record<string, SecaoRelatorio>, prosa: RelatorioProsa): SecaoRelatorio[] {
  const todas: Record<string, SecaoRelatorio> = { ...template };
  for (const p of PARAGRAFOS_PROSA) todas[p] = { id: p, titulo: TITULO_PROSA[p], origem: "prosa", calculado: false, linhas: [prosa.paragrafos[p]] };
  return ORDEM.filter((id) => todas[id]).map((id) => todas[id]!);
}

export function textoDasSecoes(secoes: SecaoRelatorio[]): Record<string, string> {
  return Object.fromEntries(secoes.map((s) => [s.id, `${s.titulo}\n${s.linhas.join("\n")}`]));
}

// ------------------------------------------------------------------ prosa com guarda

export interface ProsaVerificada {
  prosa: RelatorioProsa;
  origem: OrigemProsa;
  rejeitada: { motivo: string; intrusos: string[] } | null;
  llm: { modo: ModoLLM; modelo: string };
}

/**
 * Pede a prosa ao provedor e aplica o teste travado. Prosa com número fora da lista (em dígitos,
 * com vírgula ou por extenso) ou fora do contrato é DESCARTADA e substituída pela do mock.
 */
export async function redigirProsaVerificada(provedor: ProvedorLLM, entrada: RelatorioEntrada, permitidos: string[]): Promise<ProsaVerificada> {
  let r;
  try {
    r = await provedor.redigirProsaRelatorio(entrada);
  } catch (e) {
    if (e instanceof SaidaLLMInvalidaError || e instanceof ProvedorLLMIndisponivelError || e instanceof LLMNaoConfiguradoError) {
      return { prosa: PROSA_MOCK, origem: "mock_substituto", rejeitada: { motivo: e.codigo, intrusos: [] }, llm: { modo: provedor.modo, modelo: "indisponivel" } };
    }
    throw e;
  }
  const v = verificarNumeros(r.saida.paragrafos, permitidos);
  if (!v.ok) {
    return { prosa: PROSA_MOCK, origem: "mock_substituto", rejeitada: { motivo: "numero_fora_da_lista", intrusos: v.intrusos }, llm: { modo: r.modo, modelo: r.modelo } };
  }
  return { prosa: r.saida, origem: r.modo === "mock" ? "mock" : "llm", rejeitada: null, llm: { modo: r.modo, modelo: r.modelo } };
}

// ------------------------------------------------------------------ montagem final

export interface EntradaRelatorio {
  relatorioId: string;
  atendimentoId: string;
  pseudonimo: string;
  desenho: Desenho;
  versaoSoftware: string;
  geradoEm: string;
  parametros: ParametrosRelatorio;
  dados: DadosTravados;
  simulacoes: SimulacaoMostrada[];
}

/** Gera o relatório completo (pura, exceto pela chamada ao provedor). Lança se o texto final divergir. */
export async function gerarRelatorio(e: EntradaRelatorio, provedor: ProvedorLLM): Promise<RelatorioFinal> {
  const listas = listasPermitidas(e.dados, e.desenho, e.parametros.envelope_rms_mm);
  const entrada = montarEntradaRelatorio(e.dados, e.desenho, e.pseudonimo, listas.prosa);
  const pv = await redigirProsaVerificada(provedor, entrada, listas.prosa);
  const secoes = montarSecoes(secoesTemplate(e.dados, e.desenho, e.parametros.envelope_rms_mm), pv.prosa);
  const verificacao = verificarNumeros(textoDasSecoes(secoes), listas.textoFinal);
  if (!verificacao.ok) throw new RelatorioInconsistenteError(verificacao.intrusos);
  return {
    esquema: "relatorio/1.0",
    relatorio_id: e.relatorioId,
    atendimento_id: e.atendimentoId,
    pseudonimo: e.pseudonimo,
    desenho: e.desenho,
    versao_software: e.versaoSoftware,
    gerado_em: e.geradoEm,
    parametros: e.parametros,
    dados_travados: e.dados,
    simulacoes_mostradas: e.simulacoes,
    numeros_permitidos: { prosa: listas.prosa, texto_final: listas.textoFinal },
    prosa: pv.prosa,
    prosa_origem: pv.origem,
    prosa_rejeitada: pv.rejeitada,
    llm: pv.llm,
    secoes,
    verificacao,
  };
}
