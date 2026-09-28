/**
 * Paridade TypeScript × Python do Bland-Altman (ADR 0017): `apps/web/src/validacao/estatistica.ts`
 * contra a referência `services/mesh/mesh/medir/bland_altman.py`, rodada no Python do venv com os
 * MESMOS pares (pseudoaleatórios, semente fixa). Tolerância: 1e-4 mm — os dois lados arredondam a
 * 4 casas, então a única diferença admissível é um passo de arredondamento (ponto flutuante na
 * soma em ordem diferente pode cair do outro lado de um ...5). Sem venv, pulado; com
 * EXIGIR_MESH_REAL=1 (CI), a falta do venv é falha explícita.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blandAltman, prng } from "@/validacao/estatistica";
import { PYTHON, exigirMeshReal, meshRealInstalado } from "../helpers/meshReal";

const TOL_MM = 1e-4;
const RAIZ = resolve(__dirname, "../../../..");

function pares(semente: number, n: number) {
  const r = prng(semente);
  const medidas = ["ssn_n_dir:euclidiana", "n_imf_dir:geodesica", "base_esq:euclidiana", "intermamilar:geodesica"];
  return Array.from({ length: n }, (_, i) => {
    const ref = 50 + r() * 200;
    return { medida: medidas[i % medidas.length]!, referencia_mm: Math.round(ref * 100) / 100, medido_mm: Math.round((ref + (r() - 0.45) * 3) * 100) / 100 };
  });
}

function python(ps: ReturnType<typeof pares>): any {
  const prog = "import json,sys\nfrom mesh.medir.bland_altman import bland_altman\nprint(json.dumps(bland_altman(json.load(sys.stdin))))";
  const out = execFileSync(PYTHON, ["-c", prog], { cwd: resolve(RAIZ, "services/mesh"), input: JSON.stringify(ps), encoding: "utf8" });
  return JSON.parse(out);
}

if (!meshRealInstalado() && exigirMeshReal()) {
  describe("paridade Bland-Altman exigida (EXIGIR_MESH_REAL=1)", () => {
    it("venv do services/mesh presente", () => expect.fail(`venv ausente: ${PYTHON}`));
  });
}

if (meshRealInstalado()) describe("paridade Bland-Altman TypeScript × Python (tolerância 1e-4 mm)", () => {
  it.each([
    [1, 5],
    [2, 30],
    [3, 84],
    [4, 200],
  ])("semente %i, n = %i", (semente, n) => {
    const ps = pares(semente, n);
    const ts = blandAltman(ps);
    const py = python(ps);
    for (const k of ["n", "vies_mm", "dp_mm", "loa_inferior_mm", "loa_superior_mm", "erro_abs_max_mm"] as const) {
      expect(Math.abs((ts[k] as number) - py[k]), k).toBeLessThanOrEqual(TOL_MM + 1e-12);
    }
    expect(ts.dentro_de_2mm).toBe(py.dentro_de_2mm);
    expect(Object.keys(ts.por_medida).sort()).toEqual(Object.keys(py.por_medida).sort());
    for (const [m, r] of Object.entries(ts.por_medida)) {
      for (const k of ["n", "vies_mm", "dp_mm", "loa_inferior_mm", "loa_superior_mm"] as const) {
        const a = r[k];
        const b = py.por_medida[m][k];
        if (a === null || b === null) expect(a).toBe(b);
        else expect(Math.abs(a - b), `${m}.${k}`).toBeLessThanOrEqual(TOL_MM + 1e-12);
      }
    }
  });
});
