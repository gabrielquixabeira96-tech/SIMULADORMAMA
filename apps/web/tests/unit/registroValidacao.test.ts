/**
 * Gerador de registros de validação (plano PT2: A6, A7, A8). Roda os scripts de verdade
 * (python3 scripts/registro_validacao.py e node scripts/validar_gltf.mjs) em pastas temporárias;
 * nada do repositório é alterado.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../../../..");
const V = "9.9.9";
const tmps: string[] = [];
const novoTmp = (prefixo: string) => {
  const d = mkdtempSync(join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
};
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const PENDENCIAS = [
  "- Operador do Marco 1 simulado; falta sessão com cirurgião.",
  "- Coeficientes `nao_calibrado` (texto versionado de teste).",
].join("\n");

const latencia = (p95DoisPaineis: number) => ({
  aprovado: true,
  maquina: { cpu: "cpu de teste", n_cpus: 4 },
  resultados: {
    geral_1_painel: { n: 104, p50_ms: 60, p95_ms: 85.1, max_ms: 99 },
    slider_comparacao_2_paineis: { n: 30, p50_ms: 80, p95_ms: p95DoisPaineis, max_ms: p95DoisPaineis + 5 },
  },
});

const mesh = (gltf: Record<string, unknown> | null) => ({
  esquema: "validacao_componente/services-mesh",
  resumo: {
    marco0_erro_max_gabarito_mm: 0.1,
    volume_erro_max_pct: 4.0,
    por_torso: { t01_simetrico_300: { decimada: { volume_erro_pct: { dir: -4.0, esq: -3.0 } } } },
  },
  marco2: { monotonicidade: true, simetria_max_mm: 0, imf_manter_max_mm: 0, imf_rebaixar_erro_max_mm: 0 },
  gltf_validator: gltf,
});

/** Repositório git mínimo com o gerador, o índice real e os artefatos de entrada. */
function repo(opts: { p95DoisPaineis?: number; pendencias?: string | null; gltf?: Record<string, unknown> | null } = {}) {
  const d = novoTmp("simulador-registro-");
  const docs = join(d, "docs/validacao");
  mkdirSync(join(d, "scripts"), { recursive: true });
  mkdirSync(docs, { recursive: true });
  mkdirSync(join(d, "config"));
  mkdirSync(join(d, "artefatos"));
  copyFileSync(join(RAIZ, "scripts/registro_validacao.py"), join(d, "scripts/registro_validacao.py"));
  copyFileSync(join(RAIZ, "docs/validacao/README.md"), join(docs, "README.md"));
  writeFileSync(join(d, "VERSION"), `${V}\n`);
  writeFileSync(join(d, "config/tepid.json"), JSON.stringify({ versao: "1.0" }));
  writeFileSync(join(d, "config/simulacao.json"), JSON.stringify({ versao: "1.2" }));
  writeFileSync(join(docs, `v${V}-web-marco2-latencia.json`), JSON.stringify(latencia(opts.p95DoisPaineis ?? 150)));
  writeFileSync(join(docs, `v${V}-web-marco2-latencia.md`), "# latência\n");
  const gltf = opts.gltf === undefined ? { arquivos: 12, erros: 0, avisos: 0, versao: "2.0.0-dev.3.10" } : opts.gltf;
  writeFileSync(join(docs, `v${V}-services-mesh.json`), JSON.stringify(mesh(gltf)));
  writeFileSync(join(docs, `v${V}-services-mesh.md`), "# mesh\n");
  const pend = opts.pendencias === undefined ? `# Desvios e pendências — v${V}\n\n${PENDENCIAS}\n` : opts.pendencias;
  if (pend !== null) writeFileSync(join(docs, `pendencias-v${V}.md`), pend);
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "x");
  return d;
}

function gerar(d: string) {
  const r = spawnSync("python3", [join(d, "scripts/registro_validacao.py"), "--artefatos", join(d, "artefatos")], {
    encoding: "utf8",
    env: { ...process.env, VALIDACAO_COMMIT: "abcdef123456" }, // fixo: a 1ª geração suja a árvore
  });
  // Sem os artefatos de teste o registro sai "reprovado" (exit 1); o que importa é gerar sem erro.
  expect(r.stderr, r.stderr).not.toMatch(/Traceback/);
  expect([0, 1]).toContain(r.status);
  return r;
}

const ler = (d: string, rel: string) => readFileSync(join(d, "docs/validacao", rel), "utf8");
const desvios = (md: string) => md.slice(md.indexOf("## Desvios e pendências") + "## Desvios e pendências".length).trim();
const linhasVersao = (readme: string, v: string) => readme.split("\n").filter((l) => l.startsWith(`| ${v} |`));

describe("registro_validacao.py — Desvios e pendências vêm de arquivo versionado e de números medidos (A6)", () => {
  it("a seção começa exatamente com o conteúdo de pendencias-v<V>.md (sem o título)", () => {
    const d = repo();
    gerar(d);
    expect(desvios(ler(d, `v${V}.md`)).startsWith(PENDENCIAS)).toBe(true);
  });

  it("p95 de 2 painéis = 90 ms → nenhuma frase 'acima de 100 ms'", () => {
    const d = repo({ p95DoisPaineis: 90 });
    gerar(d);
    const sec = desvios(ler(d, `v${V}.md`));
    expect(sec).not.toMatch(/acima de 100 ms/);
    expect(sec).not.toMatch(/2 painéis/);
  });

  it("p95 de 2 painéis = 150 ms → frase com o número medido", () => {
    const d = repo({ p95DoisPaineis: 150 });
    gerar(d);
    const sec = desvios(ler(d, `v${V}.md`));
    expect(sec).toMatch(/A comparação lado a lado \(2 painéis\) fica acima de 100 ms .*p95 = 150\.0 ms/);
    expect(sec).not.toMatch(/1 painel/); // 85,1 ms: abaixo do limite
  });

  it("glTF-Validator com erros ou não executado vira pendência medida e reprova o critério", () => {
    const comErro = repo({ gltf: { arquivos: 12, erros: 2, avisos: 1, versao: "2.0.0-dev.3.10" } });
    gerar(comErro);
    const md = ler(comErro, `v${V}.md`);
    expect(desvios(md)).toMatch(/glTF-Validator 2\.0\.0-dev\.3\.10: 2 erros e 1 avisos em 12 arquivos/);
    expect(md).toMatch(/\| glTF-Validator: 0 erros e 0 avisos nos \.glb \| NÃO \|/);
    expect(md).not.toMatch(/verificação manual/);

    const semGltf = repo({ gltf: null });
    gerar(semGltf);
    expect(desvios(ler(semGltf, `v${V}.md`))).toMatch(/glTF-Validator \(Khronos\) não executado/);

    const ok = repo();
    gerar(ok);
    const mdOk = ler(ok, `v${V}.md`);
    expect(mdOk).toMatch(/\| glTF-Validator: 0 erros e 0 avisos nos \.glb \| sim \|/);
    expect(desvios(mdOk)).not.toMatch(/glTF/);
  });

  it("sem pendencias-v<V>.md → marca explícita no registro e aviso no stderr", () => {
    const d = repo({ pendencias: null });
    const r = gerar(d);
    expect(r.stderr).toMatch(/pendencias-v9\.9\.9\.md ausente/);
    expect(desvios(ler(d, `v${V}.md`))).toMatch(/pendencias-v9\.9\.9\.md` ausente/);
  });

  it("'Como reproduzir' não cita versão fixa antiga", () => {
    const d = repo();
    gerar(d);
    const md = ler(d, `v${V}.md`);
    const repro = md.slice(md.indexOf("## Como reproduzir"), md.indexOf("## Desvios e pendências"));
    expect(repro).not.toMatch(/v0\.0\.1/);
  });
});

describe("registro_validacao.py — índice docs/validacao/README.md (A6, A8)", () => {
  it("ganha exatamente 1 linha da versão, no topo da tabela, e rodar de novo não duplica", () => {
    const d = repo();
    const antes = ler(d, "README.md");
    gerar(d);
    const uma = ler(d, "README.md");
    expect(linhasVersao(uma, V)).toHaveLength(1);
    const linha = linhasVersao(uma, V)[0];
    expect(linha).toContain(`[v${V}.md](v${V}.md) · [json](v${V}.json)`);
    expect(linha).toContain(`[services-mesh](v${V}-services-mesh.md) ([json](v${V}-services-mesh.json))`);
    expect(linha).toContain(`[web-marco2-latencia](v${V}-web-marco2-latencia.md) ([json](v${V}-web-marco2-latencia.json))`);
    expect(linha).not.toContain("web-marcos-0-1"); // componente sem arquivo não é linkado
    const tabela = uma.split("\n").filter((l) => /^\| \d/.test(l));
    expect(tabela[0]).toBe(linha);
    // outras linhas (inclusive erratas escritas à mão) intactas
    for (const l of antes.split("\n")) expect(uma.split("\n")).toContain(l);
    gerar(d);
    expect(ler(d, "README.md")).toBe(uma);
  });

  it("status muda → a linha da versão é substituída, não duplicada", () => {
    const d = repo({ gltf: { arquivos: 1, erros: 0, avisos: 0, versao: "x" } });
    gerar(d);
    writeFileSync(join(d, "docs/validacao", `v${V}-services-mesh.json`), JSON.stringify(mesh({ arquivos: 1, erros: 3, avisos: 0, versao: "x" })));
    gerar(d);
    const l = linhasVersao(ler(d, "README.md"), V);
    expect(l).toHaveLength(1);
  });

  it("o índice real tem a linha da 0.1.1 e todos os links da tabela abrem arquivos existentes", () => {
    const readme = readFileSync(join(RAIZ, "docs/validacao/README.md"), "utf8");
    expect(linhasVersao(readme, "0.1.1")).toHaveLength(1);
    const tabela = readme.split("\n").filter((l) => /^\| \d/.test(l));
    const links = tabela.flatMap((l) => [...l.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]));
    expect(links.length).toBeGreaterThan(10);
    for (const alvo of links) expect(existsSync(join(RAIZ, "docs/validacao", alvo)), alvo).toBe(true);
  });

  it("pendencias-v0.1.1.md reproduz a seção do registro v0.1.1 (histórico preservado)", () => {
    const reg = readFileSync(join(RAIZ, "docs/validacao/v0.1.1.md"), "utf8");
    const pend = readFileSync(join(RAIZ, "docs/validacao/pendencias-v0.1.1.md"), "utf8");
    const itens = pend.split("\n").filter((l) => l.startsWith("- "));
    expect(itens.length).toBeGreaterThan(0);
    for (const item of itens) expect(reg).toContain(item.replace(/\.$/, ""));
  });
});

/** GLB mínimo válido (só `asset`), com o chunk JSON alinhado a 4 bytes. */
function glbMinimo(): Buffer {
  let s = JSON.stringify({ asset: { version: "2.0", generator: "teste" } });
  s = s.padEnd(Math.ceil(s.length / 4) * 4, " ");
  const json = Buffer.from(s);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0); // "glTF"
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(20 + json.length, 8);
  h.writeUInt32LE(json.length, 12);
  h.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  return Buffer.concat([h, json]);
}

describe("scripts/validar_gltf.mjs — Khronos glTF-Validator por comando (A7)", () => {
  const validar = (...args: string[]) => spawnSync("node", [join(RAIZ, "scripts/validar_gltf.mjs"), ...args], { encoding: "utf8" });

  it(".glb válido → 0 e '0 erros, 0 avisos'; --json grava o resumo com a versão", () => {
    const d = novoTmp("simulador-gltf-");
    writeFileSync(join(d, "a.glb"), glbMinimo());
    writeFileSync(join(d, "b.glb"), glbMinimo());
    const r = validar("--json", join(d, "r.json"), join(d, "a.glb"), join(d, "b.glb"));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/2 arquivos, 0 erros, 0 avisos/);
    const j = JSON.parse(readFileSync(join(d, "r.json"), "utf8"));
    expect(j).toMatchObject({ arquivos: 2, erros: 0, avisos: 0 });
    expect(j.versao).toMatch(/^2\./);
  });

  it(".glb truncado de propósito → ≠ 0 com erro contado", () => {
    const d = novoTmp("simulador-gltf-");
    writeFileSync(join(d, "ok.glb"), glbMinimo());
    writeFileSync(join(d, "truncado.glb"), glbMinimo().subarray(0, 30));
    const r = validar("--json", join(d, "r.json"), join(d, "ok.glb"), join(d, "truncado.glb"));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FALHA .*truncado\.glb/);
    expect(JSON.parse(readFileSync(join(d, "r.json"), "utf8")).erros).toBeGreaterThan(0);
  });

  it("arquivo inexistente conta como erro; sem argumentos → uso (2)", () => {
    expect(validar(join(novoTmp("simulador-gltf-"), "nao-existe.glb")).status).toBe(1);
    expect(validar().status).toBe(2);
  });

  it("scripts/validacao.sh roda o validador nos .glb e grava gltf_validator no registro do services/mesh", () => {
    const sh = readFileSync(join(RAIZ, "scripts/validacao.sh"), "utf8");
    expect(sh).toMatch(/node scripts\/validar_gltf\.mjs --json .*morphs\/\*\.glb .*torso\.glb/);
    expect(sh).toContain('"gltf_validator": gltf');
  });
});
