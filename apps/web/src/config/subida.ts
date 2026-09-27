import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { consultar } from "@/db/pool";
import { log } from "@/log/logger";
import { hostsForaDoLoopback, modoBenchmarkNaRede, modoDemoSintetica } from "@/seguranca/requisicao";
import { dataDir } from "./ambiente";
import { getDesenho } from "./desenho";

/**
 * Exceção controlada do ADR 0003 (revisão v0.1.2): benchmark alcançável pela rede local só numa
 * instância SEPARADA e sem dados de paciente. No modo "benchmark na rede" (`BENCHMARK_HABILITADO=1`
 * e algum host fora do loopback em `APP_HOSTS_PERMITIDOS`), a subida é recusada se `DATABASE_URL`
 * estiver definido (os pacientes vivem no Postgres; o benchmark não usa banco) ou se
 * `DATA_DIR/pacientes` existir. No modo demo sintética (ADR 0018) esse modo não se aplica: a
 * demo tem banco próprio, atestado por `verificarDadosDemo`.
 */
export function verificarBenchmarkNaRede(
  env: { BENCHMARK_HABILITADO?: string | undefined; APP_HOSTS_PERMITIDOS?: string | undefined; DATABASE_URL?: string | undefined; DEMO_SINTETICA?: string | undefined },
  existePacientes: () => boolean,
): void {
  if (!modoBenchmarkNaRede(env)) return;
  const hosts = hostsForaDoLoopback(env.APP_HOSTS_PERMITIDOS).join(", ");
  const base = `BENCHMARK_HABILITADO=1 com APP_HOSTS_PERMITIDOS fora do loopback (${hosts}) é instância só de benchmark (ADR 0003, revisão v0.1.2)`;
  if ((env.DATABASE_URL ?? "").trim() !== "") throw new Error(`${base}: DATABASE_URL tem de ficar vazio`);
  if (existePacientes()) throw new Error(`${base}: exige um DATA_DIR sem pacientes/`);
}

// ------------------------------------------------------------------ modo demo sintética (ADR 0018)

/** Marca gravada como COMMENT ON DATABASE no banco criado para a demo (`migrar.ts --marcar-demo`). */
export const MARCA_BANCO_DEMO = "simulador-mamario:demo-sintetica";

const TOKEN_MIN_CARACTERES = 32;
const TOKEN_MIN_BITS_EMPIRICOS = 96;

/**
 * Token da demo forte o bastante? Devolve o motivo da recusa ou `null`. Regras: ≥ 32 caracteres;
 * ≥ 10 caracteres distintos; não periódico (`abcabc…`); não sequencial (`abcdef…`, `0123…`); sem
 * palavra de exemplo; entropia empírica (Shannon × comprimento) ≥ 96 bits. `openssl rand -hex 32`
 * (o que o scripts/demo_sandbox.sh usa) passa com folga.
 */
export function motivoTokenFraco(token: string): string | null {
  // valor CRU, sem trim: o proxy compara exatamente o que está no ambiente
  const t = token;
  if (t.length < TOKEN_MIN_CARACTERES) return `APP_TOKEN_LOCAL com ${t.length} caracteres (mínimo ${TOKEN_MIN_CARACTERES}; use openssl rand -hex 32)`;
  if (/token|senha|segredo|secret|password|changeme|exemplo|example|troque|xxxx/i.test(t)) return "APP_TOKEN_LOCAL parece valor de exemplo";
  const freq = new Map<string, number>();
  for (const c of t) freq.set(c, (freq.get(c) ?? 0) + 1);
  if (freq.size < 10) return `APP_TOKEN_LOCAL com só ${freq.size} caracteres distintos`;
  for (let p = 1; p <= t.length / 2; p++) {
    if (t === t.slice(0, p).repeat(Math.ceil(t.length / p)).slice(0, t.length)) return "APP_TOKEN_LOCAL periódico (padrão repetido)";
  }
  let iguais = 0;
  for (let i = 2; i < t.length; i++) if (t.charCodeAt(i) - t.charCodeAt(i - 1) === t.charCodeAt(i - 1) - t.charCodeAt(i - 2)) iguais++;
  if (iguais > (t.length - 2) / 2) return "APP_TOKEN_LOCAL sequencial";
  let h = 0;
  for (const n of freq.values()) {
    const pr = n / t.length;
    h -= pr * Math.log2(pr);
  }
  if (h * t.length < TOKEN_MIN_BITS_EMPIRICOS) return `APP_TOKEN_LOCAL com entropia baixa (~${Math.round(h * t.length)} bits; mínimo ${TOKEN_MIN_BITS_EMPIRICOS})`;
  return null;
}

/**
 * Checagens de AMBIENTE do modo demo (síncronas). `DEMO_SINTETICA` só aceita "1" (ligado), "0" ou
 * vazio (desligado): um valor como "true" recusaria em silêncio a intenção do operador. Com a
 * demo ligada: LLM travado em mock (sem `ANTHROPIC_API_KEY`, `LLM_MODO=mock` explícito), token
 * forte no formato `^[0-9a-f]{64}$` (valor cru, sem trim) e `DATABASE_URL` definido (banco próprio da demo).
 */
export function verificarAmbienteDemo(env: Readonly<Record<string, string | undefined>>): void {
  const v = env.DEMO_SINTETICA ?? "";
  if (v !== "" && v !== "0" && v !== "1") throw new Error(`DEMO_SINTETICA='${v}' inválido: use 1 (ligado) ou deixe vazio/0 (desligado)`);
  if (!modoDemoSintetica(env)) return;
  const base = "DEMO_SINTETICA=1 (ADR 0018)";
  if ((env.ANTHROPIC_API_KEY ?? "").trim() !== "") throw new Error(`${base}: ANTHROPIC_API_KEY tem de ficar vazia (LLM só em mock; nenhum dado sai do Brasil)`);
  if ((env.LLM_MODO ?? "").trim().toLowerCase() !== "mock") throw new Error(`${base}: LLM_MODO=mock obrigatório (recebido '${env.LLM_MODO ?? ""}')`);
  const token = env.APP_TOKEN_LOCAL ?? "";
  const fraco = motivoTokenFraco(token);
  if (fraco) throw new Error(`${base}: ${fraco}`);
  // formato exato do scripts/demo_sandbox.sh (openssl rand -hex 32), comparado CRU (sem trim), como no proxy
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error(`${base}: APP_TOKEN_LOCAL tem de ter exatamente 64 caracteres hexadecimais minúsculos (openssl rand -hex 32)`);
  if ((env.DATABASE_URL ?? "").trim() === "") throw new Error(`${base}: DATABASE_URL obrigatório (banco próprio da demo, criado por scripts/demo_sandbox.sh)`);
}

export type ConsultaDemo = (sql: string) => Promise<Record<string, unknown>[]>;

/**
 * Checagens de DADOS do modo demo (subida recusa se qualquer uma falhar):
 *  1. o banco tem a marca `MARCA_BANCO_DEMO` (só um banco novo e vazio recebe a marca: a
 *     instância do consultório nunca é reaproveitada);
 *  2. nenhuma malha com `sintetica = false`;
 *  3. nenhuma anamnese gravada (o texto livre é fechado na demo: se há anamnese, o banco não é da demo);
 *  4. em `DATA_DIR/pacientes`, toda pasta de paciente é de um pseudônimo do banco e toda pasta
 *     `malhas/<id>` é de uma malha SINTÉTICA registrada (nada de arquivo solto de scan real).
 */
export async function verificarDadosDemo(consulta: ConsultaDemo, dir: string): Promise<void> {
  const base = "DEMO_SINTETICA=1 (ADR 0018)";
  const marca = (await consulta("select shobj_description(d.oid, 'pg_database') as marca from pg_database d where d.datname = current_database()"))[0]?.marca ?? null;
  if (marca !== MARCA_BANCO_DEMO) throw new Error(`${base}: o banco não é de demonstração (sem a marca '${MARCA_BANCO_DEMO}'); crie um banco próprio e vazio com scripts/demo_sandbox.sh`);
  const reais = Number((await consulta("select count(*)::int as n from malhas where not sintetica"))[0]?.n ?? NaN);
  if (reais !== 0) throw new Error(`${base}: o banco tem ${Number.isNaN(reais) ? "?" : reais} malha(s) não sintética(s)`);
  const anamneses = Number((await consulta("select count(*)::int as n from atendimentos where anamnese is not null"))[0]?.n ?? NaN);
  if (anamneses !== 0) throw new Error(`${base}: o banco tem ${Number.isNaN(anamneses) ? "?" : anamneses} anamnese(s) em texto livre estruturada(s); não é banco de demonstração`);

  const raiz = join(dir, "pacientes");
  if (!existsSync(raiz)) return;
  const linhas = await consulta("select p.pseudonimo, m.malha_dir from pacientes p left join malhas m on m.paciente_id = p.id and m.sintetica");
  const pseudonimos = new Set(linhas.map((l) => String(l.pseudonimo)));
  const malhasSinteticas = new Set(linhas.filter((l) => typeof l.malha_dir === "string").map((l) => String(l.malha_dir)));
  for (const ps of readdirSync(raiz, { withFileTypes: true })) {
    const rel = `pacientes/${ps.name}`;
    if (!ps.isDirectory() || !pseudonimos.has(ps.name)) throw new Error(`${base}: DATA_DIR/${rel} não pertence a paciente do banco da demo`);
    const malhas = join(raiz, ps.name, "malhas");
    if (!existsSync(malhas)) continue;
    for (const m of readdirSync(malhas, { withFileTypes: true })) {
      if (!malhasSinteticas.has(`${rel}/malhas/${m.name}`)) throw new Error(`${base}: DATA_DIR/${rel}/malhas/${m.name} não é malha sintética registrada`);
    }
  }
}

/**
 * Chamado por instrumentation.ts (runtime Node): DESENHO inválido → encerra o processo. Em
 * produção (`next start`), `APP_TOKEN_LOCAL` ausente também encerra (ADR 0003 item 7). Com
 * `DEMO_SINTETICA=1`, as checagens do ADR 0018 (ambiente e dados) também encerram.
 */
export async function validarAmbienteNaSubida(): Promise<void> {
  try {
    const desenho = getDesenho();
    if (process.env.NODE_ENV === "production" && !process.env.APP_TOKEN_LOCAL) {
      throw new Error("APP_TOKEN_LOCAL obrigatório em produção (next start); veja .env.example");
    }
    verificarAmbienteDemo(process.env);
    verificarBenchmarkNaRede(
      { BENCHMARK_HABILITADO: process.env.BENCHMARK_HABILITADO, APP_HOSTS_PERMITIDOS: process.env.APP_HOSTS_PERMITIDOS, DATABASE_URL: process.env.DATABASE_URL, DEMO_SINTETICA: process.env.DEMO_SINTETICA },
      () => existsSync(join(dataDir(), "pacientes")),
    );
    if (modoDemoSintetica({ DEMO_SINTETICA: process.env.DEMO_SINTETICA })) {
      await verificarDadosDemo(async (sql) => (await consultar(sql)).rows, dataDir());
      if (process.env.APP_BUILD_DEMO !== "1") log.warn("build_nao_e_da_demo", { nota: "build sem DEMO_SINTETICA=1: teto de corpo do proxy continua 520 MB (upload fechado mesmo assim); use scripts/demo_sandbox.sh preparar" });
      log.warn("modo_demo_sintetica", { hosts: hostsForaDoLoopback(process.env.APP_HOSTS_PERMITIDOS).length, nota: "upload e anamnese fechados; LLM em mock; só torsos sintéticos (ADR 0018)" });
    }
    if (!process.env.APP_TOKEN_LOCAL) log.warn("token_local_desligado", { motivo: "APP_TOKEN_LOCAL ausente (só aceito em next dev)" });
    log.info("servidor_subindo", { desenho });
  } catch (e) {
    log.error("inicializacao_recusada", { erro: e });
    process.exit(1);
  }
}
