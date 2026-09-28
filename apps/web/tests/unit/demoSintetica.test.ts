/**
 * Modo "demonstração sintética" (ADR 0018; v0.1.3 em desenvolvimento): `DEMO_SINTETICA=1`.
 *  - proxy: upload e anamnese → 403 `desligado_na_demo`; token continua obrigatório em tudo; o
 *    modo "benchmark na rede" não se aplica (app inteiro + /benchmark no host público);
 *  - proxy TLS: `?token=` redireciona para https:// e grava cookie Secure a partir de
 *    X-Forwarded-Proto/-Host, SÓ com DEMO_SINTETICA=1 ou APP_CONFIAR_PROXY_TLS=1;
 *  - subida: recusas de ambiente (LLM, token fraco, banco) e de dados (marca, malha real,
 *    anamnese, DATA_DIR/pacientes);
 *  - sem a variável, nada muda (tabela de requisições comparada com a v0.1.2).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { benchmarkHabilitado } from "@/benchmark/servidor";
import { torsoGerado, torsoUtilizavel } from "@/config/demo";
import { MARCA_BANCO_DEMO, motivoTokenFraco, verificarAmbienteDemo, verificarBenchmarkNaRede, verificarDadosDemo, type ConsultaDemo } from "@/config/subida";
import { proxy } from "@/proxy";
import { avaliarRequisicao, modoBenchmarkNaRede, origemOriginal } from "@/seguranca/requisicao";
import { criarSessao, ErroSessao, exigirOperadorDemo } from "@/validacao/sessao";

const TOKEN = "3f9a1c7e5b2d8046af13ce97b5d20e6184c7a93f0b5e2d71c86a4f309eb7d152"; // 64 hex (openssl rand -hex 32)
const PUBLICO = "sb-abc123.vercel.run";
const BASE = "http://127.0.0.1:3000";

function req(caminho: string, init: { method?: string; headers?: Record<string, string>; body?: string; base?: string } = {}) {
  return new NextRequest(`${init.base ?? BASE}${caminho}`, { method: init.method ?? "GET", headers: { host: "127.0.0.1:3000", ...(init.headers ?? {}) }, body: init.body });
}
const codigo = async (r: Response) => ((await r.json()) as { erro: { codigo: string } }).erro.codigo;
const passou = (r: Response) => r.headers.get("x-middleware-next") === "1";
const auth = { authorization: `Bearer ${TOKEN}` };

function demo(extra: Record<string, string> = {}) {
  vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
  vi.stubEnv("DEMO_SINTETICA", "1");
  vi.stubEnv("APP_HOSTS_PERMITIDOS", PUBLICO);
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

afterEach(() => vi.unstubAllEnvs());

describe("proxy no modo demo sintética", () => {
  it("POST /api/malhas (multipart, até com barra final) e POST /api/llm/anamnese → 403 desligado_na_demo", async () => {
    demo();
    const up = proxy(req("/api/malhas", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "multipart/form-data; boundary=x" }, body: "--x--" }));
    expect(up.status).toBe(403);
    expect(await codigo(up)).toBe("desligado_na_demo");
    const barra = proxy(req("/api/malhas/", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "application/json" }, body: "{}" }));
    expect(barra.status).toBe(403);
    const an = proxy(req("/api/llm/anamnese", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "application/json" }, body: "{}" }));
    expect(an.status).toBe(403);
    expect(await codigo(an)).toBe("desligado_na_demo");
    // o resto da consulta continua: paciente, importação de torso sintético, relatório, TEPID
    for (const c of ["/api/pacientes", "/api/sinteticos/t01_simetrico_300/importar", "/api/relatorio", "/api/tepid", "/api/malhas/abc/morphs"]) {
      expect(passou(proxy(req(c, { method: "POST", headers: { ...auth, origin: BASE, "content-type": "application/json" }, body: "{}" }))), c).toBe(true);
    }
    // GET de malha existente (sintética) segue
    expect(passou(proxy(req("/api/malhas/abc", { headers: auth })))).toBe(true);
  });

  it("token continua obrigatório em todas as rotas (inclusive /benchmark e as fechadas: 401 antes do 403)", async () => {
    demo({ BENCHMARK_HABILITADO: "1" });
    for (const c of ["/", "/benchmark", "/api/benchmark", "/api/config", "/validacao/bland-altman", "/api/pacientes"]) {
      const r = proxy(req(c, { headers: { host: PUBLICO } }));
      expect(r.status, c).toBe(401);
    }
    const r = proxy(req("/api/malhas", { method: "POST", headers: { host: PUBLICO, origin: `https://${PUBLICO}`, "content-type": "multipart/form-data; boundary=x" }, body: "--x--" }));
    expect(r.status).toBe(401);
    expect(await codigo(r)).toBe("nao_autenticado");
  });

  it("host público de APP_HOSTS_PERMITIDOS + BENCHMARK_HABILITADO=1: NÃO vira benchmark na rede — app inteiro e /benchmark atendem", () => {
    demo({ BENCHMARK_HABILITADO: "1" });
    expect(modoBenchmarkNaRede({ BENCHMARK_HABILITADO: "1", APP_HOSTS_PERMITIDOS: PUBLICO, DEMO_SINTETICA: "1" })).toBe(false);
    for (const c of ["/", "/benchmark", "/api/benchmark/arquivo?nome=x", "/api/config", "/api/pacientes", "/validacao/bland-altman"]) {
      expect(passou(proxy(req(c, { headers: { host: PUBLICO, ...auth } }))), c).toBe(true);
    }
    expect(passou(proxy(req("/api/pacientes", { method: "POST", headers: { host: PUBLICO, ...auth, origin: `https://${PUBLICO}`, "content-type": "application/json" }, body: "{}" })))).toBe(true);
    // host fora da lista continua 403
    expect(proxy(req("/", { headers: { host: "evil.example", ...auth } })).status).toBe(403);
  });

  it("/benchmark ligado pelo modo demo (sem BENCHMARK_HABILITADO) e desligado fora dele", () => {
    expect(benchmarkHabilitado({ DEMO_SINTETICA: "1" })).toBe(true);
    expect(benchmarkHabilitado({ BENCHMARK_HABILITADO: "1" })).toBe(true);
    expect(benchmarkHabilitado({})).toBe(false);
    expect(benchmarkHabilitado({ DEMO_SINTETICA: "true" })).toBe(false);
  });
});

describe("proxy TLS: redirecionamento do ?token= e cookie", () => {
  it("demo atrás do proxy (Host interno, X-Forwarded-Proto https, X-Forwarded-Host público): Location https:// e cookie Secure", () => {
    demo();
    const r = proxy(req(`/?token=${TOKEN}&x=1`, { headers: { host: "localhost:3000", "x-forwarded-proto": "https", "x-forwarded-host": PUBLICO } }));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`https://${PUBLICO}/?x=1`);
    const c = r.headers.get("set-cookie")!;
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=strict/i);
  });

  it("demo com Host público e só X-Forwarded-Proto: vale o ÚLTIMO valor da lista (o do proxy de borda)", () => {
    demo();
    const r = proxy(req(`/benchmark?token=${TOKEN}`, { headers: { host: PUBLICO, "x-forwarded-proto": "http, https" } }));
    expect(r.headers.get("location")).toBe(`https://${PUBLICO}/benchmark`);
    expect(r.headers.get("set-cookie")).toMatch(/Secure/i);
    // o cliente forja "https" na frente, o proxy acrescenta "http": vale o do proxy
    const r2 = proxy(req(`/?token=${TOKEN}`, { headers: { host: PUBLICO, "x-forwarded-proto": "https, http" } }));
    expect(r2.headers.get("location")).toBe(`http://${PUBLICO}/`);
    expect(r2.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });

  it("X-Forwarded-Host: valor forjado pelo cliente na frente da lista é ignorado; vale o último", async () => {
    demo();
    const forjadoNaFrente = proxy(req(`/?token=${TOKEN}`, { headers: { host: "localhost:3000", "x-forwarded-proto": "https", "x-forwarded-host": `evil.example, ${PUBLICO}` } }));
    expect(forjadoNaFrente.status).toBe(303);
    expect(forjadoNaFrente.headers.get("location")).toBe(`https://${PUBLICO}/`);
    const ultimoRuim = proxy(req("/", { headers: { host: "localhost:3000", "x-forwarded-host": `${PUBLICO}, evil.example`, ...auth } }));
    expect(ultimoRuim.status).toBe(403);
    expect(await codigo(ultimoRuim)).toBe("host_nao_permitido");
  });

  it("demo sem cabeçalhos de proxy (http direto): comportamento da v0.1.2 (http://, sem Secure)", () => {
    demo();
    const r = proxy(req(`/?token=${TOKEN}`));
    expect(r.headers.get("location")).toBe(`${BASE}/`);
    expect(r.headers.get("set-cookie")).not.toMatch(/Secure/i);
    // valor inválido de X-Forwarded-Proto é ignorado
    const r2 = proxy(req(`/?token=${TOKEN}`, { headers: { "x-forwarded-proto": "gopher" } }));
    expect(r2.headers.get("location")).toBe(`${BASE}/`);
  });

  it("X-Forwarded-Host fora de APP_HOSTS_PERMITIDOS → 403 no modo demo", async () => {
    demo();
    const r = proxy(req("/", { headers: { host: "localhost:3000", "x-forwarded-host": "evil.example", ...auth } }));
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe("host_nao_permitido");
  });

  it("POST do navegador pelo host público com Host interno: o Origin é comparado com o X-Forwarded-Host", async () => {
    demo();
    const h = { host: "localhost:3000", "x-forwarded-proto": "https", "x-forwarded-host": PUBLICO, cookie: `simulador_token=${TOKEN}`, "content-type": "application/json" };
    expect(passou(proxy(req("/api/pacientes", { method: "POST", headers: { ...h, origin: `https://${PUBLICO}` }, body: "{}" })))).toBe(true);
    const outro = proxy(req("/api/pacientes", { method: "POST", headers: { ...h, origin: "https://evil.example" }, body: "{}" }));
    expect(outro.status).toBe(403);
    expect(await codigo(outro)).toBe("origem_nao_permitida");
  });

  it("APP_CONFIAR_PROXY_TLS=1 sem demo também honra o proxy (e não fecha upload nem anamnese)", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    vi.stubEnv("APP_HOSTS_PERMITIDOS", PUBLICO);
    vi.stubEnv("APP_CONFIAR_PROXY_TLS", "1");
    const r = proxy(req(`/?token=${TOKEN}`, { headers: { host: PUBLICO, "x-forwarded-proto": "https" } }));
    expect(r.headers.get("location")).toBe(`https://${PUBLICO}/`);
    expect(r.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(passou(proxy(req("/api/malhas", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "multipart/form-data; boundary=x" }, body: "--x--" })))).toBe(true);
  });

  it("origemOriginal: sem confiança ignora os cabeçalhos", () => {
    expect(origemOriginal({ protocoloUrl: "http:", host: "127.0.0.1:3000", xForwardedProto: "https", xForwardedHost: "evil.example", confiar: false })).toEqual({ protocolo: "http:", host: "127.0.0.1:3000" });
    expect(origemOriginal({ protocoloUrl: "http:", host: "127.0.0.1:3000", xForwardedProto: "HTTPS", xForwardedHost: "x, Pub.Example", confiar: true })).toEqual({ protocolo: "https:", host: "pub.example" });
  });
});

describe("sem DEMO_SINTETICA: nada muda (v0.1.2)", () => {
  // [descrição, caminho, init, env extra, status esperado (0 = passa)]
  const casos: [string, string, { method?: string; headers?: Record<string, string>; body?: string }, Record<string, string>, number][] = [
    ["upload multipart", "/api/malhas", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "multipart/form-data; boundary=x" }, body: "--x--" }, {}, 0],
    ["anamnese", "/api/llm/anamnese", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "application/json" }, body: "{}" }, {}, 0],
    ["sem token", "/", {}, {}, 401],
    ["host de fora", "/", { headers: { ...auth, host: PUBLICO } }, {}, 403],
    ["host de fora permitido", "/", { headers: { ...auth, host: PUBLICO } }, { APP_HOSTS_PERMITIDOS: PUBLICO }, 0],
    ["X-Forwarded-Host ignorado (não valida nem troca o host)", "/", { headers: { ...auth, "x-forwarded-host": "evil.example" } }, {}, 0],
    ["benchmark na rede continua restrito", "/api/pacientes", { headers: { ...auth, host: PUBLICO } }, { APP_HOSTS_PERMITIDOS: PUBLICO, BENCHMARK_HABILITADO: "1" }, 403],
    ["DEMO_SINTETICA=0 é desligado", "/api/malhas", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "multipart/form-data; boundary=x" }, body: "--x--" }, { DEMO_SINTETICA: "0" }, 0],
    ["DEMO_SINTETICA=true NÃO liga (a subida recusa o valor)", "/api/llm/anamnese", { method: "POST", headers: { ...auth, origin: BASE, "content-type": "application/json" }, body: "{}" }, { DEMO_SINTETICA: "true" }, 0],
  ];
  it.each(casos)("%s", (_d, caminho, init, env, esperado) => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const r = proxy(req(caminho, init));
    if (esperado === 0) expect(passou(r)).toBe(true);
    else expect(r.status).toBe(esperado);
  });

  it("?token= atrás de proxy sem confiança: Location e Secure pela URL, como na v0.1.2", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    const r = proxy(req(`/?token=${TOKEN}`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" } }));
    expect(r.headers.get("location")).toBe(`${BASE}/`);
    expect(r.headers.get("set-cookie")).not.toMatch(/Secure/i);
    // e com a URL https (ex.: TLS terminado no próprio Next), Secure como antes
    const s = proxy(req(`/?token=${TOKEN}`, { base: "https://127.0.0.1:3000" }));
    expect(s.headers.get("location")).toBe("https://127.0.0.1:3000/");
    expect(s.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("avaliarRequisicao com env sem as chaves novas = mesmo resultado que com elas vazias", () => {
    const base = { metodo: "POST", caminho: "/api/malhas", cabecalho: (n: string) => ({ host: "127.0.0.1:3000", origin: BASE, "content-type": "multipart/form-data", authorization: `Bearer ${TOKEN}` })[n] ?? null, cookie: () => null, hostUrl: "127.0.0.1:3000" };
    const a = avaliarRequisicao({ ...base, env: { APP_TOKEN_LOCAL: TOKEN } });
    const b = avaliarRequisicao({ ...base, env: { APP_TOKEN_LOCAL: TOKEN, DEMO_SINTETICA: "", APP_CONFIAR_PROXY_TLS: "" } });
    expect(a).toEqual({ ok: true, autenticacao: "cabecalho" });
    expect(b).toEqual(a);
  });
});

describe("subida no modo demo: ambiente", () => {
  const ok = { DEMO_SINTETICA: "1", LLM_MODO: "mock", APP_TOKEN_LOCAL: TOKEN, DATABASE_URL: "postgres://u:s@127.0.0.1/demo" };

  it("aceita o ambiente do scripts/demo_sandbox.sh", () => {
    expect(() => verificarAmbienteDemo(ok)).not.toThrow();
    expect(() => verificarAmbienteDemo({ ...ok, ANTHROPIC_API_KEY: "  " })).not.toThrow();
  });

  it("recusa ANTHROPIC_API_KEY, LLM_MODO≠mock (ou ausente), token fraco e banco ausente", () => {
    expect(() => verificarAmbienteDemo({ ...ok, ANTHROPIC_API_KEY: "sk-ant-x" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => verificarAmbienteDemo({ ...ok, LLM_MODO: "anthropic" })).toThrow(/LLM_MODO=mock/);
    expect(() => verificarAmbienteDemo({ ...ok, LLM_MODO: undefined })).toThrow(/LLM_MODO=mock/);
    expect(() => verificarAmbienteDemo({ ...ok, APP_TOKEN_LOCAL: "curto" })).toThrow(/mínimo 32/);
    expect(() => verificarAmbienteDemo({ ...ok, APP_TOKEN_LOCAL: undefined })).toThrow(/APP_TOKEN_LOCAL/);
    expect(() => verificarAmbienteDemo({ ...ok, DATABASE_URL: "" })).toThrow(/DATABASE_URL obrigatório/);
  });

  it("token da demo: exatamente 64 hex minúsculos, comparado CRU (sem trim), como no proxy", () => {
    expect(() => verificarAmbienteDemo({ ...ok, APP_TOKEN_LOCAL: TOKEN.toUpperCase() })).toThrow(/64 caracteres hexadecimais/);
    expect(() => verificarAmbienteDemo({ ...ok, APP_TOKEN_LOCAL: `${TOKEN} ` })).toThrow(/64 caracteres hexadecimais/);
    expect(() => verificarAmbienteDemo({ ...ok, APP_TOKEN_LOCAL: TOKEN.slice(0, 48) })).toThrow(/64 caracteres hexadecimais/);
    expect(() => verificarAmbienteDemo({ ...ok, APP_TOKEN_LOCAL: "Zq8#vL2@pX9!mK4$wR7&tN1*bH6%cJ3^yF5(dG0)sA" })).toThrow(/64 caracteres hexadecimais/); // forte, mas fora do formato
    // o proxy compara o valor cru: com espaço no ambiente, o token "limpo" não autentica
    vi.stubEnv("APP_TOKEN_LOCAL", `${TOKEN} `);
    expect(proxy(req("/api/config", { headers: auth })).status).toBe(401);
  });

  it("DEMO_SINTETICA só aceita 1, 0 ou vazio; fora do modo nada é exigido", () => {
    expect(() => verificarAmbienteDemo({ DEMO_SINTETICA: "true" })).toThrow(/inválido/);
    expect(() => verificarAmbienteDemo({ DEMO_SINTETICA: " 1" })).toThrow(/inválido/);
    for (const v of [undefined, "", "0"]) expect(() => verificarAmbienteDemo({ DEMO_SINTETICA: v, ANTHROPIC_API_KEY: "sk-x", LLM_MODO: "anthropic", APP_TOKEN_LOCAL: "" })).not.toThrow();
  });

  it("token fraco: curto, pouca variedade, periódico, sequencial, de exemplo, entropia baixa", () => {
    expect(motivoTokenFraco(TOKEN)).toBeNull();
    expect(motivoTokenFraco("a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBeNull(); // 32 hex
    expect(motivoTokenFraco("0123456789abcdef0123456789abcde")).toMatch(/mínimo 32/); // 31
    expect(motivoTokenFraco("a".repeat(64))).toMatch(/distintos/);
    expect(motivoTokenFraco("0123456789abcdef".repeat(3))).toMatch(/periódico/);
    expect(motivoTokenFraco("abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")).toMatch(/sequencial/);
    expect(motivoTokenFraco("meu-token-de-exemplo-0123456789abcdefgh")).toMatch(/exemplo/);
    expect(motivoTokenFraco("abbabaabbaababbaababbaabbabaabbaabcdefghij")).toMatch(/entropia baixa/); // 2 letras dominam: ~88 bits
  });

  it("benchmark na rede não recusa DATABASE_URL no modo demo (a demo tem banco próprio)", () => {
    const env = { BENCHMARK_HABILITADO: "1", APP_HOSTS_PERMITIDOS: PUBLICO, DATABASE_URL: "postgres://x" };
    expect(() => verificarBenchmarkNaRede(env, () => true)).toThrow(/DATABASE_URL/);
    expect(() => verificarBenchmarkNaRede({ ...env, DEMO_SINTETICA: "1" }, () => true)).not.toThrow();
  });

  it("a marca do banco no migrar.ts é a mesma da subida", () => {
    const txt = readFileSync(resolve(__dirname, "../../scripts/migrar.ts"), "utf8");
    expect(txt).toContain(`const MARCA_BANCO_DEMO = "${MARCA_BANCO_DEMO}"`);
  });
});

describe("subida no modo demo: dados (banco e DATA_DIR)", () => {
  type Linhas = Record<string, unknown>[];
  function fonte(o: { marca?: string | null; reais?: number; anamneses?: number; linhas?: Linhas } = {}): ConsultaDemo {
    return async (sql) => {
      if (sql.includes("shobj_description")) return [{ marca: o.marca === undefined ? MARCA_BANCO_DEMO : o.marca }];
      if (sql.includes("not sintetica")) return [{ n: o.reais ?? 0 }];
      if (sql.includes("anamnese is not null")) return [{ n: o.anamneses ?? 0 }];
      if (sql.includes("left join malhas")) return o.linhas ?? [];
      throw new Error(`sql inesperado: ${sql}`);
    };
  }
  const dir = () => {
    const d = join(process.env.DATA_DIR!, `demo-${Math.random().toString(36).slice(2)}`);
    mkdirSync(d, { recursive: true });
    return d;
  };

  it("banco marcado, só sintético e DATA_DIR coerente → aceita", async () => {
    const d = dir();
    mkdirSync(join(d, "pacientes/P-ABC234/malhas/m1/original"), { recursive: true });
    mkdirSync(join(d, "pacientes/P-ABC234/medidas"), { recursive: true });
    mkdirSync(join(d, "pacientes/P-XYZ789"), { recursive: true }); // paciente sem malha (só pseudônimo)
    const linhas = [
      { pseudonimo: "P-ABC234", malha_dir: "pacientes/P-ABC234/malhas/m1" },
      { pseudonimo: "P-XYZ789", malha_dir: null },
    ];
    await expect(verificarDadosDemo(fonte({ linhas }), d)).resolves.toBeUndefined();
    await expect(verificarDadosDemo(fonte(), dir())).resolves.toBeUndefined(); // sem pacientes/
  });

  it("recusa banco sem a marca, com malha não sintética ou com anamnese", async () => {
    await expect(verificarDadosDemo(fonte({ marca: null }), dir())).rejects.toThrow(/não é de demonstração/);
    await expect(verificarDadosDemo(fonte({ marca: "outra" }), dir())).rejects.toThrow(/não é de demonstração/);
    await expect(verificarDadosDemo(fonte({ reais: 1 }), dir())).rejects.toThrow(/1 malha\(s\) não sintética/);
    await expect(verificarDadosDemo(fonte({ anamneses: 2 }), dir())).rejects.toThrow(/2 anamnese/);
  });

  it("recusa DATA_DIR/pacientes com pasta de paciente desconhecido, malha não registrada como sintética ou arquivo solto", async () => {
    const d1 = dir();
    mkdirSync(join(d1, "pacientes/P-QQQ222"), { recursive: true });
    await expect(verificarDadosDemo(fonte({ linhas: [] }), d1)).rejects.toThrow(/pacientes\/P-QQQ222 não pertence/);
    const d2 = dir();
    mkdirSync(join(d2, "pacientes/P-ABC234/malhas/real1"), { recursive: true });
    await expect(verificarDadosDemo(fonte({ linhas: [{ pseudonimo: "P-ABC234", malha_dir: null }] }), d2)).rejects.toThrow(/malhas\/real1 não é malha sintética/);
    const d3 = dir();
    mkdirSync(join(d3, "pacientes"), { recursive: true });
    writeFileSync(join(d3, "pacientes/scan.obj"), "v 0 0 0");
    await expect(verificarDadosDemo(fonte(), d3)).rejects.toThrow(/pacientes\/scan.obj não pertence/);
  });
});

describe("torsos utilizáveis e defesa em profundidade nas rotas", () => {
  function torsos() {
    const s = join(process.env.DATA_DIR!, "sinteticos");
    mkdirSync(join(s, "gerado"), { recursive: true });
    writeFileSync(join(s, "gerado/parametros.json"), JSON.stringify({ esquema: "torso_parametros/1.0", nome: "gerado" }));
    writeFileSync(join(s, "gerado/torso.glb"), "x");
    mkdirSync(join(s, "copiado"), { recursive: true });
    writeFileSync(join(s, "copiado/torso.glb"), "x");
    mkdirSync(join(s, "renomeado"), { recursive: true });
    writeFileSync(join(s, "renomeado/parametros.json"), JSON.stringify({ esquema: "torso_parametros/1.0", nome: "outro" }));
    // torso_parametros/1.1 (template com fatores de forma, plano "foto → 3D") também é do gerador
    mkdirSync(join(s, "gerado_v11"), { recursive: true });
    writeFileSync(join(s, "gerado_v11/parametros.json"), JSON.stringify({ esquema: "torso_parametros/1.1", nome: "gerado_v11" }));
    mkdirSync(join(s, "futuro"), { recursive: true });
    writeFileSync(join(s, "futuro/parametros.json"), JSON.stringify({ esquema: "torso_parametros/2.0", nome: "futuro" }));
  }

  it("só torsos com parametros.json do gerador no modo demo; todos fora dele", async () => {
    torsos();
    expect(await torsoGerado("gerado")).toBe(true);
    expect(await torsoGerado("copiado")).toBe(false);
    expect(await torsoGerado("renomeado")).toBe(false);
    expect(await torsoGerado("gerado_v11")).toBe(true);
    expect(await torsoGerado("futuro")).toBe(false);
    expect(await torsoGerado("../x")).toBe(false);
    expect(await torsoUtilizavel("copiado", {})).toBe(true);
    expect(await torsoUtilizavel("copiado", { DEMO_SINTETICA: "1" })).toBe(false);
    const { GET } = await import("@/app/api/sinteticos/route");
    const nomes = async () => ((await (await GET()).json()) as { torsos: { nome: string }[] }).torsos.map((t) => t.nome);
    expect(await nomes()).toEqual(expect.arrayContaining(["copiado", "gerado", "renomeado"]));
    vi.stubEnv("DEMO_SINTETICA", "1");
    expect(await nomes()).toEqual(["gerado", "gerado_v11"]);
    const arq = await import("@/app/api/sinteticos/[nome]/[arquivo]/route");
    const r = await arq.GET(new Request("http://x"), { params: Promise.resolve({ nome: "copiado", arquivo: "torso.glb" }) });
    expect(r.status).toBe(404);
    const imp = await import("@/app/api/sinteticos/[nome]/importar/route");
    const ri = await imp.POST(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ nome: "copiado" }) });
    expect(ri.status).toBe(404);
  });

  it("rotas de upload e anamnese devolvem 403 desligado_na_demo mesmo sem o proxy; fora da demo seguem como antes", async () => {
    const malhas = await import("@/app/api/malhas/route");
    const anamnese = await import("@/app/api/llm/anamnese/route");
    // fora da demo: a validação normal responde (400 sem corpo multipart / corpo JSON inválido)
    expect((await malhas.POST(new Request("http://x", { method: "POST" }))).status).toBe(400);
    expect((await anamnese.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(400);
    vi.stubEnv("DEMO_SINTETICA", "1");
    const r1 = await malhas.POST(new Request("http://x", { method: "POST" }));
    expect(r1.status).toBe(403);
    expect(await codigo(r1)).toBe("desligado_na_demo");
    const r2 = await anamnese.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paciente_id: "00000000-0000-4000-8000-000000000000", texto: "x" }) }));
    expect(r2.status).toBe(403);
  });

  it("registrarMalha recusa malha não sintética no modo demo (antes de tocar disco ou banco)", async () => {
    vi.stubEnv("DEMO_SINTETICA", "1");
    const { registrarMalha } = await import("@/malhas/registrar");
    const paciente = { id: "00000000-0000-4000-8000-000000000000", pseudonimo: "P-ABC234", criado_em: "" } as unknown as Parameters<typeof registrarMalha>[0]["paciente"];
    await expect(
      registrarMalha({ paciente, upload: { arquivos: [], principal: "scan.obj", formato: "obj" } as unknown as Parameters<typeof registrarMalha>[0]["upload"], unidade: "mm", recorte: "abaixo_do_pescoco", sintetica: false, desenho: "B", origem: "upload" }),
    ).rejects.toThrow(/só torsos sintéticos/);
  });
});

describe("sessão de Bland-Altman na demo: operador só OP-NN (revisão R1)", () => {
  it("na demo aceita só OP-00..OP-99; fora dela vale o pseudônimo da v0.1.2", () => {
    for (const ok of ["OP-01", "OP-99", "OP-00"]) expect(() => exigirOperadorDemo(ok, true), ok).not.toThrow();
    for (const ruim of ["OP-1", "OP-001", "MARIA-S", "OP-AB", "GQS", "op-01"]) {
      let err: unknown;
      try {
        exigirOperadorDemo(ruim, true);
      } catch (e) {
        err = e;
      }
      expect(err, ruim).toBeInstanceOf(ErroSessao);
      expect((err as ErroSessao).status).toBe(422);
      expect((err as ErroSessao).codigo).toBe("operador_invalido");
    }
    expect(() => exigirOperadorDemo("MARIA-S", false)).not.toThrow();
  });

  it("criarSessao recusa o pseudônimo livre com DEMO_SINTETICA=1 antes de tocar em DATA_DIR (minúsculas viram OP-NN)", async () => {
    vi.stubEnv("DEMO_SINTETICA", "1");
    vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "simulador-r1-"))); // vazio: nenhuma sessão é criada
    await expect(criarSessao({ operador: "GQS-96" }, "B")).rejects.toMatchObject({ codigo: "operador_invalido", status: 422 });
    await expect(criarSessao({ operador: "Maria Silva" }, "B")).rejects.toThrow(); // o esquema geral já recusa
    // "op-01" é normalizado para "OP-01" pelo esquema e passa pela guarda; cai adiante por falta de torsos
    await expect(criarSessao({ operador: "op-01" }, "B")).rejects.toMatchObject({ codigo: "sem_torsos_sinteticos" });
  });
});
