/**
 * Sobe o services/mesh REAL (FastAPI, Python) numa porta livre, apontando para o DATA_DIR do
 * teste, para os testes de integração sem MSW. Fora da CI, se faltar venv, torso ou banco, os
 * testes de integração se auto-pulam. Com EXIGIR_MESH_REAL=1 (exportado por `scripts/ci.sh`, que
 * cria o venv e gera os torsos antes), a falta de qualquer pré-requisito vira FALHA explícita.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

const RAIZ = resolve(__dirname, "../../../..");
export const PYTHON = resolve(RAIZ, "services/mesh/.venv/bin/python");
export const SINTETICOS = resolve(RAIZ, "data/sinteticos");
export const TORSOS = ["t01_simetrico_300", "t02_assimetrico", "t03_pequeno_ptose"] as const;

export const meshRealInstalado = (): boolean => existsSync(PYTHON);
export const torsoDisponivel = (nome: string): boolean =>
  ["torso.obj", "torso.mtl", "textura.png", "gabarito.json"].every((a) => existsSync(resolve(SINTETICOS, nome, a)));

/** EXIGIR_MESH_REAL=1: a integração real não pode ser pulada (CI). */
export const exigirMeshReal = (): boolean => process.env.EXIGIR_MESH_REAL === "1";

/** Pré-requisitos ausentes da integração real (vazio = pronto para rodar). */
export function faltasMeshReal(torso: string, dbOk: boolean): string[] {
  const faltas: string[] = [];
  if (!meshRealInstalado()) faltas.push(`venv do services/mesh (${PYTHON}; rode 'bash scripts/mesh.sh venv')`);
  if (!torsoDisponivel(torso)) faltas.push(`torso sintético ${torso} em ${SINTETICOS} (rode 'bash scripts/mesh.sh torsos')`);
  if (!dbOk) faltas.push("Postgres de teste (rode 'bash scripts/db.sh start criar')");
  return faltas;
}

async function portaLivre(): Promise<number> {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
    s.on("error", erro);
  });
}

export interface ServidorMesh {
  url: string;
  parar: () => Promise<void>;
}

export async function subirMeshReal(dataDir: string): Promise<ServidorMesh> {
  const porta = await portaLivre();
  const proc: ChildProcess = spawn(PYTHON, ["-m", "mesh.servidor", "--host", "127.0.0.1", "--port", String(porta)], {
    cwd: resolve(RAIZ, "services/mesh"),
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr?.on("data", (d) => (stderr += String(d)));
  const url = `http://127.0.0.1:${porta}`;
  const limite = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/saude`);
      if (r.ok) break;
    } catch {
      /* ainda subindo */
    }
    if (proc.exitCode !== null || Date.now() > limite) throw new Error(`services/mesh não subiu: ${stderr.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    url,
    parar: () =>
      new Promise((ok) => {
        if (proc.exitCode !== null) return ok();
        proc.once("exit", () => ok());
        proc.kill("SIGTERM");
      }),
  };
}

export interface Gabarito {
  landmarks: Record<string, { posicao: [number, number, number]; vertice: number }>;
  distancias: Record<string, { euclidiana_mm: number; geodesica_mm: number } | null>;
  volumes: Record<string, { adicionado_ml: number }>;
}
export const lerGabarito = (nome: string): Gabarito => JSON.parse(readFileSync(resolve(SINTETICOS, nome, "gabarito.json"), "utf8"));

/** Vértices de um OBJ (só linhas `v`). */
export function verticesObj(caminho: string): Float64Array {
  const out: number[] = [];
  for (const l of readFileSync(caminho, "utf8").split("\n")) {
    if (l.startsWith("v ")) {
      const [, x, y, z] = l.trim().split(/\s+/);
      out.push(Number(x), Number(y), Number(z));
    }
  }
  return Float64Array.from(out);
}

export function verticeMaisProximo(v: Float64Array, p: readonly number[]): number {
  let melhor = 0;
  let dm = Infinity;
  for (let i = 0; i < v.length / 3; i++) {
    const dx = v[3 * i]! - p[0]!, dy = v[3 * i + 1]! - p[1]!, dz = v[3 * i + 2]! - p[2]!;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < dm) {
      dm = d;
      melhor = i;
    }
  }
  return melhor;
}
