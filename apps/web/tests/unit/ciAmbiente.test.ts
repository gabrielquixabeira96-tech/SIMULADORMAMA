/**
 * CI honesta (v0.1.2, PT1: itens A1, A2 e A4). Guardas de `scripts/ci.sh`: validação de schema
 * com jsonschema de verdade (sem "[pulado]" silencioso), integração real exigida e testes pulados
 * derrubando `vale_como_validacao`. Rodam os trechos reais do script em pastas temporárias; nada
 * do repositório é alterado. Nenhum teste aqui se auto-pula (um pulado invalidaria a CI).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { faltasMeshReal } from "../helpers/meshReal";

const RAIZ = resolve(__dirname, "../../../..");
const CI = readFileSync(join(RAIZ, "scripts/ci.sh"), "utf8");
const tmps: string[] = [];
const novoTmp = (prefixo: string) => {
  const d = mkdtempSync(join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
};
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Corpo de um heredoc python (`<<'TAG'` ... `TAG`) de scripts/ci.sh. */
function heredoc(tag: string): string {
  const m = CI.match(new RegExp(`<<'${tag}'\\n([\\s\\S]*?)\\n${tag}\\n`));
  if (!m) throw new Error(`heredoc ${tag} não encontrado em scripts/ci.sh`);
  return m[1]!;
}
const py = (codigo: string, args: string[]) => spawnSync("python3", ["-", ...args], { input: codigo, encoding: "utf8" });

/** Primeiro Python que importa jsonschema (o do venv do services/mesh, como na CI). */
function pythonComJsonschema(): string | null {
  for (const p of [join(RAIZ, "services/mesh/.venv/bin/python"), "python3"]) {
    if (spawnSync(p, ["-c", "import jsonschema"]).status === 0) return p;
  }
  return null;
}

describe("A1: schemas validados de verdade na CI", () => {
  it("ci.sh usa o Python do venv e FALHA sem jsonschema (nada de pular para só sintaxe)", () => {
    expect(CI).not.toMatch(/pular "python 'jsonschema' ausente/);
    expect(CI).toMatch(/for cand in "\$PY" python3; do/);
    expect(CI).toMatch(/falha "jsonschema ausente/);
    expect(CI).toMatch(/SCHEMA_VALIDADO=1/);
  });

  it("um campo inválido em config/simulacao.json derruba scripts/validar_config.py", () => {
    const d = novoTmp("simulador-schema-");
    cpSync(join(RAIZ, "scripts"), join(d, "scripts"), { recursive: true });
    cpSync(join(RAIZ, "config"), join(d, "config"), { recursive: true });
    cpSync(join(RAIZ, "docs/validacao"), join(d, "docs/validacao"), { recursive: true });
    cpSync(join(RAIZ, "VERSION"), join(d, "VERSION"));
    const pyJs = pythonComJsonschema();
    const rodar = () => spawnSync(pyJs ?? "python3", [join(d, "scripts/validar_config.py")], { encoding: "utf8" });
    if (!pyJs) {
      // Sem jsonschema o validador sai ≠0 (2), nunca 0: a CI registra falha, não "ok".
      expect(rodar().status).toBe(2);
      return;
    }
    expect(rodar().status, rodar().stderr).toBe(0);
    const cfg = JSON.parse(readFileSync(join(d, "config/simulacao.json"), "utf8"));
    cfg.campo_que_nao_existe_no_schema = 1; // schema com additionalProperties: false
    writeFileSync(join(d, "config/simulacao.json"), JSON.stringify(cfg));
    const r = rodar();
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/campo_que_nao_existe_no_schema/);
  });
});

describe("A2: integração real obrigatória e testes pulados no resumo", () => {
  it("ci.sh gera os torsos que faltarem e exporta EXIGIR_MESH_REAL=1 para o Vitest web", () => {
    expect(CI).toMatch(/bash scripts\/mesh\.sh torsos/);
    expect(CI).toMatch(/EXIGIR_MESH_REAL=1 pnpm --filter web run test/);
    expect(CI).toMatch(/--outputFile\.json=/);
  });

  it("faltasMeshReal lista torso e banco ausentes (com EXIGIR_MESH_REAL=1 viram falha)", () => {
    const f = faltasMeshReal("torso_que_nao_existe", false);
    expect(f.some((x) => x.includes("torso_que_nao_existe"))).toBe(true);
    expect(f.some((x) => x.includes("Postgres"))).toBe(true);
    const teste = readFileSync(join(RAIZ, "apps/web/tests/integracao/meshReal.test.ts"), "utf8");
    expect(teste).toMatch(/if \(!pronto && exigirMeshReal\(\)\) \{/);
    expect(teste).toMatch(/expect\.fail\(/);
  });

  it("contagem de pulados a partir do JSON do Vitest (meshReal pulado é detectado)", () => {
    const d = novoTmp("simulador-vitestjson-");
    const arq = join(d, "v.json");
    const meshPulado = Array.from({ length: 9 }, () => ({ status: "pending" }));
    writeFileSync(arq, JSON.stringify({
      numPendingTests: 9, numTodoTests: 0,
      testResults: [
        { name: "/x/apps/web/tests/integracao/meshReal.test.ts", assertionResults: meshPulado },
        { name: "/x/apps/web/tests/unit/a.test.ts", assertionResults: [{ status: "passed" }] },
      ],
    }));
    expect(py(heredoc("PYV"), [arq]).stdout.trim()).toBe("9 0 9");
    writeFileSync(arq, JSON.stringify({
      numPendingTests: 0, numTodoTests: 0,
      testResults: [{ name: "/x/apps/web/tests/integracao/meshReal.test.ts", assertionResults: meshPulado.map(() => ({ status: "passed" })) }],
    }));
    expect(py(heredoc("PYV"), [arq]).stdout.trim()).toBe("0 9 0");
  });

  it("vale_como_validacao só é true com schema validado, mesh real exigido e 0 pulados", () => {
    const resumo = (a: { semDb?: string; falhas?: string; schema?: string; mesh?: string; pulados?: string }) => {
      const r = py(heredoc("PYJ"), ["0.0.0", a.semDb ?? "0", "0", a.falhas ?? "0", "abc", a.schema ?? "1", a.mesh ?? "1", a.pulados ?? "0"]);
      expect(r.status, r.stderr).toBe(0);
      return JSON.parse(r.stdout) as { vale_como_validacao: boolean; testes_pulados: number | null; schemas_validados: boolean };
    };
    expect(resumo({}).vale_como_validacao).toBe(true);
    expect(resumo({ pulados: "9" })).toMatchObject({ vale_como_validacao: false, testes_pulados: 9 });
    expect(resumo({ pulados: "-1" })).toMatchObject({ vale_como_validacao: false, testes_pulados: null });
    expect(resumo({ schema: "0" })).toMatchObject({ vale_como_validacao: false, schemas_validados: false });
    expect(resumo({ mesh: "0" }).vale_como_validacao).toBe(false);
    expect(resumo({ semDb: "1" }).vale_como_validacao).toBe(false);
    expect(resumo({ falhas: "1" }).vale_como_validacao).toBe(false);
  });
});

describe("A4: telemetria do Next.js desligada na CI", () => {
  it("ci.sh exporta NEXT_TELEMETRY_DISABLED=1", () => {
    expect(CI).toMatch(/^export NEXT_TELEMETRY_DISABLED=1$/m);
  });
});
