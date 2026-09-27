import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { DECIMACAO_PADRAO, type Desenho } from "@simulador/contratos";
import { z } from "zod";
import { caminhoEmDataDir, isoComFuso } from "@/config/ambiente";
import { ClienteMesh } from "@/mesh/cliente";

/**
 * Scans da sessão de Bland-Altman (ADR 0017): SÓ torsos sintéticos de DATA_DIR/sinteticos que têm
 * gabarito. Cada torso é processado UMA vez pelo mesmo caminho de uma malha enviada (/processar:
 * recorte, limpeza, decimação) em DATA_DIR/validacao/malhas/<id>/ — fora de pacientes/, porque
 * não é dado de paciente — e reaproveitado enquanto o torso.obj não mudar (sha256).
 */

const NOME_TORSO = /^[a-z0-9_]+$/;

export const gabaritoSessaoSchema = z
  .object({
    esquema: z.literal("gabarito/1.0"),
    landmarks: z.record(z.string(), z.object({ posicao: z.tuple([z.number(), z.number(), z.number()]) }).passthrough()),
    distancias: z.record(z.string(), z.object({ euclidiana_mm: z.number(), geodesica_mm: z.number().nullable() }).nullable()),
  })
  .passthrough();
export type GabaritoSessao = z.infer<typeof gabaritoSessaoSchema>;

const preparoSchema = z.object({ torso: z.string(), sha256_obj: z.string(), malha_dir: z.string(), n_vertices: z.number().int(), preparado_em: z.string() });

export const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

/** Torsos sintéticos elegíveis (torso.obj + gabarito.json válidos), em ordem alfabética. */
export async function torsosElegiveis(): Promise<string[]> {
  let nomes: string[] = [];
  try {
    nomes = (await readdir(caminhoEmDataDir("sinteticos"), { withFileTypes: true })).filter((d) => d.isDirectory() && NOME_TORSO.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  const ok: string[] = [];
  for (const nome of nomes.sort()) {
    const obj = await stat(caminhoEmDataDir(`sinteticos/${nome}/torso.obj`)).catch(() => null);
    if (!obj?.isFile()) continue;
    if (await lerGabarito(nome).then(() => true, () => false)) ok.push(nome);
  }
  return ok;
}

/** Gabarito do torso — SÓ no servidor; nunca sai para o cliente com a sessão aberta. */
export async function lerGabarito(torso: string): Promise<GabaritoSessao> {
  if (!NOME_TORSO.test(torso)) throw new Error("nome de torso inválido");
  return gabaritoSessaoSchema.parse(JSON.parse(await readFile(caminhoEmDataDir(`sinteticos/${torso}/gabarito.json`), "utf8")));
}

export async function sha256TorsoObj(torso: string): Promise<string> {
  if (!NOME_TORSO.test(torso)) throw new Error("nome de torso inválido");
  return sha256(await readFile(caminhoEmDataDir(`sinteticos/${torso}/torso.obj`)));
}

export async function sha256Gabarito(torso: string): Promise<string> {
  return sha256(await readFile(caminhoEmDataDir(`sinteticos/${torso}/gabarito.json`)));
}

/**
 * Pasta do scan: validacao/malhas/<uuid derivado do nome do torso> (determinística; um UUID como
 * último segmento vira o `malha_id` do malha_meta/1.0, como nas malhas de paciente).
 */
export function malhaDirDoTorso(torso: string): string {
  const h = sha256(`simulador:validacao:${torso}`);
  return `validacao/malhas/${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const emPreparo = new Map<string, Promise<string>>();

/**
 * Garante o scan processado do torso e devolve o `malha_dir` (relativo a DATA_DIR). Chamadas
 * concorrentes do mesmo torso compartilham a mesma preparação.
 */
export function garantirScan(torso: string, desenho: Desenho): Promise<string> {
  const pendente = emPreparo.get(torso);
  if (pendente) return pendente;
  const p = prepararScan(torso, desenho).finally(() => emPreparo.delete(torso));
  emPreparo.set(torso, p);
  return p;
}

async function prepararScan(torso: string, desenho: Desenho): Promise<string> {
  if (!NOME_TORSO.test(torso)) throw new Error("nome de torso inválido");
  const malhaDir = malhaDirDoTorso(torso);
  const obj = await readFile(caminhoEmDataDir(`sinteticos/${torso}/torso.obj`));
  const shaObj = sha256(obj);
  try {
    const p = preparoSchema.parse(JSON.parse(await readFile(caminhoEmDataDir(`${malhaDir}/preparo.json`), "utf8")));
    if (p.sha256_obj === shaObj && p.malha_dir === malhaDir) return malhaDir;
  } catch {
    // sem preparo válido: processa de novo
  }
  const abs = caminhoEmDataDir(malhaDir);
  await rm(abs, { recursive: true, force: true });
  await mkdir(caminhoEmDataDir(`${malhaDir}/original`), { recursive: true });
  for (const a of ["torso.obj", "torso.mtl", "textura.png"]) {
    await copyFile(caminhoEmDataDir(`sinteticos/${torso}/${a}`), caminhoEmDataDir(`${malhaDir}/original/${a}`)).catch((e) => {
      if (a === "torso.obj") throw e;
    });
  }
  const meta = await new ClienteMesh({ desenho }).processar({
    malha_dir: malhaDir,
    arquivo_original: "original/torso.obj",
    unidade_origem: "mm",
    recorte: { modo: "abaixo_do_pescoco", y_max_mm: null, y_min_mm: null },
    decimacao: { ...DECIMACAO_PADRAO },
  });
  await writeFile(
    caminhoEmDataDir(`${malhaDir}/preparo.json`),
    JSON.stringify({ torso, sha256_obj: shaObj, malha_dir: malhaDir, n_vertices: meta.processada.n_vertices, preparado_em: isoComFuso() }, null, 2),
  );
  return malhaDir;
}
