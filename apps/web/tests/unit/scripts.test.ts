/**
 * Revisão v0.1.1 — guardas dos scripts de CI e de registro (itens 5, 6, 7 e 16). Rodam os
 * scripts de verdade (bash/python3) em pastas temporárias; nada do repositório é alterado.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../../../..");
const tmps: string[] = [];
const novoTmp = (prefixo: string) => {
  const d = mkdtempSync(join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
};
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Repo mínimo com scripts/licencas.sh e um `pnpm` falso no PATH. */
function repoLicencas(pnpmFalso: string, comVenv: boolean) {
  const d = novoTmp("simulador-lic-");
  mkdirSync(join(d, "scripts"));
  mkdirSync(join(d, "bin"));
  copyFileSync(join(RAIZ, "scripts/licencas.sh"), join(d, "scripts/licencas.sh"));
  writeFileSync(join(d, "VERSION"), "9.9.9\n");
  writeFileSync(join(d, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(d, "bin/pnpm"), `#!/bin/sh\n${pnpmFalso}\n`);
  chmodSync(join(d, "bin/pnpm"), 0o755);
  if (comVenv) {
    mkdirSync(join(d, "services/mesh/.venv/bin"), { recursive: true });
    writeFileSync(join(d, "services/mesh/.venv/bin/pip-licenses"), `#!/bin/sh\necho '[{"Name":"numpy","Version":"2.0","License":"BSD License","URL":"x"}]'\n`);
    chmodSync(join(d, "services/mesh/.venv/bin/pip-licenses"), 0o755);
  }
  const r = spawnSync("bash", [join(d, "scripts/licencas.sh"), "--checar"], { env: { ...process.env, PATH: `${join(d, "bin")}:${process.env.PATH}` }, encoding: "utf8" });
  return r;
}

const NODE_OK = `echo '{"MIT":[{"name":"react","versions":["19.0.0"]}]}'`;

describe("scripts/licencas.sh --checar falha fechado (item 5)", () => {
  it("inventário válido (Node + Python) → 0", () => {
    const r = repoLicencas(NODE_OK, true);
    expect(r.status, r.stderr).toBe(0);
  });
  it("'pnpm licenses list' falha → ≠ 0", () => {
    const r = repoLicencas("exit 3", true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/falhou/);
  });
  it("'pnpm licenses list' vazio ({}) → ≠ 0", () => {
    const r = repoLicencas("echo '{}'", true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/vazio/);
  });
  it("sem venv (pip-licenses) no modo --checar → ≠ 0", () => {
    const r = repoLicencas(NODE_OK, false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pip-licenses/);
  });
  it("licença GPL instalada → ≠ 0", () => {
    const r = repoLicencas(`echo '{"GPL-3.0":[{"name":"ruim","versions":["1.0.0"]}]}'`, true);
    expect(r.status).not.toBe(0);
  });
});

describe("scripts/ci.sh (itens 5 e 6)", () => {
  const ci = readFileSync(join(RAIZ, "scripts/ci.sh"), "utf8");
  it("venv do services/mesh é criado ANTES da checagem de licenças", () => {
    const venv = ci.indexOf("bash scripts/mesh.sh venv");
    const lic = ci.indexOf("bash scripts/licencas.sh --checar");
    expect(venv).toBeGreaterThan(0);
    expect(lic).toBeGreaterThan(venv);
  });
  it("roda a suíte de contratos e exige o banco (só --sem-db pula, e marca o registro)", () => {
    expect(ci).toContain("pnpm --filter @simulador/contratos run test");
    expect(ci).not.toMatch(/testes de banco devem se auto-pular/);
    expect(ci).toMatch(/falha "postgres local indisponivel/);
    expect(ci).toContain("ci-resumo.json");
    expect(ci).toContain('"sem_db"');
  });
  it("globalSetup do Vitest falha sem banco, a menos que SEM_DB=1", async () => {
    const { default: setup } = await import("../setup/global");
    const antes = { url: process.env.DATABASE_URL_TEST, sem: process.env.SEM_DB };
    const fornecidos: Record<string, unknown> = {};
    const projeto = { provide: (k: string, v: unknown) => (fornecidos[k] = v) } as never;
    try {
      process.env.DATABASE_URL_TEST = "postgres://x:y@127.0.0.1:1/simulador_test";
      delete process.env.SEM_DB;
      await expect(setup(projeto)).rejects.toThrow(/Postgres de teste indisponível/);
      process.env.SEM_DB = "1";
      await setup(projeto);
      expect(fornecidos.dbDisponivel).toBe(false);
    } finally {
      process.env.DATABASE_URL_TEST = antes.url;
      if (antes.sem === undefined) delete process.env.SEM_DB;
      else process.env.SEM_DB = antes.sem;
      if (antes.url === undefined) delete process.env.DATABASE_URL_TEST;
    }
  });
});

describe("scripts/checar_proibidos.py (item 16)", () => {
  const rodar = (raiz: string) => spawnSync("python3", [join(RAIZ, "scripts/checar_proibidos.py"), "--raiz", raiz], { encoding: "utf8" });
  const repo = (lock: string, pyproject = "[project]\nname='mesh'\ndependencies=['numpy>=1']\n") => {
    const d = novoTmp("simulador-proib-");
    writeFileSync(join(d, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\npackages:\n\n${lock}\n`);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "raiz", dependencies: {} }));
    mkdirSync(join(d, "services/mesh"), { recursive: true });
    writeFileSync(join(d, "services/mesh/pyproject.toml"), pyproject);
    return d;
  };
  it("o repositório real passa (docs e ADRs citam os nomes sem falso positivo)", () => {
    const r = rodar(RAIZ);
    expect(r.status, r.stderr).toBe(0);
  });
  for (const nome of ["depth-anything-3", "da3", "@black-forest-labs/flux", "flux.1-dev", "sam3d", "smpl", "smplx", "pymeshlab", "vggt"]) {
    it(`detecta '${nome}' no lockfile`, () => {
      const r = rodar(repo(`  '${nome}@1.0.0':\n    resolution: {integrity: sha512-abc}\n`));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("PROIBIDO");
    });
  }
  it("detecta no pyproject (ex.: smplx, sam3d-body) e ignora hash/texto que contém as letras", () => {
    expect(rodar(repo("", "[project]\nname='mesh'\ndependencies=['smplx>=0.1']\n")).status).toBe(1);
    expect(rodar(repo("", "[project]\nname='mesh'\ndependencies=['sam3d-body']\n")).status).toBe(1);
    const limpo = rodar(repo(`  'react@19.0.0':\n    resolution: {integrity: sha512-xx+da3/smpl+vggt==}\n`));
    expect(limpo.status, limpo.stderr).toBe(0);
  });
});

describe("scripts/registro_validacao.py grava git describe --dirty (item 7)", () => {
  it("árvore limpa → hash; alteração não commitada → '-dirty'; VALIDACAO_COMMIT tem precedência", () => {
    const d = novoTmp("simulador-git-");
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" }).trim();
    git("init", "-q");
    writeFileSync(join(d, "a.txt"), "1");
    git("add", ".");
    git("commit", "-qm", "x");
    const hash = git("rev-parse", "--short=12", "HEAD");
    const py = (env: Record<string, string> = {}) =>
      execFileSync("python3", ["-c", `import importlib.util,sys; from pathlib import Path; s=importlib.util.spec_from_file_location('r', '${join(RAIZ, "scripts/registro_validacao.py")}'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.commit_descrito(Path('${d}')))`], {
        encoding: "utf8",
        env: { ...process.env, VALIDACAO_COMMIT: "", ...env },
      }).trim();
    expect(py()).toBe(hash);
    writeFileSync(join(d, "a.txt"), "2");
    expect(py()).toBe(`${hash}-dirty`);
    expect(py({ VALIDACAO_COMMIT: "abcdef1234567" })).toBe("abcdef1234567");
  });

  it("schema do registro aceita hash e hash-dirty e recusa lixo", () => {
    const schema = JSON.parse(readFileSync(join(RAIZ, "config/schemas/validacao.schema.json"), "utf8"));
    const re = new RegExp(schema.properties.commit.pattern);
    for (const ok of ["5292a27", "18227b1abcde", "18227b1abcde-dirty", "v0.1.0-3-g18227b1abcde"]) expect(re.test(ok), ok).toBe(true);
    for (const ruim of ["", "HEAD", "18227b1 -dirty", "xyz1234"]) expect(re.test(ruim), ruim).toBe(false);
  });
});

describe("scripts/demo_sandbox.sh (ADR 0018): guardas que não sobem nada", () => {
  const script = join(RAIZ, "scripts/demo_sandbox.sh");
  const rodar = (args: string[], env: Record<string, string>) => spawnSync("bash", [script, ...args], { env: { ...process.env, DEMO_HOST_PUBLICO: "", DEMO_SO_LOOPBACK: "", ...env }, encoding: "utf8" });

  it("sintaxe válida; sem comando mostra o uso e sai 2", () => {
    expect(spawnSync("bash", ["-n", script]).status).toBe(0);
    const r = rodar([], { DEMO_DIR: novoTmp("simulador-demo-") });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("preparar");
  });

  it("recusa DEMO_DIR dentro do repositório (estado da demo nunca no repo)", () => {
    const r = rodar(["status"], { DEMO_DIR: join(RAIZ, "data/demo") });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/nao pode ficar dentro do repositorio/);
  });

  it("subir exige DEMO_HOST_PUBLICO (nome puro) para escutar em 0.0.0.0", () => {
    const d = novoTmp("simulador-demo-");
    writeFileSync(join(d, "demo.env"), "DEMO_SINTETICA=1\n", { mode: 0o600 });
    const sem = rodar(["subir"], { DEMO_DIR: d });
    expect(sem.status).not.toBe(0);
    expect(sem.stderr).toMatch(/defina DEMO_HOST_PUBLICO/);
    const url = rodar(["subir"], { DEMO_DIR: d, DEMO_HOST_PUBLICO: "https://sb-x.vercel.run/" });
    expect(url.status).not.toBe(0);
    expect(url.stderr).toMatch(/DEMO_HOST_PUBLICO invalido/);
    expect(readFileSync(join(d, "demo.env"), "utf8")).not.toMatch(/APP_TOKEN_LOCAL/); // nenhum token gerado antes das guardas
  });
});
