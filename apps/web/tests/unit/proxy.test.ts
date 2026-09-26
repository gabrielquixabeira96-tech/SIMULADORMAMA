/**
 * Revisão v0.1.1, item 1 (segurança): o proxy (`src/proxy.ts`, antigo middleware) exige token
 * local, recusa POST de outra origem e Content-Type que não seja JSON (multipart só no upload), e
 * só atende host de loopback. Reproduz o achado do revisor: POST cross-origin `text/plain` em
 * /api/pacientes voltava 201.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { avaliarRequisicao, tokenIgual } from "@/seguranca/requisicao";

const TOKEN = "tok-teste-0123456789abcdef";
const BASE = "http://127.0.0.1:3000";

function req(caminho: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(`${BASE}${caminho}`, { method: init.method ?? "GET", headers: { host: "127.0.0.1:3000", ...(init.headers ?? {}) }, body: init.body });
}
const codigo = async (r: Response) => ((await r.json()) as { erro: { codigo: string } }).erro.codigo;
const passou = (r: Response) => r.headers.get("x-middleware-next") === "1";

afterEach(() => vi.unstubAllEnvs());

describe("proxy com APP_TOKEN_LOCAL", () => {
  it("achado do revisor: POST cross-origin text/plain em /api/pacientes → recusado (401 sem token; 415/403 com token)", async () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    const semToken = proxy(req("/api/pacientes", { method: "POST", headers: { origin: "http://evil.example", "content-type": "text/plain" }, body: "{}" }));
    expect(semToken.status).toBe(401);
    const comTokenTexto = proxy(req("/api/pacientes", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, origin: "http://evil.example", "content-type": "text/plain" }, body: "{}" }));
    expect(comTokenTexto.status).toBe(415);
    const comTokenJson = proxy(req("/api/pacientes", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, origin: "http://evil.example", "content-type": "application/json" }, body: "{}" }));
    expect(comTokenJson.status).toBe(403);
    expect(await codigo(comTokenJson)).toBe("origem_nao_permitida");
  });

  it("mesma origem + JSON + cookie → passa; Sec-Fetch-Site cross-site → 403", async () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    const ok = proxy(req("/api/pacientes", { method: "POST", headers: { cookie: `simulador_token=${TOKEN}`, origin: BASE, "content-type": "application/json; charset=utf-8" }, body: "{}" }));
    expect(passou(ok)).toBe(true);
    const xs = proxy(req("/api/pacientes", { method: "POST", headers: { cookie: `simulador_token=${TOKEN}`, origin: BASE, "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: "{}" }));
    expect(xs.status).toBe(403);
  });

  it("POST sem Origin: só com Authorization Bearer (cliente não-navegador); com cookie → 403", async () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    expect(passou(proxy(req("/api/pacientes", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "{}" })))).toBe(true);
    const r = proxy(req("/api/pacientes", { method: "POST", headers: { cookie: `simulador_token=${TOKEN}`, "content-type": "application/json" }, body: "{}" }));
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe("origem_ausente");
  });

  it("multipart só no upload (/api/malhas); em outras rotas → 415", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    const h = { authorization: `Bearer ${TOKEN}`, origin: BASE, "content-type": "multipart/form-data; boundary=x" };
    expect(passou(proxy(req("/api/malhas", { method: "POST", headers: h, body: "--x--" })))).toBe(true);
    expect(proxy(req("/api/tepid", { method: "POST", headers: h, body: "--x--" })).status).toBe(415);
    expect(proxy(req("/api/malhas/abc/reescalar", { method: "POST", headers: h, body: "--x--" })).status).toBe(415);
  });

  it("token errado → 401 (página e API); ?token= certo → 303 com cookie HttpOnly SameSite=Strict e URL sem token", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    expect(proxy(req("/", { headers: { cookie: "simulador_token=outro" } })).status).toBe(401);
    expect(proxy(req("/api/config", { headers: { authorization: "Bearer outro" } })).status).toBe(401);
    const r = proxy(req(`/?token=${TOKEN}&x=1`));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${BASE}/?x=1`); // mesmo host da requisição: o cookie é por host
    const c = r.headers.get("set-cookie")!;
    expect(c).toContain(`simulador_token=${TOKEN}`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=strict/i);
    expect(proxy(req("/?token=errado")).status).toBe(401);
  });

  it("host fora do loopback → 403 (DNS rebinding), salvo APP_HOSTS_PERMITIDOS", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    const r = proxy(req("/api/config", { headers: { host: "evil.example", authorization: `Bearer ${TOKEN}` } }));
    expect(r.status).toBe(403);
    vi.stubEnv("APP_HOSTS_PERMITIDOS", "consultorio.local");
    expect(passou(proxy(req("/api/config", { headers: { host: "consultorio.local:3000", authorization: `Bearer ${TOKEN}` } })))).toBe(true);
    expect(passou(proxy(req("/api/config", { headers: { host: "localhost:3000", authorization: `Bearer ${TOKEN}` } })))).toBe(true);
  });

  it("GET não exige Content-Type nem Origin", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", TOKEN);
    expect(passou(proxy(req("/api/config", { headers: { authorization: `Bearer ${TOKEN}` } })))).toBe(true);
  });
});

describe("sem APP_TOKEN_LOCAL", () => {
  it("next dev: sem token passa, mas Origin/Content-Type continuam valendo", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(passou(proxy(req("/api/config")))).toBe(true);
    expect(proxy(req("/api/pacientes", { method: "POST", headers: { origin: "http://evil.example", "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect(proxy(req("/api/pacientes", { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    expect(passou(proxy(req("/api/pacientes", { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: "{}" })))).toBe(true);
  });

  it("produção (next start) sem token → 503 em tudo (falha fechada)", () => {
    vi.stubEnv("APP_TOKEN_LOCAL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(req("/api/config")).status).toBe(503);
    expect(proxy(req("/")).status).toBe(503);
  });
});

describe("regras puras", () => {
  it("tokenIgual compara em tempo constante e exige mesmo tamanho", () => {
    expect(tokenIgual("abc", "abc")).toBe(true);
    expect(tokenIgual("abc", "abd")).toBe(false);
    expect(tokenIgual("abc", "abcd")).toBe(false);
    expect(tokenIgual("", "a")).toBe(false);
  });

  it("Origin 'null' ou esquema não http → 403", () => {
    const base = { metodo: "POST", caminho: "/api/tepid", hostUrl: "127.0.0.1:3000", cookie: () => null, env: { NODE_ENV: "development" } };
    for (const origin of ["null", "file://", "chrome-extension://abc"]) {
      const r = avaliarRequisicao({ ...base, cabecalho: (n) => ({ host: "127.0.0.1:3000", origin, "content-type": "application/json" })[n] ?? null });
      expect(r.ok, origin).toBe(false);
    }
  });
});
