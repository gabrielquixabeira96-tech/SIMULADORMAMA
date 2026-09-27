import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { DISTANCIA_IDS, LANDMARK_IDS, landmarksSchema, type Desenho, type DistanciaId, type Landmarks } from "@simulador/contratos";
import { z } from "zod";
import { caminhoEmDataDir, isoComFuso, versaoSoftware } from "@/config/ambiente";
import { log } from "@/log/logger";
import { distanciasEuclidianas } from "@/medidas/geometria";
import { ClienteMesh } from "@/mesh/cliente";
import { blandAltman, embaralhar, prng, repetibilidade, arred4, type ResultadoBlandAltman, type Repetibilidade } from "./estatistica";
import { garantirScan, lerGabarito, sha256Gabarito, sha256TorsoObj, torsosElegiveis } from "./scans";

/**
 * Sessão de Bland-Altman com operador humano (ADR 0017; ESTRATEGIA fase 1; plano A13).
 *
 * - O operador se identifica só por um CÓDIGO pseudônimo (sem nome) e marca os 10 landmarks em
 *   cada scan sintético, em ordem aleatória (semente registrada), repetindo a série N vezes
 *   (confiabilidade intra-operador).
 * - CEGA ao gabarito: enquanto a sessão está aberta, nada do que o cliente recebe traz o nome do
 *   torso, distâncias do gabarito ou as distâncias medidas (só "concluído"). O gabarito só é lido
 *   no servidor, no encerramento.
 * - Guardada em DATA_DIR/validacao/sessoes/<id>.json (fora de pacientes/; não é dado de paciente).
 */

export const ESQUEMA_SESSAO = "sessao_bland_altman/1.0";
export const LIMITE_MARCO1_MM = 2;
export const LIMITE_ESTRATEGIA_MM = 3;
export const MIN_PARES_FASE1 = 30;

/** Código pseudônimo do operador (ex.: OP-01). Nunca nome, e-mail ou CRM. */
export const operadorSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, "use um código pseudônimo (letras, dígitos e hífen; 2–16), nunca o nome"));

export const criarSessaoSchema = z.strictObject({
  operador: operadorSchema,
  tipo_operador: z.enum(["humano", "simulado"]).default("humano"),
  repeticoes: z.number().int().min(2).max(5).default(2),
  /** subconjunto dos torsos elegíveis (padrão: todos) */
  torsos: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(20).optional(),
  semente: z.number().int().min(0).max(0xffffffff).optional(),
});
export type CriarSessao = z.input<typeof criarSessaoSchema>;

/** Observação livre no encerramento: sem @ (e-mail) e sem quebras; nunca dado de paciente. */
export const observacaoSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^[^@\r\n\t]*$/, "observação não pode ter @ nem quebras de linha");

const distanciaMedidaSchema = z.object({ euclidiana_mm: z.number(), geodesica_mm: z.number().nullable() }).nullable();

const itemSchema = z.object({
  indice: z.number().int().min(0),
  scan_id: z.string(),
  repeticao: z.number().int().min(1),
  registrado_em: z.string().nullable(),
  landmarks: landmarksSchema.nullable(),
  distancias: z.record(z.string(), distanciaMedidaSchema).nullable(),
  avisos: z.array(z.string()).default([]),
});

const scanSchema = z.object({ scan_id: z.string(), torso: z.string(), sha256_gabarito: z.string(), sha256_obj: z.string() });

export const sessaoSchema = z.object({
  esquema: z.literal(ESQUEMA_SESSAO),
  id: z.uuid(),
  versao_software: z.string(),
  desenho: z.enum(["A", "B"]),
  operador: z.string(),
  tipo_operador: z.enum(["humano", "simulado"]),
  repeticoes: z.number().int(),
  semente: z.number().int(),
  estado: z.enum(["aberta", "encerrada", "cancelada"]),
  criada_em: z.string(),
  encerrada_em: z.string().nullable(),
  scans: z.array(scanSchema),
  itens: z.array(itemSchema),
  observacoes: z.string().nullable(),
  resultado: z.unknown().nullable(),
});
export type Sessao = z.infer<typeof sessaoSchema>;

export class ErroSessao extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroSessao";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const caminhoSessao = (id: string) => {
  if (!UUID.test(id)) throw new ErroSessao(404, "sessao_nao_encontrada", "sessão não encontrada");
  return caminhoEmDataDir(`validacao/sessoes/${id}.json`);
};

// ------------------------------------------------------------------ persistência

export async function lerSessao(id: string): Promise<Sessao> {
  let bruto: string;
  try {
    bruto = await readFile(caminhoSessao(id), "utf8");
  } catch (e) {
    if (e instanceof ErroSessao) throw e;
    throw new ErroSessao(404, "sessao_nao_encontrada", "sessão não encontrada");
  }
  return sessaoSchema.parse(JSON.parse(bruto));
}

async function gravarSessao(s: Sessao): Promise<void> {
  await mkdir(caminhoEmDataDir("validacao/sessoes"), { recursive: true });
  const destino = caminhoSessao(s.id);
  const tmp = `${destino}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), { flag: "wx" });
  await rename(tmp, destino);
}

/** Lê todas as sessões; arquivos que não passam no esquema vão para `invalidos` (nomes, sem caminho). */
async function lerTodas(): Promise<{ sessoes: Sessao[]; invalidos: string[] }> {
  let nomes: string[] = [];
  try {
    nomes = (await readdir(caminhoEmDataDir("validacao/sessoes"))).filter((n) => n.endsWith(".json")).sort();
  } catch (e) {
    // Diretório ausente = nenhuma sessão. Qualquer outro erro (permissão, não é diretório, E/S) →
    // FAIL CLOSED: não dá para saber quais torsos estão em sessão, então conta como sessão inválida
    // e bloqueia todos os gabaritos (ADR 0017), em vez de liberá-los como se não houvesse sessão.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { sessoes: [], invalidos: [] };
    const codigo = (e as NodeJS.ErrnoException)?.code ?? "desconhecido";
    log.warn("validacao_sessoes_ilegiveis", { codigo });
    return { sessoes: [], invalidos: [`(diretório de sessões ilegível: ${codigo})`] };
  }
  const sessoes: Sessao[] = [];
  const invalidos: string[] = [];
  for (const n of nomes) {
    try {
      if (!/^[0-9a-f-]{36}\.json$/.test(n)) throw new Error("nome fora do padrão");
      sessoes.push(sessaoSchema.parse(JSON.parse(await readFile(caminhoEmDataDir(`validacao/sessoes/${n}`), "utf8"))));
    } catch {
      invalidos.push(n);
    }
  }
  if (invalidos.length) log.warn("validacao_sessao_invalida", { arquivos: invalidos });
  return { sessoes: sessoes.sort((a, b) => a.criada_em.localeCompare(b.criada_em)), invalidos };
}

export async function listarSessoes(): Promise<Sessao[]> {
  return (await lerTodas()).sessoes;
}

/**
 * Estado da cegueira (ADR 0017): torsos com sessão ABERTA — o gabarito deles (e qualquer número
 * derivado dele: planilha, resultados de outras sessões, benchmark) não sai por nenhuma rota.
 * FAIL CLOSED: se algum arquivo em DATA_DIR/validacao/sessoes não for uma sessão válida, não dá
 * para saber quais torsos estão em sessão, então TODOS os gabaritos ficam bloqueados até o arquivo
 * ser corrigido ou removido à mão (ver ADR 0017).
 */
export interface Bloqueio {
  todos: boolean;
  torsos: ReadonlySet<string>;
  invalidos: readonly string[];
}

export async function bloqueioGabarito(): Promise<Bloqueio> {
  const { sessoes, invalidos } = await lerTodas();
  const torsos = new Set<string>();
  for (const s of sessoes) if (s.estado === "aberta") for (const sc of s.scans) torsos.add(sc.torso);
  return { todos: invalidos.length > 0, torsos, invalidos };
}

export const gabaritoBloqueado = (b: Bloqueio, torso: string): boolean => b.todos || b.torsos.has(torso);
export const algumBloqueio = (b: Bloqueio): boolean => b.todos || b.torsos.size > 0;

/** Compatibilidade: conjunto consultável por `has` (fail closed com arquivo inválido). */
export async function torsosComSessaoAberta(): Promise<{ has: (torso: string) => boolean }> {
  const b = await bloqueioGabarito();
  return { has: (t: string) => gabaritoBloqueado(b, t) };
}

const filas = new Map<string, Promise<unknown>>();
/** Serializa as alterações de uma mesma sessão (leitura → mudança → gravação). */
function comTrava<T>(id: string, f: () => Promise<T>): Promise<T> {
  const anterior = filas.get(id) ?? Promise.resolve();
  const p = anterior.then(f, f);
  const fim = p.catch(() => undefined);
  filas.set(id, fim);
  void fim.then(() => {
    if (filas.get(id) === fim) filas.delete(id);
  });
  return p;
}

// ------------------------------------------------------------------ criação

const ALFABETO = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function codigoScan(usados: Set<string>): string {
  for (;;) {
    let c = "S-";
    for (let i = 0; i < 4; i++) c += ALFABETO[randomInt(ALFABETO.length)];
    if (!usados.has(c)) {
      usados.add(c);
      return c;
    }
  }
}

/** Ordem dos itens: cada repetição é uma permutação dos scans; sem o mesmo scan duas vezes seguidas na virada. */
export function ordemItens(scanIds: readonly string[], repeticoes: number, semente: number): Array<{ scan_id: string; repeticao: number }> {
  const rng = prng(semente);
  const out: Array<{ scan_id: string; repeticao: number }> = [];
  for (let r = 1; r <= repeticoes; r++) {
    const bloco = embaralhar(scanIds, rng);
    if (out.length > 0 && bloco.length > 1 && bloco[0] === out[out.length - 1]!.scan_id) [bloco[0], bloco[1]] = [bloco[1]!, bloco[0]!];
    for (const scan_id of bloco) out.push({ scan_id, repeticao: r });
  }
  return out;
}

export async function criarSessao(entrada: unknown, desenho: Desenho): Promise<Sessao> {
  const e = criarSessaoSchema.parse(entrada);
  const elegiveis = await torsosElegiveis();
  if (elegiveis.length === 0) throw new ErroSessao(409, "sem_torsos_sinteticos", "nenhum torso sintético com gabarito em DATA_DIR/sinteticos (rode 'bash scripts/mesh.sh torsos')");
  const torsos = e.torsos ? [...new Set(e.torsos)] : elegiveis;
  const fora = torsos.filter((t) => !elegiveis.includes(t));
  if (fora.length) throw new ErroSessao(422, "torso_inelegivel", `torso sem gabarito ou inexistente: ${fora.join(", ")}`);
  const usados = new Set<string>();
  const scans = [];
  for (const torso of torsos) scans.push({ scan_id: codigoScan(usados), torso, sha256_gabarito: await sha256Gabarito(torso), sha256_obj: await sha256TorsoObj(torso) });
  // a ordem dos scans na lista também é aleatória: a posição não revela o torso
  const semente = e.semente ?? randomInt(0, 0xffffffff);
  const scansOrdenados = [...scans].sort((a, b) => a.scan_id.localeCompare(b.scan_id));
  const itens = ordemItens(
    scansOrdenados.map((s) => s.scan_id),
    e.repeticoes,
    semente,
  ).map((it, indice) => ({ indice, ...it, registrado_em: null, landmarks: null, distancias: null, avisos: [] }));
  const s: Sessao = {
    esquema: ESQUEMA_SESSAO,
    id: randomUUID(),
    versao_software: versaoSoftware(),
    desenho,
    operador: e.operador,
    tipo_operador: e.tipo_operador,
    repeticoes: e.repeticoes,
    semente,
    estado: "aberta",
    criada_em: isoComFuso(),
    encerrada_em: null,
    scans: scansOrdenados,
    itens,
    observacoes: null,
    resultado: null,
  };
  await gravarSessao(s);
  return s;
}

// ------------------------------------------------------------------ vista para o cliente

export interface VistaSessao {
  esquema: string;
  id: string;
  estado: Sessao["estado"];
  operador: string;
  tipo_operador: Sessao["tipo_operador"];
  repeticoes: number;
  versao_software: string;
  criada_em: string;
  encerrada_em: string | null;
  landmarks_exigidos: readonly string[];
  itens: Array<{ indice: number; scan_id: string; repeticao: number; concluido: boolean }>;
  proximo_indice: number | null;
  /** só depois de encerrada */
  observacoes?: string | null;
  scans?: Sessao["scans"];
  resultado?: unknown;
  /** encerrada, mas com torso ainda em outra sessão aberta: scans e resultado omitidos */
  resultado_oculto?: "sessao_aberta_com_mesmo_torso";
}

/**
 * O que o cliente pode ver. Aberta ou cancelada: só códigos de scan, repetição e "concluído" —
 * nada de torso, gabarito, landmarks ou distâncias. Encerrada: o resultado completo — EXCETO se
 * algum torso dela estiver em outra sessão aberta (`bloqueio`): aí scans e resultado ficam omitidos.
 * Sem `bloqueio` informado, a sessão encerrada também é omitida (fail closed).
 */
export function vistaPublica(s: Sessao, bloqueio?: Bloqueio): VistaSessao {
  const pendente = s.itens.find((i) => i.registrado_em === null);
  const base: VistaSessao = {
    esquema: s.esquema,
    id: s.id,
    estado: s.estado,
    operador: s.operador,
    tipo_operador: s.tipo_operador,
    repeticoes: s.repeticoes,
    versao_software: s.versao_software,
    criada_em: s.criada_em,
    encerrada_em: s.encerrada_em,
    landmarks_exigidos: LANDMARK_IDS,
    itens: s.itens.map((i) => ({ indice: i.indice, scan_id: i.scan_id, repeticao: i.repeticao, concluido: i.registrado_em !== null })),
    proximo_indice: s.estado === "aberta" && pendente ? pendente.indice : null,
  };
  if (s.estado !== "encerrada") return base;
  if (!bloqueio || s.scans.some((sc) => gabaritoBloqueado(bloqueio, sc.torso))) return { ...base, resultado_oculto: "sessao_aberta_com_mesmo_torso" };
  return { ...base, observacoes: s.observacoes, scans: s.scans, resultado: s.resultado };
}

// ------------------------------------------------------------------ marcação

function exigirAberta(s: Sessao) {
  if (s.estado !== "aberta") throw new ErroSessao(409, "sessao_nao_aberta", `sessão ${s.estado}`);
}

/** malha_dir do scan do item (prepara o scan na primeira vez). Só no servidor. */
export async function malhaDoItem(s: Sessao, indice: number): Promise<string> {
  const item = s.itens[indice];
  if (!item) throw new ErroSessao(404, "item_nao_encontrado", "item não encontrado");
  const scan = s.scans.find((x) => x.scan_id === item.scan_id)!;
  return garantirScan(scan.torso, s.desenho);
}

export const marcacaoSchema = z.strictObject({ landmarks: landmarksSchema });

/**
 * Registra os landmarks de um item (na ordem da sessão; um registro por item, imutável). As
 * distâncias são calculadas no servidor (euclidianas aqui, geodésicas pelo services/mesh) e
 * gravadas SEM voltar ao cliente.
 */
export function registrarItem(id: string, indice: number, entrada: unknown, desenho: Desenho): Promise<Sessao> {
  return comTrava(id, async () => {
    const s = await lerSessao(id);
    exigirAberta(s);
    const item = s.itens[indice];
    if (!item) throw new ErroSessao(404, "item_nao_encontrado", "item não encontrado");
    if (item.registrado_em !== null) throw new ErroSessao(409, "item_ja_registrado", "item já registrado (a marcação não pode ser refeita)");
    const pendente = s.itens.find((i) => i.registrado_em === null)!;
    if (pendente.indice !== indice) throw new ErroSessao(409, "fora_de_ordem", `marque o item ${pendente.indice + 1} primeiro (ordem aleatória da sessão)`);
    const { landmarks } = marcacaoSchema.parse(entrada) as { landmarks: Landmarks };
    const faltam = LANDMARK_IDS.filter((l) => !landmarks[l]);
    if (faltam.length) throw new ErroSessao(422, "landmarks_incompletos", `faltam landmarks: ${faltam.join(", ")}`);
    if (Object.values(landmarks).some((l) => l && l.origem !== "clique")) throw new ErroSessao(422, "origem_invalida", "na sessão de validação todo landmark é marcado por clique do operador");
    const malhaDir = await malhaDoItem(s, indice);
    const euclid = Object.fromEntries(Object.entries(distanciasEuclidianas(landmarks)).filter(([, v]) => v !== null)) as Record<string, number>;
    const r = await new ClienteMesh({ desenho }).medir(malhaDir, landmarks, euclid);
    const distancias: Record<string, { euclidiana_mm: number; geodesica_mm: number | null } | null> = {};
    for (const d of DISTANCIA_IDS) distancias[d] = r.distancias[d] ?? null;
    s.itens[indice] = { ...item, registrado_em: isoComFuso(), landmarks, distancias, avisos: r.avisos };
    await gravarSessao(s);
    return s;
  });
}

// ------------------------------------------------------------------ encerramento

export interface ParSessao {
  medida: string;
  distancia: DistanciaId;
  tipo: "euclidiana" | "geodesica";
  referencia_mm: number;
  medido_mm: number;
  desvio_mm: number;
  scan_id: string;
  torso: string;
  repeticao: number;
}

export const NOTAS_RESULTADO = [
  "O LoA geral trata repetições, scans e tipos de medida como pares independentes (pseudo-replicação; Bland & Altman 2007, Stat Methods Med Res 17:571): com medidas repetidas por sujeito ele tende a ficar estreito demais; o LoA para medidas repetidas e o critério final ficam para a análise estatística da fase 1.",
  "n_pares_min_30 conta pares, não sujeitos: não substitui o requisito de ≥ 5 voluntárias ou manequim da ESTRATEGIA.",
];

export interface ResultadoSessao {
  calculado_em: string;
  notas: string[];
  limite_marco1_mm: number;
  limite_estrategia_mm: number;
  pares: ParSessao[];
  geral: ResultadoBlandAltman;
  n_imf: ResultadoBlandAltman;
  sem_n_imf: ResultadoBlandAltman;
  euclidiana: ResultadoBlandAltman;
  geodesica: ResultadoBlandAltman;
  intra_operador: Repetibilidade & { bland_altman_rep2_rep1: ResultadoBlandAltman | null };
  criterios: {
    n_pares: number;
    n_pares_min_30: boolean;
    loa_dentro_3mm: boolean | null;
    loa_dentro_2mm: boolean | null;
    n_imf_relatado_a_parte: true;
    scans_distintos: number;
    vale_para_fase1: boolean;
    motivo_fase1: string;
  };
}

export const ehNimf = (distancia: string): boolean => distancia.startsWith("n_imf");

/** Cálculo do resultado a partir dos itens medidos e dos gabaritos (função pura; testável). */
export function calcularResultado(s: Pick<Sessao, "itens" | "scans" | "tipo_operador">, gabaritos: Record<string, { distancias: Record<string, { euclidiana_mm: number; geodesica_mm: number | null } | null> }>, agora = isoComFuso()): ResultadoSessao {
  const pares: ParSessao[] = [];
  for (const it of s.itens) {
    const scan = s.scans.find((x) => x.scan_id === it.scan_id)!;
    const gab = gabaritos[scan.torso]!;
    for (const d of DISTANCIA_IDS) {
      const g = gab.distancias[d];
      const m = it.distancias?.[d];
      if (!g || !m) continue;
      for (const tipo of ["euclidiana", "geodesica"] as const) {
        const ref = g[`${tipo}_mm`];
        const med = m[`${tipo}_mm`];
        if (ref === null || med === null || ref === undefined || med === undefined) continue;
        pares.push({ medida: `${d}:${tipo}`, distancia: d, tipo, referencia_mm: ref, medido_mm: med, desvio_mm: arred4(med - ref), scan_id: it.scan_id, torso: scan.torso, repeticao: it.repeticao });
      }
    }
  }
  const geral = blandAltman(pares);
  // intra-operador: mesma (scan, medida) nas repetições
  const grupos = new Map<string, Map<number, number>>();
  for (const p of pares) {
    const k = `${p.scan_id}|${p.medida}`;
    const g = grupos.get(k) ?? new Map<number, number>();
    g.set(p.repeticao, p.medido_mm);
    grupos.set(k, g);
  }
  const rep = repetibilidade([...grupos.values()].map((g) => [...g.values()]));
  const paresRep = [...grupos]
    .filter(([, g]) => g.has(1) && g.has(2))
    .map(([k, g]) => ({ medida: k.split("|")[1]!, referencia_mm: g.get(1)!, medido_mm: g.get(2)! }));
  const scansDistintos = new Set(pares.map((p) => p.scan_id)).size;
  return {
    calculado_em: agora,
    notas: [...NOTAS_RESULTADO],
    limite_marco1_mm: LIMITE_MARCO1_MM,
    limite_estrategia_mm: LIMITE_ESTRATEGIA_MM,
    pares,
    geral,
    n_imf: blandAltman(pares.filter((p) => ehNimf(p.distancia))),
    sem_n_imf: blandAltman(pares.filter((p) => !ehNimf(p.distancia))),
    euclidiana: blandAltman(pares.filter((p) => p.tipo === "euclidiana")),
    geodesica: blandAltman(pares.filter((p) => p.tipo === "geodesica")),
    intra_operador: { ...rep, bland_altman_rep2_rep1: paresRep.length ? blandAltman(paresRep) : null },
    criterios: {
      n_pares: pares.length,
      n_pares_min_30: pares.length >= MIN_PARES_FASE1,
      loa_dentro_3mm: geral.dentro_de_3mm,
      loa_dentro_2mm: geral.dentro_de_2mm,
      n_imf_relatado_a_parte: true,
      scans_distintos: scansDistintos,
      // Scans sintéticos nunca bastam para a fase 1 (≥ 5 voluntárias ou manequim, ESTRATEGIA).
      vale_para_fase1: false,
      motivo_fase1:
        s.tipo_operador !== "humano"
          ? "operador simulado e torsos sintéticos: não conta para a fase 1"
          : "torsos sintéticos: a fase 1 exige ≥ 30 pares em ≥ 5 voluntárias ou manequim (scan real com referência medida por fita)",
    },
  };
}

export function encerrarSessao(id: string, entrada: unknown): Promise<Sessao> {
  return comTrava(id, async () => {
    const s = await lerSessao(id);
    exigirAberta(s);
    const { observacoes } = z.strictObject({ observacoes: observacaoSchema.optional() }).parse(entrada ?? {});
    const faltam = s.itens.filter((i) => i.registrado_em === null).length;
    if (faltam) throw new ErroSessao(409, "sessao_incompleta", `faltam ${faltam} item(ns) para encerrar`);
    const gabaritos: Record<string, Awaited<ReturnType<typeof lerGabarito>>> = {};
    for (const sc of s.scans) {
      if ((await sha256TorsoObj(sc.torso)) !== sc.sha256_obj) throw new ErroSessao(409, "torso_alterado", "o torso.obj de um scan mudou durante a sessão; cancele e abra outra");
      if ((await sha256Gabarito(sc.torso)) !== sc.sha256_gabarito) throw new ErroSessao(409, "gabarito_alterado", "o gabarito de um torso mudou durante a sessão; cancele e abra outra");
      gabaritos[sc.torso] = await lerGabarito(sc.torso);
    }
    const agora = isoComFuso();
    const fechada: Sessao = { ...s, estado: "encerrada", encerrada_em: agora, observacoes: observacoes || null, resultado: calcularResultado(s, gabaritos, agora) };
    await gravarSessao(fechada);
    return fechada;
  });
}

export function cancelarSessao(id: string): Promise<Sessao> {
  return comTrava(id, async () => {
    const s = await lerSessao(id);
    exigirAberta(s);
    const c: Sessao = { ...s, estado: "cancelada", encerrada_em: isoComFuso() };
    await gravarSessao(c);
    return c;
  });
}
