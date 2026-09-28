import { open, readFile, stat } from "node:fs/promises";
import {
  avaliacaoDeExtras,
  avaliacaoReconstrucaoSchema,
  reconstrucaoDeExtras,
  reconstrucaoSchema,
  type AvaliacaoReconstrucao,
  type Reconstrucao,
} from "@simulador/contratos";
import { caminhoEmDataDir } from "@/config/ambiente";
import { algumBloqueio, bloqueioGabarito, gabaritoBloqueado, type Bloqueio } from "@/validacao/sessao";
import { temPerfil } from "./publica";

/**
 * Leitura (servidor) da reconstrução de uma malha feita a partir de fotos (plano "foto → 3D"):
 * `reconstrucao.json` (C1) na pasta da malha; sem ele, `asset.extras` do `processada.glb` com
 * `origem: "foto"` (só o bloco JSON do .glb é lido, não a malha). A avaliação contra o gabarito
 * (torso sintético) vem de `avaliacao.json` ou do mesmo `extras`.
 */

export const ARQUIVO_RECONSTRUCAO = "reconstrucao.json";
export const ARQUIVO_AVALIACAO = "avaliacao.json";
export const ARQUIVO_OBSERVADO = "observado.png";

const existe = (abs: string) =>
  stat(abs)
    .then((s) => s.isFile())
    .catch(() => false);

/** Bloco JSON de um .glb (cabeçalho de 12 bytes + 1º chunk), sem ler o binário. Null se não for GLB. */
export async function jsonDoGlb(abs: string): Promise<Record<string, unknown> | null> {
  const f = await open(abs, "r").catch(() => null);
  if (!f) return null;
  try {
    const cab = Buffer.alloc(20);
    const { bytesRead } = await f.read(cab, 0, 20, 0);
    if (bytesRead < 20 || cab.readUInt32LE(0) !== 0x46546c67 || cab.readUInt32LE(16) !== 0x4e4f534a) return null;
    const n = cab.readUInt32LE(12);
    if (n <= 0 || n > 64 * 1024 * 1024) return null;
    const json = Buffer.alloc(n);
    await f.read(json, 0, n, 20);
    return JSON.parse(json.toString("utf8").trimEnd()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    await f.close();
  }
}

export interface ReconstrucaoLida {
  reconstrucao: Reconstrucao;
  avaliacao: AvaliacaoReconstrucao | null;
  observado: boolean;
  fonte: "reconstrucao.json" | "glb";
}

/** Reconstrução da malha em `malhaDir` (relativo a DATA_DIR), ou null se a malha não veio de fotos. */
export async function lerReconstrucao(malhaDir: string): Promise<ReconstrucaoLida | null> {
  const abs = (n: string) => caminhoEmDataDir(`${malhaDir}/${n}`);
  let reconstrucao: Reconstrucao | null = null;
  let avaliacao: AvaliacaoReconstrucao | null = null;
  let fonte: ReconstrucaoLida["fonte"] = "reconstrucao.json";
  if (await existe(abs(ARQUIVO_RECONSTRUCAO))) {
    reconstrucao = reconstrucaoSchema.parse(JSON.parse(await readFile(abs(ARQUIVO_RECONSTRUCAO), "utf8")));
    const av = (reconstrucao as Record<string, unknown>).avaliacao;
    if (av && typeof av === "object") avaliacao = avaliacaoReconstrucaoSchema.safeParse({ esquema: "avaliacao_reconstrucao/1.0", ...av }).data ?? null;
  }
  if (!reconstrucao) {
    const extras = ((await jsonDoGlb(abs("processada.glb")))?.asset as { extras?: Record<string, unknown> } | undefined)?.extras;
    reconstrucao = reconstrucaoDeExtras(extras);
    if (!reconstrucao) return null;
    avaliacao = avaliacaoDeExtras(extras);
    fonte = "glb";
  }
  if (await existe(abs(ARQUIVO_AVALIACAO))) {
    const p = avaliacaoReconstrucaoSchema.safeParse(JSON.parse(await readFile(abs(ARQUIVO_AVALIACAO), "utf8")));
    if (p.success) avaliacao = p.data;
  }
  return { reconstrucao, avaliacao, observado: await existe(abs(ARQUIVO_OBSERVADO)), fonte };
}

/**
 * A malha veio de fotos? (`reconstrucao.json` na pasta ou `meta.origem === "foto"`). Só então a rota de
 * arquivo serve `original/foto_<vista>.*` e `observado.png` (um scan enviado com uma textura chamada
 * `foto_frente.jpg` não sai por aqui).
 */
export async function malhaDeFoto(malhaDir: string, meta?: { origem?: unknown } | null): Promise<boolean> {
  return meta?.origem === "foto" || existe(caminhoEmDataDir(`${malhaDir}/${ARQUIVO_RECONSTRUCAO}`));
}

/**
 * Malha reconstruída de fotos SEM foto de perfil: a profundidade é o prior do template (só
 * ilustração, C1) e nenhum número de projeção (`previsto`) sai do servidor, nem em B. Falha de
 * leitura do C1 conta como "sem perfil" (fechado).
 */
export async function previstoProibidoPorFoto(malhaDir: string): Promise<boolean> {
  try {
    const l = await lerReconstrucao(malhaDir);
    return !!l && !temPerfil(l.reconstrucao);
  } catch {
    return true;
  }
}

/**
 * Cegamento da sessão de Bland-Altman (ADR 0017): a avaliação contra o gabarito de um torso com sessão
 * aberta não sai. Sem o nome do torso na avaliação, qualquer bloqueio a esconde (fechado).
 */
export function avaliacaoLiberada(av: AvaliacaoReconstrucao | null, bloqueio: Bloqueio): AvaliacaoReconstrucao | null {
  if (!av) return null;
  const torso = typeof av.torso === "string" ? av.torso : null;
  return (torso ? gabaritoBloqueado(bloqueio, torso) : algumBloqueio(bloqueio)) ? null : av;
}

export async function avaliacaoLiberadaAgora(av: AvaliacaoReconstrucao | null): Promise<AvaliacaoReconstrucao | null> {
  return av ? avaliacaoLiberada(av, await bloqueioGabarito()) : null;
}
