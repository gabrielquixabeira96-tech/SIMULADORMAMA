import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

/** Raiz do monorepo: REPO_ROOT ou o primeiro ancestral de cwd com pnpm-workspace.yaml. */
export function raizRepo(): string {
  if (process.env.REPO_ROOT) return resolve(/*turbopackIgnore: true*/ process.env.REPO_ROOT);
  let d = process.cwd();
  for (;;) {
    if (existsSync(resolve(/*turbopackIgnore: true*/ d, "pnpm-workspace.yaml")) && existsSync(resolve(/*turbopackIgnore: true*/ d, "VERSION"))) return d;
    const pai = dirname(d);
    if (pai === d) break;
    d = pai;
  }
  throw new Error("raiz do repositório não encontrada (defina REPO_ROOT)");
}

let versaoCache: string | null = null;
/** Versão do software (arquivo VERSION; injetada como APP_VERSION pelo next.config). */
export function versaoSoftware(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  versaoCache ??= readFileSync(resolve(/*turbopackIgnore: true*/ raizRepo(), "VERSION"), "utf8").trim();
  return versaoCache;
}

/** DATA_DIR absoluto (relativo à raiz do repo quando relativo). */
export function dataDir(): string {
  const bruto = process.env.DATA_DIR || "./data";
  return isAbsolute(bruto) ? resolve(/*turbopackIgnore: true*/ bruto) : resolve(/*turbopackIgnore: true*/ raizRepo(), bruto);
}

export class CaminhoInvalidoError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CaminhoInvalidoError";
  }
}

/**
 * Resolve um caminho RELATIVO a DATA_DIR, recusando absolutos, `..` e qualquer escape
 * (contratos §5.4; ADR 0003 item 8).
 */
export function caminhoEmDataDir(relativo: string, base = dataDir()): string {
  if (!relativo || isAbsolute(relativo) || /^[A-Za-z]:/.test(relativo) || relativo.includes("\0")) {
    throw new CaminhoInvalidoError("caminho deve ser relativo a DATA_DIR");
  }
  const partes = relativo.split(/[\\/]/);
  if (partes.includes("..")) throw new CaminhoInvalidoError("caminho com '..' recusado");
  const absoluto = resolve(/*turbopackIgnore: true*/ base, relativo);
  const baseNorm = resolve(/*turbopackIgnore: true*/ base);
  if (absoluto !== baseNorm && !absoluto.startsWith(baseNorm + sep)) {
    throw new CaminhoInvalidoError("caminho escapa de DATA_DIR");
  }
  return absoluto;
}

export function usuarioAtual(): string {
  return process.env.USUARIO_LOCAL_ID || "local";
}

export function meshServiceUrl(): string {
  return (process.env.MESH_SERVICE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
}

export function meshTimeoutMs(): number {
  const n = Number(process.env.MESH_SERVICE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
}

/** Data-hora ISO 8601 com o fuso local do processo (TZ), ex. 2026-09-26T14:00:00-04:00. */
export function isoComFuso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sinal}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}
